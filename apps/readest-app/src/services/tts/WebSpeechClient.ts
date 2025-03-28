import { getUserLocale } from '@/utils/misc';
import { TTSClient, TTSMessageEvent, TTSVoice } from './TTSClient';
import { AsyncQueue } from '@/utils/queue';
import { findSSMLMark, parseSSMLLang, parseSSMLMarks } from '@/utils/ssml';
import { TTSGranularity } from '@/types/view';
import { TTSUtils } from './TTSUtils';

const BLACKLISTED_VOICES = [
  'Albert',
  'Bad News',
  'Bahh',
  'Bells',
  'Boing',
  'Bubbles',
  'Cellos',
  'Eddy',
  'Flo',
  'Fred',
  'Good News',
  'Grandma',
  'Grandpa',
  'Jester',
  'Junior',
  'Kathy',
  'Organ',
  'Ralph',
  'Reed',
  'Rocko',
  'Sandy',
  'Shelley',
  'Superstar',
  'Trinoids',
  'Whisper',
  'Wobble',
  'Zarvox',
];

interface TTSBoundaryEvent {
  type: 'boundary' | 'end' | 'error';
  speaking: boolean;
  name?: string;
  mark?: string;
  charIndex?: number;
  charLength?: number;
  error?: string;
}

async function* speakWithBoundary(
  ssml: string,
  getRate: () => number,
  getPitch: () => number,
  getVoice: () => SpeechSynthesisVoice | null,
) {
  const lang = parseSSMLLang(ssml);
  const { plainText, marks } = parseSSMLMarks(ssml);
  // console.log('ssml', ssml, marks);
  // console.log('text', plainText);

  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(plainText);

  utterance.rate = getRate();
  utterance.pitch = getPitch();
  const voice = getVoice();
  if (voice) {
    utterance.voice = voice;
  }
  if (lang) {
    utterance.lang = lang;
  }

  const queue = new AsyncQueue<TTSBoundaryEvent>();

  utterance.onboundary = (event: SpeechSynthesisEvent) => {
    utterance.rate = getRate();
    utterance.pitch = getPitch();
    const voice = getVoice();
    if (voice) {
      utterance.voice = voice;
    }
    const mark = findSSMLMark(event.charIndex, marks);
    // console.log('boundary', event.charIndex, mark);
    queue.enqueue({
      type: 'boundary',
      speaking: true,
      name: event.name,
      mark: mark?.name ?? '',
      charIndex: event.charIndex,
      charLength: event.charLength,
    });
  };

  utterance.onend = () => {
    queue.enqueue({ type: 'end', speaking: false });
    queue.finish();
  };

  utterance.onerror = (event) => {
    queue.enqueue({ type: 'error', speaking: false, error: event.error });
    queue.finish();
  };

  synth.speak(utterance);

  while (true) {
    const ev = await queue.dequeue();
    if (ev === null) {
      break;
    }
    yield ev;
  }
}

async function* speakWithMarks(
  ssml: string,
  getRate: () => number,
  getPitch: () => number,
  getVoice: () => SpeechSynthesisVoice | null,
) {
  const { plainText, marks } = parseSSMLMarks(ssml);
  const lang = parseSSMLLang(ssml);

  const isCJK = (lang: string | null) => {
    const cjkLangs = ['zh', 'ja', 'kr'];
    if (lang && cjkLangs.some((cjk) => lang.startsWith(cjk))) return true;
    return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(plainText);
  };

  if (!isCJK(lang)) {
    yield* speakWithBoundary(ssml, getRate, getPitch, getVoice);
    return;
  }

  const synth = window.speechSynthesis;

  const utterance = new SpeechSynthesisUtterance();
  for (const mark of marks) {
    utterance.text = mark.text;
    utterance.rate = getRate();
    utterance.pitch = getPitch();
    const voice = getVoice();
    if (voice) {
      utterance.voice = voice;
    }
    if (lang) {
      utterance.lang = lang;
    }

    yield {
      type: 'boundary',
      speaking: true,
      name: 'sentence',
      mark: mark.name,
    } as TTSBoundaryEvent;

    const result = await new Promise<TTSBoundaryEvent>((resolve) => {
      utterance.onend = () => resolve({ type: 'end', speaking: false });
      utterance.onerror = (event) =>
        resolve({
          type: 'error',
          speaking: false,
          error: event.error,
        });

      synth.speak(utterance);
    });

    yield result;
    if (result.type === 'error') {
      break;
    }
  }
}

export class WebSpeechClient implements TTSClient {
  #rate = 1.0;
  #pitch = 1.0;
  #voice: SpeechSynthesisVoice | null = null;
  #currentVoiceLang = '';
  #voices: SpeechSynthesisVoice[] = [];
  #synth = window.speechSynthesis;
  available = true;

  async init() {
    if (!this.#synth) {
      this.available = false;
      return this.available;
    }
    await new Promise<void>((resolve) => {
      const populateVoices = () => {
        this.#voices = this.#synth.getVoices();
        // console.log('Voices', this.#voices);
        if (this.#voices.length > 0) {
          resolve();
        }
      };

      if (this.#synth.getVoices().length > 0) {
        populateVoices();
      } else if (this.#synth.onvoiceschanged !== undefined) {
        this.#synth.onvoiceschanged = populateVoices;
      } else {
        console.warn('Voiceschanged event not supported.');
        resolve();
      }
    });
    return this.available;
  }

  async *speak(
    ssml: string,
    signal: AbortSignal,
    preload = false,
  ): AsyncGenerator<TTSMessageEvent> {
    // no need to preload for web speech
    if (preload) return;

    const lang = parseSSMLLang(ssml) || 'en';
    if (!this.#voice || this.#currentVoiceLang !== lang) {
      const preferredVoiceId = TTSUtils.getPreferredVoice('web-speech', lang);
      const preferredVoice = this.#voices.find((v) => v.voiceURI === preferredVoiceId);
      const voiceId = (await this.getVoices(lang))[0]?.id ?? '';
      this.#voice = preferredVoice
        ? preferredVoice
        : this.#voices.find((v) => v.voiceURI === voiceId) || null;
      this.#currentVoiceLang = lang;
    }
    for await (const ev of speakWithMarks(
      ssml,
      () => this.#rate,
      () => this.#pitch,
      () => this.#voice,
    )) {
      if (signal.aborted) {
        console.log('TTS aborted');
        yield { code: 'error', message: 'Aborted' } as TTSMessageEvent;
        return;
      }
      if (ev.type === 'boundary') {
        yield {
          code: 'boundary',
          mark: ev.mark ?? '',
          message: `${ev.name ?? 'Unknown'} ${ev.charIndex ?? 0}/${ev.charLength ?? 0}`,
        } as TTSMessageEvent;
      } else if (ev.type === 'error') {
        yield { code: 'error', message: ev.error ?? 'Unknown error' } as TTSMessageEvent;
      } else if (ev.type === 'end') {
        yield { code: 'end', message: 'Speech finished' } as TTSMessageEvent;
      }
    }
  }

  async pause() {
    this.#synth.pause();
  }

  async resume() {
    this.#synth.resume();
  }

  async stop() {
    this.#synth.cancel();
  }

  async setRate(rate: number) {
    // The Web Speech API uses utterance.rate in [0.1 .. 10],
    this.#rate = rate;
  }

  async setPitch(pitch: number) {
    // The Web Speech API uses pitch in [0 .. 2].
    this.#pitch = pitch;
  }

  async setVoice(voiceId: string) {
    const selectedVoice = this.#voices.find((v) => v.voiceURI === voiceId);
    if (selectedVoice) {
      this.#voice = selectedVoice;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    const voices = this.#voices.map((voice) => {
      return {
        id: voice.voiceURI,
        name: voice.name,
        lang: voice.lang,
        disabled: !this.available,
      } as TTSVoice;
    });
    return voices;
  }

  async getVoices(lang: string) {
    if (this.#currentVoiceLang) {
      lang = this.#currentVoiceLang;
    }
    const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
    const isValidVoice = (id: string) => {
      return !id.includes('com.apple') || id.includes('com.apple.voice.compact');
    };
    const isNotBlacklisted = (voice: SpeechSynthesisVoice) => {
      return BLACKLISTED_VOICES.some((name) => voice.name.includes(name)) === false;
    };
    const filteredVoices = this.#voices
      .filter((voice) => voice.lang.startsWith(locale))
      .filter((voice) => isValidVoice(voice.voiceURI || ''))
      .filter(isNotBlacklisted);
    const seenIds = new Set<string>();
    const voices = filteredVoices
      .map(
        (voice) =>
          ({
            id: voice.voiceURI,
            name: voice.name,
            lang: voice.lang,
          }) as TTSVoice,
      )
      .filter((voice) => {
        if (seenIds.has(voice.id)) {
          return false;
        }
        seenIds.add(voice.id);
        return true;
      });
    voices.forEach((voice) => {
      voice.disabled = !this.available;
    });
    return voices;
  }

  getGranularities(): TTSGranularity[] {
    // currently only support sentence boundary and disable word boundary as changing voice
    // in the middle of speech is not possible for different granularities
    return ['sentence'];
  }

  getVoiceId(): string {
    return this.#voice?.voiceURI ?? '';
  }
}
