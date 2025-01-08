import { TTSClient, TTSMessageEvent } from './TTSClient';
import { AsyncQueue } from '@/utils/queue';

interface TTSBoundaryEvent {
  type: 'boundary' | 'end' | 'error';
  speaking: boolean;
  name?: string;
  mark?: string;
  charIndex?: number;
  charLength?: number;
  error?: string;
}

type TTSMark = {
  offset: number;
  name: string;
  text: string;
};

function getXmlLang(ssml: string): string | null {
  const match = ssml.match(/xml:lang\s*=\s*"([^"]+)"/);
  return match ? match[1]! : null;
}

function parseSSMLMarks(ssml: string) {
  ssml = ssml.replace(/<speak[^>]*>/i, '');
  ssml = ssml.replace(/<\/speak>/i, '');

  const markRegex = /<mark\s+name="([^"]+)"\s*\/>/g;
  let plainText = '';
  const marks: TTSMark[] = [];

  let match;
  while ((match = markRegex.exec(ssml)) !== null) {
    const markTagEndIndex = markRegex.lastIndex;
    const nextMarkIndex = ssml.indexOf('<mark', markTagEndIndex);
    const nextChunk = ssml.slice(
      markTagEndIndex,
      nextMarkIndex !== -1 ? nextMarkIndex : ssml.length,
    );
    const cleanedChunk = nextChunk.replace(/<[^>]+>/g, '').trimStart();
    plainText += cleanedChunk;

    const offset = plainText.length - cleanedChunk.length;
    const markName = match[1]!;
    marks.push({ offset, name: markName, text: cleanedChunk });
  }

  return { plainText, marks };
}

function findMark(charIndex: number, marks: TTSMark[]) {
  let left = 0;
  let right = marks.length - 1;
  let result: TTSMark | null = null;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const mark = marks[mid]!;

    if (mark.offset <= charIndex) {
      result = mark;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
}

async function* speakWithBoundary(ssml: string) {
  const lang = getXmlLang(ssml);
  const { plainText, marks } = parseSSMLMarks(ssml);
  // console.log('text', ssml, plainText, marks);

  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(plainText);

  if (lang) {
    utterance.lang = lang;
  }

  const queue = new AsyncQueue<TTSBoundaryEvent>();

  utterance.onboundary = (event: SpeechSynthesisEvent) => {
    const mark = findMark(event.charIndex, marks);
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
  #utterance: SpeechSynthesisUtterance | null = null;
  #synth = window.speechSynthesis;

  async init() {
    if (!this.#synth) {
      throw new Error('Web Speech API not supported in this browser');
    }
  }

  async speak(ssml: string) {
    await this.stop();

    const generator = (async function* () {
      for await (const ev of speakWithBoundary(ssml)) {
        if (ev.type === 'boundary') {
          yield {
            code: 'boundary',
            mark: ev.mark ?? '',
            message: `${ev.name} ${ev.charIndex}/${ev.charLength}`,
          } as TTSMessageEvent;
        } else if (ev.type === 'error') {
          yield { code: 'error', message: ev.error } as TTSMessageEvent;
        } else if (ev.type === 'end') {
          yield { code: 'end', message: 'Speech finished' } as TTSMessageEvent;
        }
      }
    })();

    return generator;
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
    if (this.#utterance) this.#utterance.rate = rate / 10;
  }

  async setPitch(pitch: number) {
    // The Web Speech API uses pitch in [0 .. 2].
    if (this.#utterance) this.#utterance.pitch = pitch / 50;
  }
}
