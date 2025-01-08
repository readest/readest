import { FoliateView } from '@/types/view';
import { TTSClient, TTSMessageCode } from './TTSClient';

type TTSState = 'stopped' | 'playing' | 'paused';

export class TTSController extends EventTarget {
  state: TTSState = 'stopped';
  ttsClient: TTSClient;
  view: FoliateView;
  #nossmlCnt: number = 0;

  constructor(ttsClient: TTSClient, view: FoliateView) {
    super();
    this.ttsClient = ttsClient;
    this.view = view;
  }

  async #init() {
    await this.ttsClient.stop();
    await this.view.initTTS();
  }

  async #speak(ssml: string | undefined | Promise<string>) {
    console.log('TTS speak');
    this.state = 'playing';
    ssml = await ssml;
    if (!ssml) {
      this.#nossmlCnt++;
      // FIXME: in case we are at the end of the book, need a better way to handle this
      if (this.#nossmlCnt < 10) {
        await this.view.next(1);
        this.forward();
      }
      return;
    } else {
      this.#nossmlCnt = 0;
    }

    const iter = await this.ttsClient.speak(ssml);
    let lastCode: TTSMessageCode = 'boundary';
    for await (const { code, mark } of iter) {
      if (mark) {
        this.view.tts.setMark(mark);
      }
      lastCode = code;
    }

    if (lastCode === 'end') {
      this.forward();
    }
  }

  async speak(ssml: string | Promise<string>) {
    await this.#init();
    this.#speak(ssml).catch((e) => this.error(e));
  }

  play() {
    if (this.state !== 'playing') {
      this.start();
    } else {
      this.pause();
    }
  }

  async start() {
    await this.#init();
    const resumeOrStart = this.state === 'paused' ? this.view.tts.resume() : this.view.tts.start();
    return this.#speak(resumeOrStart);
  }

  pause() {
    this.state = 'paused';
    this.ttsClient.stop().catch((e) => this.error(e));
  }

  stop() {
    this.state = 'stopped';
    this.ttsClient.stop().catch((e) => this.error(e));
  }

  // goto previous sentence
  async backward() {
    this.#init();
    if (this.state === 'playing') {
      this.#speak(this.view.tts.prev());
    } else {
      this.state = 'paused';
      this.view.tts.prev(true);
    }
  }

  // goto next sentence
  async forward() {
    await this.#init();
    if (this.state === 'playing') {
      this.#speak(this.view.tts.next());
    } else {
      this.state = 'paused';
      this.view.tts.next(true);
    }
  }

  error(e: unknown) {
    console.error(e);
    this.state = 'stopped';
  }

  kill() {
    this.state = 'stopped';
    this.ttsClient.stop();
  }
}
