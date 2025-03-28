import { FoliateView, TTSGranularity } from '@/types/view';
import { TTSClient, TTSMessageCode, TTSVoice } from './TTSClient';
import { WebSpeechClient } from './WebSpeechClient';
import { EdgeTTSClient } from './EdgeTTSClient';
import { TTSUtils } from './TTSUtils';

type TTSState =
  | 'stopped'
  | 'playing'
  | 'paused'
  | 'backward-paused'
  | 'forward-paused'
  | 'setrate-paused'
  | 'setvoice-paused';

export class TTSController extends EventTarget {
  state: TTSState = 'stopped';
  view: FoliateView;
  #nossmlCnt: number = 0;
  #currentSpeakAbortController: AbortController | null = null;
  #currentSpeakPromise: Promise<void> | null = null;

  ttsLang: string = '';
  ttsRate: number = 1.0;
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
    await this.view.initTTS(granularity);
  }

  async preloadSSML(ssml: string | undefined) {
    if (!ssml) return;
    const iter = await this.ttsClient.speak(ssml, new AbortController().signal, true);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of iter);
  }

  async preloadNextSSML(count: number = 2) {
    const tts = this.view.tts;
    if (!tts) return;
    let preloaded = 0;
    for (let i = 0; i < count; i++) {
      const ssml = this.#preprocessSSML(tts.next());
      this.preloadSSML(ssml);
      if (ssml) preloaded++;
    }
    for (let i = 0; i < preloaded; i++) {
      tts.prev();
    }
  }

  #preprocessSSML(ssml?: string) {
    if (!ssml) return;
    ssml = ssml
      .replace(/[–—]/g, ',')
      .replace(/\.{3,}/g, '<break time="400ms"/>')
      .replace(/·/g, '<break time="200ms"/>');

    return ssml;
  }

  async #speak(ssml: string | undefined | Promise<string>) {
    await this.stop();
    this.#currentSpeakAbortController = new AbortController();
    const { signal } = this.#currentSpeakAbortController;

    this.#currentSpeakPromise = new Promise(async (resolve, reject) => {
      try {
        console.log('TTS speak');
        this.state = 'playing';
        ssml = this.#preprocessSSML(await ssml);
        await this.preloadSSML(ssml);
        if (!ssml) {
          this.#nossmlCnt++;
          // FIXME: in case we are at the end of the book, need a better way to handle this
          if (this.#nossmlCnt < 10 && this.state === 'playing') {
            resolve();
            await this.view.next(1);
            await this.forward();
          }
          return;
        } else {
          this.#nossmlCnt = 0;
        }

        const iter = await this.ttsClient.speak(ssml, signal);
        let lastCode: TTSMessageCode = 'boundary';
        for await (const { code, mark } of iter) {
          if (signal.aborted) {
            resolve();
            return;
          }
          if (mark && this.state === 'playing') {
            this.view.tts?.setMark(mark);
          }
          lastCode = code;
        }

        if (lastCode === 'end' && this.state === 'playing') {
          resolve();
          await this.forward();
        }
        resolve();
      } catch (e) {
        if (signal.aborted) {
          resolve();
        } else {
          reject(e);
        }
      } finally {
        this.#currentSpeakAbortController = null;
        this.#currentSpeakPromise = null;
      }
    });
    await this.#currentSpeakPromise.catch((e) => this.error(e));
  }

  async speak(ssml: string | Promise<string>) {
    await this.initViewTTS();
    this.#speak(ssml).catch((e) => this.error(e));
    this.preloadNextSSML();
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
    const ssml = this.state.includes('paused') ? this.view.tts?.resume() : this.view.tts?.start();
    if (this.state.includes('paused')) {
      this.resume();
    }
    this.#speak(ssml);
    this.preloadNextSSML();
  }

  async pause() {
    this.state = 'paused';
    await this.ttsClient.pause().catch((e) => this.error(e));
  }

  async resume() {
    this.state = 'playing';
    await this.ttsClient.resume().catch((e) => this.error(e));
  }

  async stop() {
    if (this.#currentSpeakAbortController) {
      this.#currentSpeakAbortController.abort();
    }
    await this.ttsClient.stop().catch((e) => this.error(e));

    if (this.#currentSpeakPromise) {
      await this.#currentSpeakPromise.catch((e) => this.error(e));
    }
    this.state = 'stopped';
  }

  // goto previous sentence
  async backward() {
    await this.initViewTTS();
    if (this.state === 'playing') {
      await this.stop();
      this.#speak(this.view.tts?.prev());
    } else {
      await this.stop();
      this.state = 'backward-paused';
      this.view.tts?.prev(true);
    }
  }

  // goto next sentence
  async forward() {
    await this.initViewTTS();
    if (this.state === 'playing') {
      await this.stop();
      this.#speak(this.view.tts?.next());
      this.preloadNextSSML();
    } else {
      await this.stop();
      this.state = 'forward-paused';
      this.view.tts?.next(true);
    }
  }

  async setLang(lang: string) {
    this.ttsLang = lang;
  }

  async setRate(rate: number) {
    this.state = 'setrate-paused';
    this.ttsRate = rate;
    await this.ttsClient.setRate(this.ttsRate);
  }

  async getVoices(lang: string) {
    const ttsWebVoices = await this.ttsWebClient.getVoices(lang);
    const ttsEdgeVoices = await this.ttsEdgeClient.getVoices(lang);
    return [...ttsEdgeVoices, ...ttsWebVoices];
  }

  async setVoice(voiceId: string) {
    this.state = 'setvoice-paused';
    const useEdgeTTS = !!this.ttsEdgeVoices.find(
      (voice) => (voiceId === '' || voice.id === voiceId) && !voice.disabled,
    );
    if (useEdgeTTS) {
      this.ttsClient = this.ttsEdgeClient;
      await this.ttsClient.setRate(this.ttsRate);
      TTSUtils.setPreferredVoice('edge-tts', this.ttsLang, voiceId);
    } else {
      this.ttsClient = this.ttsWebClient;
      await this.ttsClient.setRate(this.ttsRate);
      TTSUtils.setPreferredVoice('web-speech', this.ttsLang, voiceId);
    }
    await this.ttsClient.setVoice(voiceId);
  }

  getVoiceId() {
    return this.ttsClient.getVoiceId();
  }

  error(e: unknown) {
    console.error(e);
    this.state = 'stopped';
  }

  async kill() {
    await this.stop();
  }
}
