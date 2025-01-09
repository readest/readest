import { TTSClient, TTSMessageEvent } from './TTSClient';
import { AsyncQueue } from '@/utils/queue';
import { findSSMLMark, parseSSMLLang, parseSSMLMarks } from '@/utils/ssml';

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
    const cjkLangs = ['zh', 'ja', 'ko'];
    if (lang && cjkLangs.some((cjk) => lang.startsWith(cjk))) return true;
    return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(plainText);
  };

  if (!isCJK(lang)) {
    yield* speakWithBoundary(ssml, getRate, getPitch, getVoice);
    return;
  }

  const synth = window.speechSynthesis;

  for (const mark of marks) {
    const utterance = new SpeechSynthesisUtterance(mark.text);

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
  #voices: SpeechSynthesisVoice[] = [];
  #synth = window.speechSynthesis;

  async init() {
    if (!this.#synth) {
      throw new Error('Web Speech API not supported in this browser');
    }
    await new Promise<void>((resolve) => {
      const populateVoices = () => {
        this.#voices = this.#synth.getVoices();
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
  }

  async *speak(ssml: string): AsyncGenerator<TTSMessageEvent> {
    for await (const ev of speakWithMarks(
      ssml,
      () => this.#rate,
      () => this.#pitch,
      () => this.#voice,
    )) {
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

  async getVoices(lang: string) {
    return this.#voices.filter((voice) => voice.lang.startsWith(lang)).map((voice) => voice.name);
  }

  async setVoice(voice: string) {
    const selectedVoice = this.#voices.find((v) => v.name === voice);
    if (selectedVoice) {
      this.#voice = selectedVoice;
    }
  }
}
