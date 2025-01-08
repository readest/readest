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

async function* speakWithBoundary(ssml: string, getRate: () => number, getPitch: () => number) {
  const lang = parseSSMLLang(ssml);
  const { plainText, marks } = parseSSMLMarks(ssml);
  // console.log('ssml', ssml, marks);
  // console.log('text', plainText);

  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(plainText);

  if (lang) {
    utterance.lang = lang;
  }
  utterance.rate = getRate();
  utterance.pitch = getPitch();

  const queue = new AsyncQueue<TTSBoundaryEvent>();

  utterance.onboundary = (event: SpeechSynthesisEvent) => {
    utterance.rate = getRate();
    utterance.pitch = getPitch();
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

export class WebSpeechClient implements TTSClient {
  #rate = 1.0;
  #pitch = 1.0;
  #synth = window.speechSynthesis;

  async init() {
    if (!this.#synth) {
      throw new Error('Web Speech API not supported in this browser');
    }
  }

  async *speak(ssml: string): AsyncGenerator<TTSMessageEvent> {
    for await (const ev of speakWithBoundary(
      ssml,
      () => this.#rate,
      () => this.#pitch,
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
}
