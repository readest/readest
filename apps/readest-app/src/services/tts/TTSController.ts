import { FoliateView, TTSGranularity } from '@/types/view';
import { TTSClient, TTSMessageCode, TTSVoice } from './TTSClient';
import { WebSpeechClient } from './WebSpeechClient';
import { EdgeTTSClient } from './EdgeTTSClient';

type TTSState = 'stopped' | 'playing' | 'paused' | 'backward-paused' | 'forward-paused';

export class TTSController extends EventTarget {
  state: TTSState = 'stopped';
  view: FoliateView;
  #nossmlCnt: number = 0;

  ttsClient: TTSClient;
  ttsWebClient: TTSClient;
  ttsEdgeClient: TTSClient;
  ttsWebVoices: TTSVoice[] = [];
  ttsEdgeVoices: TTSVoice[] = [];

  constructor(view: FoliateView) {
    super();
    this.ttsWebClient = new WebSpeechClient();
    this.ttsEdgeClient = new EdgeTTSClient();
    this.ttsClient = this.ttsWebClient;
    this.view = view;
  }

  async init() {
    await this.ttsWebClient.init();
    const success = await this.ttsEdgeClient.init();
    if (success) {
      this.ttsClient = this.ttsEdgeClient;
    } else {
      this.ttsClient = this.ttsWebClient;
    }
    this.ttsWebVoices = await this.ttsWebClient.getAllVoices();
    this.ttsEdgeVoices = await this.ttsEdgeClient.getAllVoices();
  }

  async initViewTTS() {
    let granularity: TTSGranularity = this.view.language.isCJK ? 'sentence' : 'word';
    const supportedGranularities = this.ttsClient.getGranularities();
    if (!supportedGranularities.includes(granularity)) {
      granularity = supportedGranularities[0]!;
    }
    await this.ttsClient.stop();
    await this.view.initTTS(granularity);
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
      if (mark && this.state === 'playing') {
        this.view.tts?.setMark(mark);
      }
      lastCode = code;
    }

    if (lastCode === 'end') {
      this.forward();
    }
  }

  async speak(ssml: string | Promise<string>) {
    await this.initViewTTS();
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
    await this.initViewTTS();
    const resumeOrStart = this.state.includes('paused')
      ? this.view.tts?.resume()
      : this.view.tts?.start();
    return this.#speak(resumeOrStart);
  }

  pause() {
    this.state = 'paused';
    this.ttsClient.pause().catch((e) => this.error(e));
  }

  resume() {
    this.state = 'playing';
    this.ttsClient.resume().catch((e) => this.error(e));
  }

  stop() {
    this.state = 'stopped';
    this.ttsClient.stop().catch((e) => this.error(e));
  }

  // goto previous sentence
  async backward() {
    this.initViewTTS();
    if (this.state === 'playing') {
      this.stop();
      this.#speak(this.view.tts?.prev());
    } else {
      this.state = 'backward-paused';
      this.view.tts?.prev(true);
    }
  }

  // goto next sentence
  async forward() {
    await this.initViewTTS();
    if (this.state === 'playing') {
      this.stop();
      this.#speak(this.view.tts?.next());
    } else {
      this.state = 'forward-paused';
      this.view.tts?.next(true);
    }
  }

  async setRate(rate: number) {
    this.ttsClient.setRate(rate);
  }

  async getVoices(lang: string) {
    const ttsWebVoices = await this.ttsWebClient.getVoices(lang);
    const ttsEdgeVoices = await this.ttsEdgeClient.getVoices(lang);
    return [...ttsEdgeVoices, ...ttsWebVoices];
  }

  async setVoice(voiceId: string) {
    this.ttsClient.stop();
    if (this.ttsEdgeVoices.find((voice) => voice.id === voiceId && !voice.disabled)) {
      this.ttsClient = this.ttsEdgeClient;
    } else {
      this.ttsClient = this.ttsWebClient;
    }
    await this.ttsClient.setVoice(voiceId);
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
