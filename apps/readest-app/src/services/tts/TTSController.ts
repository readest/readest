import { FoliateView } from '@/types/view';
import { AppService } from '@/types/system';
import { filterSSMLWithLang, parseSSMLMarks } from '@/utils/ssml';
import { Overlayer } from 'foliate-js/overlayer.js';
import { TTSGranularity, TTSHighlightOptions, TTSMark, TTSVoice } from './types';
import { createRejectFilter } from '@/utils/node';
import { WebSpeechClient } from './WebSpeechClient';
import { NativeTTSClient } from './NativeTTSClient';
import { EdgeTTSClient } from './EdgeTTSClient';
import { TTSUtils } from './TTSUtils';
import { TTSClient } from './TTSClient';

type TTSState =
  | 'stopped'
  | 'playing'
  | 'paused'
  | 'stop-paused'
  | 'backward-paused'
  | 'forward-paused'
  | 'setrate-paused'
  | 'setvoice-paused';

const HIGHLIGHT_KEY = 'tts-highlight';

export class TTSController extends EventTarget {
  appService: AppService | null = null;
  view: FoliateView;
  isAuthenticated: boolean = false;
  preprocessCallback?: (ssml: string) => Promise<string>;
  #nossmlCnt: number = 0;
  #currentSpeakAbortController: AbortController | null = null;
  #currentSpeakPromise: Promise<void> | null = null;

  state: TTSState = 'stopped';
  ttsLang: string = '';
  ttsRate: number = 1.0;
  ttsClient: TTSClient;
  ttsWebClient: TTSClient;
  ttsEdgeClient: TTSClient;
  ttsNativeClient: TTSClient | null = null;
  ttsWebVoices: TTSVoice[] = [];
  ttsEdgeVoices: TTSVoice[] = [];
  ttsNativeVoices: TTSVoice[] = [];
  ttsTargetLang: string = '';

  options: TTSHighlightOptions = { style: 'highlight', color: 'gray' };

  constructor(
    appService: AppService | null,
    view: FoliateView,
    isAuthenticated: boolean = false,
    preprocessCallback?: (ssml: string) => Promise<string>,
  ) {
    super();
    this.ttsWebClient = new WebSpeechClient(this);
    this.ttsEdgeClient = new EdgeTTSClient(this);
    // TODO: implement native TTS client for iOS and PC
    if (appService?.isAndroidApp) {
      this.ttsNativeClient = new NativeTTSClient(this);
    }
    this.ttsClient = this.ttsWebClient;
    this.appService = appService;
    this.view = view;
    this.isAuthenticated = isAuthenticated;
    this.preprocessCallback = preprocessCallback;
  }

  async init() {
    const availableClients = [];
    if (await this.ttsEdgeClient.init()) {
      availableClients.push(this.ttsEdgeClient);
    }
    if (this.ttsNativeClient && (await this.ttsNativeClient.init())) {
      availableClients.push(this.ttsNativeClient);
      this.ttsNativeVoices = await this.ttsNativeClient.getAllVoices();
    }
    if (await this.ttsWebClient.init()) {
      availableClients.push(this.ttsWebClient);
    }
    this.ttsClient = availableClients[0] || this.ttsWebClient;
    const preferredClientName = TTSUtils.getPreferredClient();
    if (preferredClientName) {
      const preferredClient = availableClients.find(
        (client) => client.name === preferredClientName,
      );
      if (preferredClient) {
        this.ttsClient = preferredClient;
      }
    }
    this.ttsWebVoices = await this.ttsWebClient.getAllVoices();
    this.ttsEdgeVoices = await this.ttsEdgeClient.getAllVoices();
  }

  #getHighlighter() {
    return (range: Range) => {
      const { overlayer } = this.view.renderer.getContents()[0] as { overlayer: Overlayer };
      const { style, color } = this.options;
      overlayer?.remove(HIGHLIGHT_KEY);
      overlayer?.add(HIGHLIGHT_KEY, range, Overlayer[style], { color });
    };
  }

  #clearHighlighter() {
    const { overlayer } = (this.view.renderer.getContents()?.[0] || {}) as { overlayer: Overlayer };
    overlayer?.remove(HIGHLIGHT_KEY);
  }

  async initViewTTS(options?: TTSHighlightOptions) {
    if (options) {
      this.options.style = options.style;
      this.options.color = options.color;
    }
    let granularity: TTSGranularity = this.view.language.isCJK ? 'sentence' : 'word';
    const supportedGranularities = this.ttsClient.getGranularities();
    if (!supportedGranularities.includes(granularity)) {
      granularity = supportedGranularities[0]!;
    }
    await this.view.initTTS(
      granularity,
      createRejectFilter({
        tags: ['rt'],
        contents: [{ tag: 'a', content: /^[\[\(]?[\*\d]+[\)\]]?$/ }],
      }),
      this.#getHighlighter(),
    );
  }

  async preloadSSML(ssml: string | undefined, signal: AbortSignal) {
    if (!ssml) return;
    const iter = await this.ttsClient.speak(ssml, signal, true);
    for await (const _ of iter);
  }

  async preloadNextSSML(count: number = 4) {
    const tts = this.view.tts;
    if (!tts) return;
    let preloaded = 0;
    for (let i = 0; i < count; i++) {
      const ssml = await this.#preprocessSSML(tts.next());
      this.preloadSSML(ssml, new AbortController().signal);
      if (ssml) preloaded++;
    }
    for (let i = 0; i < preloaded; i++) {
      tts.prev();
    }
  }

  async #preprocessSSML(ssml?: string) {
    if (!ssml) return;
    ssml = ssml
      .replace(/<emphasis[^>]*>([^<]+)<\/emphasis>/g, '$1')
      .replace(/[–—]/g, ',')
      .replace('<break/>', ' ')
      .replace(/\.{3,}/g, '   ')
      .replace(/……/g, '  ')
      .replace(/\*/g, ' ')
      .replace(/·/g, ' ');

    if (this.ttsTargetLang) {
      ssml = filterSSMLWithLang(ssml, this.ttsTargetLang);
    }

    if (this.preprocessCallback) {
      ssml = await this.preprocessCallback(ssml);
    }

    return ssml;
  }

  async #speak(ssml: string | undefined | Promise<string>, oneTime = false) {
    await this.stop();
    this.#currentSpeakAbortController = new AbortController();
    const { signal } = this.#currentSpeakAbortController;

    this.#currentSpeakPromise = new Promise(async (resolve, reject) => {
      try {
        console.log('TTS speak');
        this.state = 'playing';

        signal.addEventListener('abort', () => {
          resolve();
        });

        ssml = await this.#preprocessSSML(await ssml);
        if (!ssml) {
          this.#nossmlCnt++;
          // FIXME: in case we are at the end of the book, need a better way to handle this
          if (this.#nossmlCnt < 10 && this.state === 'playing' && !oneTime) {
            resolve();
            await this.view.next();
            await this.forward();
          }
          console.log('no SSML, skipping for', this.#nossmlCnt);
          return;
        } else {
          this.#nossmlCnt = 0;
        }

        const { plainText, marks } = parseSSMLMarks(ssml);
        if ((!plainText || marks.length === 0) && !oneTime) {
          resolve();
          return await this.forward();
        } else {
          this.dispatchSpeakMark(marks[0]);
        }
        await this.preloadSSML(ssml, signal);
        const iter = await this.ttsClient.speak(ssml, signal);
        let lastCode;
        for await (const { code } of iter) {
          if (signal.aborted) {
            resolve();
            return;
          }
          lastCode = code;
        }

        if (lastCode === 'end' && this.state === 'playing' && !oneTime) {
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
        if (this.#currentSpeakAbortController) {
          this.#currentSpeakAbortController.abort();
          this.#currentSpeakAbortController = null;
        }
      }
    });

    await this.#currentSpeakPromise.catch((e) => this.error(e));
  }

  async speak(ssml: string | Promise<string>, oneTime = false) {
    await this.initViewTTS();
    this.#speak(ssml, oneTime).catch((e) => this.error(e));
    this.preloadNextSSML();
    this.dispatchSpeakMark();
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
    if (!(await this.ttsClient.pause().catch((e) => this.error(e)))) {
      await this.stop();
      this.state = 'stop-paused';
    }
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
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Stop operation timed out')), 3000),
      );
      await Promise.race([this.#currentSpeakPromise.catch((e) => this.error(e)), timeout]).catch(
        (e) => this.error(e),
      );
      this.#currentSpeakPromise = null;
    }
    this.state = 'stopped';
  }

  // goto previous mark/paragraph
  async backward(byMark = false) {
    await this.initViewTTS();
    if (this.state === 'playing') {
      await this.stop();
      if (byMark) this.#speak(this.view.tts?.prevMark());
      else this.#speak(this.view.tts?.prev());
    } else {
      await this.stop();
      this.state = 'backward-paused';
      if (byMark) this.view.tts?.prevMark(true);
      else this.view.tts?.prev(true);
    }
  }

  // goto next mark/paragraph
  async forward(byMark = false) {
    await this.initViewTTS();
    if (this.state === 'playing') {
      await this.stop();
      if (byMark) this.#speak(this.view.tts?.nextMark());
      else {
        this.#speak(this.view.tts?.next());
        this.preloadNextSSML();
      }
    } else {
      await this.stop();
      this.state = 'forward-paused';
      if (byMark) this.view.tts?.nextMark(true);
      else this.view.tts?.next(true);
    }
  }

  async setLang(lang: string) {
    this.ttsLang = lang;
    this.setPrimaryLang(lang);
  }

  async setPrimaryLang(lang: string) {
    if (this.ttsEdgeClient.initialized) this.ttsEdgeClient.setPrimaryLang(lang);
    if (this.ttsWebClient.initialized) this.ttsWebClient.setPrimaryLang(lang);
    if (this.ttsNativeClient?.initialized) this.ttsNativeClient?.setPrimaryLang(lang);
  }

  async setRate(rate: number) {
    this.state = 'setrate-paused';
    this.ttsRate = rate;
    await this.ttsClient.setRate(this.ttsRate);
  }

  async getVoices(lang: string) {
    const ttsWebVoices = await this.ttsWebClient.getVoices(lang);
    const ttsEdgeVoices = await this.ttsEdgeClient.getVoices(lang);
    const ttsNativeVoices = (await this.ttsNativeClient?.getVoices(lang)) ?? [];

    const voicesGroups = [...ttsNativeVoices, ...ttsEdgeVoices, ...ttsWebVoices];
    return voicesGroups;
  }

  async setVoice(voiceId: string, lang: string) {
    this.state = 'setvoice-paused';
    const useEdgeTTS = !!this.ttsEdgeVoices.find(
      (voice) => (voiceId === '' || voice.id === voiceId) && !voice.disabled,
    );
    const useNativeTTS = !!this.ttsNativeVoices.find(
      (voice) => (voiceId === '' || voice.id === voiceId) && !voice.disabled,
    );
    if (useEdgeTTS) {
      this.ttsClient = this.ttsEdgeClient;
      await this.ttsClient.setRate(this.ttsRate);
    } else if (useNativeTTS) {
      if (!this.ttsNativeClient) {
        throw new Error('Native TTS client is not available');
      }
      this.ttsClient = this.ttsNativeClient;
      await this.ttsClient.setRate(this.ttsRate);
    } else {
      this.ttsClient = this.ttsWebClient;
      await this.ttsClient.setRate(this.ttsRate);
    }
    TTSUtils.setPreferredClient(this.ttsClient.name);
    TTSUtils.setPreferredVoice(this.ttsClient.name, lang, voiceId);
    await this.ttsClient.setVoice(voiceId);
  }

  getVoiceId() {
    return this.ttsClient.getVoiceId();
  }

  getSpeakingLang() {
    return this.ttsClient.getSpeakingLang();
  }

  setTargetLang(lang: string) {
    this.ttsTargetLang = lang;
  }

  dispatchSpeakMark(mark?: TTSMark) {
    this.dispatchEvent(new CustomEvent('tts-speak-mark', { detail: mark || { text: '' } }));
    if (mark) {
      const range = this.view.tts?.setMark(mark.name);
      this.dispatchEvent(new CustomEvent('tts-highlight-mark', { detail: range }));
    }
  }

  error(e: unknown) {
    console.error(e);
    this.state = 'stopped';
  }

  async shutdown() {
    await this.stop();
    this.#clearHighlighter();
    if (this.ttsWebClient.initialized) {
      await this.ttsWebClient.shutdown();
    }
    if (this.ttsEdgeClient.initialized) {
      await this.ttsEdgeClient.shutdown();
    }
    if (this.ttsNativeClient?.initialized) {
      await this.ttsNativeClient.shutdown();
    }
  }
}
