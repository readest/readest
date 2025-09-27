import { getUserLocale } from '@/utils/misc';
import { TTSClient, TTSMessageEvent } from './TTSClient';
import { parseSSMLMarks } from '@/utils/ssml';
import { TTSGranularity, TTSMark, TTSVoice, TTSVoicesGroup } from './types';
import { WEB_SPEECH_BLACKLISTED_VOICES } from './TTSData';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';

interface TTSBoundaryEvent {
  type: 'boundary' | 'end' | 'error';
  speaking: boolean;
  name?: string;
  mark?: string;
  charIndex?: number;
  charLength?: number;
  error?: string;
}

async function* speakWithMarks(
  ssml: string,
  primaryLang: string,
  getRate: () => number,
  getPitch: () => number,
  getVoice: (lang: string) => Promise<SpeechSynthesisVoice | null>,
  setCurrentVoice: (voiceId: string) => void,
  setSpeakingLang: (lang: string) => void,
  dispatchSpeakMark: (mark: TTSMark) => void,
) {
  const { marks } = parseSSMLMarks(ssml, primaryLang);
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance();
  for (const mark of marks) {
    const { language: voiceLang } = mark;
    dispatchSpeakMark(mark);
    utterance.text = mark.text;
    utterance.rate = getRate();
    utterance.pitch = getPitch();
    const voice = await getVoice(voiceLang);
    if (voice) {
      utterance.voice = voice;
      setCurrentVoice(voice.voiceURI);
    }
    if (voiceLang) {
      utterance.lang = voiceLang;
      setSpeakingLang(voiceLang);
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

type WebSpeechVoice = SpeechSynthesisVoice & {
  id: string;
};

export class WebSpeechClient implements TTSClient {
  name = 'web-speech';
  initialized = false;
  controller?: TTSController;

  #voices: WebSpeechVoice[] = [];
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = '';
  #rate = 1.0;
  #pitch = 1.0;

  #synth = window.speechSynthesis;

  constructor(controller?: TTSController) {
    this.controller = controller;
  }

  async init() {
    if (!this.#synth) {
      this.initialized = false;
      return this.initialized;
    }
    await new Promise<void>((resolve) => {
      const populateVoices = () => {
        this.#voices = this.#synth.getVoices().map((voice) => {
          const webSpeechVoice = voice as WebSpeechVoice;
          webSpeechVoice.id = voice.voiceURI || voice.name;
          return webSpeechVoice;
        });
        // console.log('Voices', this.#voices);
        resolve();
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
    this.initialized = true;
    return this.initialized;
  }

  getVoiceIdFromLang = async (lang: string) => {
    const preferredVoiceId = TTSUtils.getPreferredVoice(this.name, lang);
    const preferredVoice = this.#voices.find((v) => v.id === preferredVoiceId);
    const defaultVoice = preferredVoice
      ? preferredVoice
      : (await this.getVoices(lang))[0]?.voices[0] || null;
    return defaultVoice?.id || this.#currentVoiceId || '';
  };

  getWebSpeechVoiceFromLang = async (lang: string) => {
    const voiceId = await this.getVoiceIdFromLang(lang);
    return this.#voices.find((v) => v.id === voiceId) || null;
  };

  async *speak(
    ssml: string,
    signal: AbortSignal,
    preload = false,
  ): AsyncGenerator<TTSMessageEvent> {
    // no need to preload for web speech
    if (preload) return;

    for await (const ev of speakWithMarks(
      ssml,
      this.#primaryLang,
      () => this.#rate,
      () => this.#pitch,
      this.getWebSpeechVoiceFromLang,
      (voiceId) => (this.#currentVoiceId = voiceId),
      (lang) => (this.#speakingLang = lang),
      (mark) => this.controller?.dispatchSpeakMark(mark),
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
    return true;
  }

  async resume() {
    this.#synth.resume();
    return true;
  }

  async stop() {
    this.#synth.cancel();
  }

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
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
    const selectedVoice = this.#voices.find((v) => v.id === voiceId);
    if (selectedVoice) {
      this.#currentVoiceId = selectedVoice.id;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    const voices = this.#voices.map((voice) => {
      return {
        id: voice.id,
        name: voice.name,
        lang: voice.lang,
        disabled: !this.initialized,
      } as TTSVoice;
    });
    return voices;
  }

  async getVoices(lang: string) {
    const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
    const isValidVoice = (id: string) => {
      return !id.includes('com.apple') || id.includes('com.apple.voice.compact');
    };
    const isNotBlacklisted = (voice: SpeechSynthesisVoice) => {
      return WEB_SPEECH_BLACKLISTED_VOICES.some((name) => voice.name.includes(name)) === false;
    };
    const filteredVoices = this.#voices
      .filter(
        (voice) =>
          voice.lang.startsWith(locale) ||
          (lang === 'en' && ['en-US', 'en-GB'].includes(voice.lang)),
      )
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
      voice.disabled = !this.initialized;
    });

    const voicesGroup: TTSVoicesGroup = {
      id: 'web-speech-api',
      name: 'Web TTS',
      voices: voices.sort(TTSUtils.sortVoicesFunc),
      disabled: !this.initialized || voices.length === 0,
    };
    return [voicesGroup];
  }

  getGranularities(): TTSGranularity[] {
    // currently only support sentence boundary and disable word boundary as changing voice
    // in the middle of speech is not possible for different granularities
    return ['sentence'];
  }

  getVoiceId(): string {
    return this.#currentVoiceId;
  }

  getSpeakingLang(): string {
    return this.#speakingLang;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.#voices = [];
    await this.stop();
  }
}
