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
import { isValidLang } from '@/utils/lang';
import {
  computeWordOffsets,
  getTextSubRange,
  rangeTextExcludingInert,
  TTSWordOffset,
} from './wordHighlight';

// App-wide monotonic sequence for 'tts-position' events. A fresh TTSController
// is constructed per `tts-speak`, so a per-instance counter would restart at 0
// and consumers (paragraph mode, RSVP) holding `lastSequenceSeen` from a prior
// session would drop the new session's early positions until they exceeded the
// old count. A module-level counter keeps the sequence strictly increasing
// across sessions.
let ttsPositionSequence = 0;

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
  onSectionChange?: (sectionIndex: number) => Promise<void>;
  #nossmlCnt: number = 0;
  #currentSpeakAbortController: AbortController | null = null;
  #currentSpeakPromise: Promise<void> | null = null;

  #ttsSectionIndex: number = -1;

  // Word-level highlight state for the currently spoken chunk. Armed by a
  // successful dispatchSpeakMark, populated by prepareSpeakWords when a TTS
  // client has word-boundary metadata for the chunk.
  #speakWordsArmed = false;
  #speakWordBaseRange: Range | null = null;
  #speakWordOffsets: (TTSWordOffset | null)[] = [];
  #speakWordRanges: (Range | null | undefined)[] = [];
  #suppressMarkHighlight = false;
  // True while the current chunk is highlighted word-by-word, with the most
  // recently highlighted word range. Lets re-highlights (e.g. on page relocate)
  // re-apply the word instead of redrawing the whole sentence over it.
  #wordHighlightActive = false;
  #lastSpeakWordRange: Range | null = null;

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
    onSectionChange?: (sectionIndex: number) => Promise<void>,
  ) {
    super();
    this.ttsWebClient = new WebSpeechClient(this);
    this.ttsEdgeClient = new EdgeTTSClient(this, appService);
    // TODO: implement native TTS client for iOS and PC
    if (appService?.isAndroidApp) {
      this.ttsNativeClient = new NativeTTSClient(this);
    }
    this.ttsClient = this.ttsWebClient;
    this.appService = appService;
    this.view = view;
    this.isAuthenticated = isAuthenticated;
    this.preprocessCallback = preprocessCallback;
    this.onSectionChange = onSectionChange;
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

  #getPrimaryContent() {
    const contents = this.view.renderer.getContents();
    const primaryIndex = this.view.renderer.primaryIndex;
    return (contents.find((x) => x.index === primaryIndex) ?? contents[0]) as
      | {
          doc: Document;
          index?: number;
          overlayer?: Overlayer;
        }
      | undefined;
  }

  #getHighlighter() {
    return (range: Range) => {
      // Suppress the sentence highlight that foliate's setMark draws when the
      // active client highlights word-by-word. The flag is only set around the
      // synchronous setMark call, so word draws (dispatchSpeakWord) and paused
      // navigation still highlight normally.
      if (this.#suppressMarkHighlight) return;
      const content = this.#getPrimaryContent();
      if (!content) return;
      const { doc, index, overlayer } = content;
      if (!doc || index === undefined || index !== this.#ttsSectionIndex) {
        return;
      }
      try {
        const cfi = this.view.getCFI(index, range);
        const visibleRange = this.view.resolveCFI(cfi).anchor(doc);
        const { style, color } = this.options;
        overlayer?.remove(HIGHLIGHT_KEY);
        overlayer?.add(HIGHLIGHT_KEY, visibleRange, Overlayer[style], { color });
      } catch (e) {
        console.error('Failed to highlight range', e);
      }
    };
  }

  #clearHighlighter() {
    const content = this.#getPrimaryContent();
    const overlayer = content?.overlayer as Overlayer | undefined;
    overlayer?.remove(HIGHLIGHT_KEY);
  }

  updateHighlightOptions(options: TTSHighlightOptions) {
    this.options.style = options.style;
    this.options.color = options.color;
  }

  async initViewTTS(index?: number) {
    if (this.#ttsSectionIndex === -1) {
      const fromSectionIndex = (index || this.#getPrimaryContent()?.index) ?? 0;
      await this.#initTTSForSection(fromSectionIndex);
    }
  }

  async #initTTSForSection(sectionIndex: number): Promise<boolean> {
    const sections = this.view.book.sections;
    if (!sections || sectionIndex < 0 || sectionIndex >= sections.length) {
      return false;
    }

    const section = sections[sectionIndex];
    if (!section?.createDocument) {
      return false;
    }

    this.#ttsSectionIndex = sectionIndex;

    const currentSection = this.#getPrimaryContent();
    if (currentSection?.index !== sectionIndex) {
      await this.onSectionChange?.(sectionIndex);
    }

    let doc: Document;
    if (currentSection?.index === sectionIndex && currentSection?.doc) {
      doc = currentSection.doc;
    } else {
      doc = await section.createDocument();
      const html = doc.querySelector('html');
      const lang = html?.getAttribute('lang') || html?.getAttribute('xml:lang') || '';
      if (html && !isValidLang(lang) && this.ttsLang) {
        html.setAttribute('lang', this.ttsLang);
        html.setAttribute('xml:lang', this.ttsLang);
      }
    }

    if (this.view.tts && this.view.tts.doc === doc) {
      return true;
    }

    const { TTS } = await import('foliate-js/tts.js');
    const { textWalker } = await import('foliate-js/text-walker.js');
    let granularity: TTSGranularity = this.view.language.isCJK ? 'sentence' : 'word';
    const supportedGranularities = this.ttsClient.getGranularities();
    if (!supportedGranularities.includes(granularity)) {
      granularity = supportedGranularities[0]!;
    }

    this.view.tts = new TTS(
      doc,
      textWalker,
      createRejectFilter({
        tags: ['rt', 'canvas', 'br'],
        // Footnotes/endnotes are hidden in the rendered page (see the
        // `.epubtype-footnote`/`aside[epub|type]` rules in getPageLayoutStyles);
        // skip them in TTS too, including for background sections whose
        // documents are loaded without those styles.
        classes: [
          'annotationLayer',
          'epubtype-footnote',
          'duokan-footnote-content',
          'duokan-footnote-item',
        ],
        attributeTokens: [
          {
            tag: 'aside',
            attribute: 'epub:type',
            tokens: ['footnote', 'endnote', 'note', 'rearnote'],
          },
        ],
        contents: [{ tag: 'a', content: /^[\[\(]?[\*\d]+[\)\]]?$/ }],
      }),
      this.#getHighlighter(),
      granularity,
    );
    console.log(`[TTS] Initialized TTS for section ${sectionIndex}`);

    return true;
  }

  async #initTTSForNextSection(): Promise<boolean> {
    const nextIndex = this.#ttsSectionIndex + 1;
    const sections = this.view.book.sections;

    if (!sections || nextIndex >= sections.length) {
      return false;
    }

    return await this.#initTTSForSection(nextIndex);
  }

  async #initTTSForPrevSection(): Promise<boolean> {
    const prevIndex = this.#ttsSectionIndex - 1;

    if (prevIndex < 0) {
      return false;
    }

    return await this.#initTTSForSection(prevIndex);
  }

  async #handleNavigationWithSSML(ssml: string | undefined, isPlaying: boolean) {
    if (isPlaying) {
      this.#speak(ssml);
    } else {
      if (ssml) {
        const { marks } = parseSSMLMarks(ssml);
        if (marks.length > 0) {
          this.dispatchSpeakMark(marks[0]);
        }
      }
    }
  }

  async #handleNavigationWithoutSSML(initSection: () => Promise<boolean>, isPlaying: boolean) {
    if (await initSection()) {
      if (isPlaying) {
        this.#speak(this.view.tts?.start());
      } else {
        this.view.tts?.start();
      }
    } else {
      await this.stop();
    }
  }

  async preloadSSML(ssml: string | undefined, signal: AbortSignal) {
    if (!ssml) return;
    const iter = await this.ttsClient.speak(ssml, signal, true);
    for await (const _ of iter);
  }

  async preloadNextSSML(count: number = 4) {
    const tts = this.view.tts;
    if (!tts) return;

    // Gather all next SSMLs and rewind synchronously to avoid a race condition:
    // tts.next() replaces TTS.#ranges (used by setMark() during playback).
    // If async gaps exist between next()/prev() calls, a concurrent #speak()
    // can dispatch marks against the wrong #ranges, causing incorrect highlights
    // and accidental page turns.
    const rawSsmls: string[] = [];
    for (let i = 0; i < count; i++) {
      const ssml = tts.next();
      if (!ssml) break;
      rawSsmls.push(ssml);
    }
    for (let i = 0; i < rawSsmls.length; i++) {
      tts.prev();
    }

    const ssmls: string[] = [];
    for (const raw of rawSsmls) {
      const ssml = await this.#preprocessSSML(raw);
      if (!ssml) break;
      ssmls.push(ssml);
    }
    await Promise.all(ssmls.map((ssml) => this.preloadSSML(ssml, new AbortController().signal)));
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
        console.log('[TTS] speak');
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
            if (await this.#initTTSForNextSection()) {
              await this.forward();
            } else {
              await this.stop();
            }
          }
          console.log('[TTS] no SSML, skipping for', this.#nossmlCnt);
          return;
        } else {
          this.#nossmlCnt = 0;
        }

        const { plainText, marks } = parseSSMLMarks(ssml);
        if (!oneTime) {
          if (!plainText || marks.length === 0) {
            resolve();
            return await this.forward();
          } else {
            this.dispatchSpeakMark(marks[0]);
          }
          await this.preloadSSML(ssml, signal);
        }
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

  async speak(ssml: string | Promise<string>, oneTime = false, oneTimeCallback?: () => void) {
    await this.initViewTTS();
    this.#speak(ssml, oneTime)
      .then(() => {
        if (oneTime && oneTimeCallback) {
          oneTimeCallback();
        }
      })
      .catch((e) => this.error(e));
    if (!oneTime) {
      this.preloadNextSSML();
      this.dispatchSpeakMark();
    }
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
    // Always resume from the current list position instead of calling tts.start().
    // tts.start() resets the TTS list to position 0 (section beginning), which is
    // wrong when state transiently becomes 'stopped' during forward()/backward()
    // — a fast play tap in that window would otherwise jump back to section start.
    // tts.resume() falls back to tts.next() on a fresh TTS, so it's safe at init.
    const ssml = this.view.tts?.resume();
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
    const isPlaying = this.state === 'playing';
    await this.stop();
    if (!isPlaying) this.state = 'backward-paused';

    const ssml = byMark ? this.view.tts?.prevMark(!isPlaying) : this.view.tts?.prev(!isPlaying);
    if (!ssml) {
      await this.#handleNavigationWithoutSSML(() => this.#initTTSForPrevSection(), isPlaying);
    } else {
      await this.#handleNavigationWithSSML(ssml, isPlaying);
    }
  }

  // goto next mark/paragraph
  async forward(byMark = false) {
    await this.initViewTTS();
    const isPlaying = this.state === 'playing';
    await this.stop();
    if (!isPlaying) this.state = 'forward-paused';

    const ssml = byMark ? this.view.tts?.nextMark(!isPlaying) : this.view.tts?.next(!isPlaying);
    if (!ssml) {
      await this.#handleNavigationWithoutSSML(() => this.#initTTSForNextSection(), isPlaying);
    } else {
      await this.#handleNavigationWithSSML(ssml, isPlaying);
    }
    if (isPlaying && !byMark) this.preloadNextSSML();
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

  getSpokenSentence(): { cfi: string; text: string } | null {
    const range = this.view.tts?.getLastRange();
    if (!range || this.#ttsSectionIndex < 0) return null;
    try {
      const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
      const text = range.toString().trim();
      if (!cfi || !text) return null;
      return { cfi, text };
    } catch {
      return null;
    }
  }

  // Canonical position signal emitted from the same paths as
  // tts-highlight-mark / tts-highlight-word. The controller is the source of
  // truth (it owns the section index and current word/sentence CFI).
  #dispatchPosition(cfi: string, kind: 'word' | 'sentence') {
    this.dispatchEvent(
      new CustomEvent('tts-position', {
        detail: {
          cfi,
          kind,
          sectionIndex: this.#ttsSectionIndex,
          sequence: ++ttsPositionSequence,
        },
      }),
    );
  }

  dispatchSpeakMark(mark?: TTSMark) {
    this.#resetSpeakWords();
    this.dispatchEvent(new CustomEvent('tts-speak-mark', { detail: mark || { text: '' } }));
    if (mark && mark.name !== '-1') {
      try {
        // When the active client highlights word-by-word, suppress the
        // sentence highlight that setMark would otherwise draw, so the page
        // doesn't flash the whole sentence before the first word. The fallback
        // (no boundaries) is drawn later in prepareSpeakWords.
        this.#suppressMarkHighlight = this.ttsClient.supportsWordBoundaries();
        const range = this.view.tts?.setMark(mark.name);
        this.#suppressMarkHighlight = false;
        this.#speakWordsArmed = !!range;
        const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
        this.dispatchEvent(new CustomEvent('tts-highlight-mark', { detail: { cfi } }));
        this.#dispatchPosition(cfi, 'sentence');
      } catch {
        this.#suppressMarkHighlight = false;
      }
    }
  }

  #resetSpeakWords() {
    this.#speakWordsArmed = false;
    this.#speakWordBaseRange = null;
    this.#speakWordOffsets = [];
    this.#speakWordRanges = [];
    this.#wordHighlightActive = false;
    this.#lastSpeakWordRange = null;
  }

  // Re-apply the active highlight after the view relocates (page turn,
  // re-render). In word mode this re-draws the current word so the sentence
  // never reappears over it; otherwise it re-draws the sentence.
  reapplyCurrentHighlight() {
    if (this.#wordHighlightActive && this.#lastSpeakWordRange) {
      this.#getHighlighter()(this.#lastSpeakWordRange.cloneRange());
      return;
    }
    const range = this.view.tts?.getLastRange();
    if (range) this.#getHighlighter()(range.cloneRange());
  }

  // CFI of the currently highlighted word during word-by-word playback. Used
  // for the "in view" check that drives the back-to-TTS button: when a sentence
  // spans a page break, the word can be on a different page than the sentence's
  // ttsLocation, so the word position is the accurate reference. Returns null
  // outside word mode, where the sentence-level ttsLocation is correct.
  getCurrentHighlightCfi(): string | null {
    if (!this.#wordHighlightActive || !this.#lastSpeakWordRange || this.#ttsSectionIndex < 0) {
      return null;
    }
    try {
      return this.view.getCFI(this.#ttsSectionIndex, this.#lastSpeakWordRange) || null;
    } catch {
      return null;
    }
  }

  // Re-emit the controller's current position on the canonical 'tts-position'
  // signal with a fresh (monotonic) sequence. Lets a follower that engages
  // mid-session (paragraph / RSVP mode entered while TTS is already playing or
  // paused) sync to the current position without waiting for the next word or
  // sentence boundary. Mirrors reapplyCurrentHighlight's word-vs-sentence
  // choice, but dispatches a position instead of drawing a highlight.
  redispatchPosition() {
    if (this.#ttsSectionIndex < 0) return;
    if (this.#wordHighlightActive && this.#lastSpeakWordRange) {
      try {
        const cfi = this.view.getCFI(this.#ttsSectionIndex, this.#lastSpeakWordRange);
        if (cfi) {
          this.#dispatchPosition(cfi, 'word');
          return;
        }
      } catch {}
    }
    const range = this.view.tts?.getLastRange();
    if (!range) return;
    try {
      const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
      if (cfi) this.#dispatchPosition(cfi, 'sentence');
    } catch {}
  }

  // Word-level highlighting within the chunk of the last dispatched mark,
  // driven by TTS clients that report word boundaries (Edge TTS). It only
  // swaps the visual highlight from the sentence to the spoken word —
  // ttsLocation, media-session metadata and mark navigation keep their
  // sentence-level semantics.
  prepareSpeakWords(words: string[]) {
    if (!this.#speakWordsArmed) return;
    const range = this.view.tts?.getLastRange();
    if (!range) return;
    this.#speakWordBaseRange = range;
    const matchText = rangeTextExcludingInert(range);
    this.#speakWordOffsets = computeWordOffsets(matchText, words);
    this.#speakWordRanges = [];
    if (process.env.NODE_ENV !== 'production') {
      // Dev-only trace of the Edge word-sync: each spoken (boundary) word vs the
      // text it actually highlights. A drifted or "(unmatched)" mapping — or an
      // empty word list — pinpoints word-highlight bugs without instrumenting
      // the overlayer by hand. `process.env.NODE_ENV` is statically inlined, so
      // this whole block is dropped from production builds.
      const mapping = words.map((word, i) => {
        const offset = this.#speakWordOffsets[i];
        const highlighted = offset
          ? getTextSubRange(range, offset.start, offset.end)?.toString()
          : '';
        return { spoken: word, highlighted: highlighted || '(unmatched)' };
      });
      console.log('[TTS] word-sync', { sentence: matchText, words: mapping });
    }
    if (words.length === 0) {
      // No word boundaries for this chunk: the sentence highlight was
      // suppressed at mark dispatch, so draw it now as the fallback.
      this.#wordHighlightActive = false;
      this.#getHighlighter()(range.cloneRange());
    } else {
      // Highlight the first word immediately so the suppressed sentence
      // highlight never appears before playback reaches the first boundary.
      this.#wordHighlightActive = true;
      this.dispatchSpeakWord(0);
    }
  }

  dispatchSpeakWord(index: number) {
    const base = this.#speakWordBaseRange;
    if (!base) return;
    let range = this.#speakWordRanges[index];
    if (range === undefined) {
      const offset = this.#speakWordOffsets[index];
      range = offset ? getTextSubRange(base, offset.start, offset.end) : null;
      this.#speakWordRanges[index] = range;
    }
    if (range) {
      this.#lastSpeakWordRange = range;
      this.#getHighlighter()(range.cloneRange());
      // Let the view follow the spoken word so it turns the page mid-sentence
      // when the word crosses a page boundary, instead of waiting for the next
      // sentence's mark.
      try {
        const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
        if (cfi) {
          this.dispatchEvent(new CustomEvent('tts-highlight-word', { detail: { cfi } }));
          this.#dispatchPosition(cfi, 'word');
        }
      } catch {}
    }
  }

  error(e: unknown) {
    // AbortError is expected during normal stop/restart cycles (rate change,
    // forward/backward, voice change) — on iOS especially, the in-flight
    // audio.play() promise rejects with AbortError after audio.src is reset,
    // and that rejection can leak through one of the .catch chains. Letting it
    // flip state to 'stopped' desyncs the state machine: handleSetRate's
    // `state === 'playing'` check then falls through to a no-op, and #speak's
    // auto-forward gate skips advancing to the next paragraph.
    if (e instanceof Error && (e.name === 'AbortError' || e.message === 'Aborted')) {
      return;
    }
    console.error(e);
    this.state = 'stopped';
  }

  async shutdown() {
    await this.stop();
    this.#clearHighlighter();
    this.#ttsSectionIndex = -1;
    this.view.tts = null;
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
