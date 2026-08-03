import { FoliateView, ViewTTS } from '@/types/view';
import { AppService } from '@/types/system';
import { SectionItem } from '@/libs/document';
import { transformTTSSectionDocument } from './transformDoc';
import { filterSSMLWithLang, parseSSMLMarks } from '@/utils/ssml';
import { Overlayer } from 'foliate-js/overlayer.js';
import {
  TTSGranularity,
  TTSHighlightGranularity,
  TTSHighlightOptions,
  TTSMark,
  TTSVoice,
} from './types';
import { createRejectFilter } from '@/utils/node';
import { WebSpeechClient } from './WebSpeechClient';
import { NativeTTSClient } from './NativeTTSClient';
import { EdgeTTSClient } from './EdgeTTSClient';
import { SectionTimeline, TimelineSentence } from './SectionTimeline';
import { hydrateProvisionalDurations } from './ttsDuration';
import { DownloadableSentence, SectionEnumerator, TTSDownloader } from './TTSDownloader';
import { TTSUtils } from './TTSUtils';
import { TTSClient } from './TTSClient';
import { startAudioKeepAlive, stopAudioKeepAlive } from './WebAudioPlayer';
import { isValidLang } from '@/utils/lang';
import {
  computeWordOffsets,
  getTextSubRange,
  rangeTextExcludingInert,
  TTSWordOffset,
} from './wordHighlight';
import {
  findNarratedSection,
  hasMediaOverlays,
  loadMediaOverlaySection,
  MediaOverlayClient,
  MediaOverlaySection,
  MediaOverlayTTS,
  MEDIA_OVERLAY_VOICE_ID,
} from './mediaOverlay';

// App-wide monotonic sequence for 'tts-position' events. A fresh TTSController
// is constructed per `tts-speak`, so a per-instance counter would restart at 0
// and consumers (paragraph mode, RSVP) holding `lastSequenceSeen` from a prior
// session would drop the new session's early positions until they exceeded the
// old count. A module-level counter keeps the sequence strictly increasing
// across sessions.
let ttsPositionSequence = 0;

// Native TTS (Android System TTS / iOS) can report a terminal 'error' for an
// utterance it cannot synthesize offline — typically a specific unsupported
// character, hit characteristically on the first utterance after a chapter
// boundary even with a local/offline voice (online the engine often
// network-falls-back, which is why it only breaks offline). #speak only
// auto-advances on 'end', so without handling, a single such error dead-ends
// playback and wedges the controls in 'playing'. Re-speaking the same text
// would just fail again, so we skip the bad chunk and advance — bounding
// consecutive failures so a wholly-unusable engine still stops gracefully
// instead of silently racing to the end of the book. See #4613, #4408.
const TTS_NATIVE_SPEAK_MAX_CONSECUTIVE_ERRORS = 5;

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
// Scrubber-drag preview overlay. A separate key from the playback highlight:
// while a drag previews a location, playback keeps repainting the spoken
// word/sentence under HIGHLIGHT_KEY, and sharing a key would erase the
// preview on every word boundary.
const SEEK_PREVIEW_KEY = 'tts-seek-preview';

// Hook-supplied callbacks rebound on view attach: the constructor-captured
// closures belong to whichever reader hook created the controller and die
// with it.
export interface TTSViewBindings {
  bookKey: string;
  preprocessCallback?: (ssml: string) => Promise<string>;
  onSectionChange?: (sectionIndex: number) => Promise<void>;
}

// Node filter shared by the live TTS instance and the timeline enumeration —
// the two MUST segment identically or timeline sentences drift from marks.
const createTTSNodeFilter = () =>
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
  });

// Silence inserted between paragraphs when auto-advancing during continuous
// playback. Unlike the Edge-only inter-sentence gap, this applies to every
// TTS client: the paragraph-to-paragraph transition (stop -> next -> speak)
// is engine-agnostic, handled entirely in #speak()/forward() below. There is
// no natural pause here otherwise -- the transition is as fast as the async
// stop/init overhead allows, which reads as no pause at all.
export const DEFAULT_PARAGRAPH_GAP_SEC = 0.3;

export class TTSController extends EventTarget {
  appService: AppService | null = null;
  view: FoliateView;
  // The owning reader's book key, bound (and re-bound) by attachView; the
  // per-book TTS cache derives its book hash from it.
  bookKey?: string;
  isAuthenticated: boolean = false;
  preprocessCallback?: (ssml: string) => Promise<string>;
  onSectionChange?: (sectionIndex: number) => Promise<void>;
  // When true, the speak loop pauses at the end of the current chapter/section
  // instead of auto-advancing into the next one - driven by TTSSessionManager's
  // "stop at end of chapter" sleep-timer mode. Gates only the loop's own
  // continuation (see forward()'s isAutoAdvance), never user navigation.
  stopAtChapterEnd: boolean = false;
  #paragraphGapSec: number = DEFAULT_PARAGRAPH_GAP_SEC;
  #nossmlCnt: number = 0;
  // Consecutive native-TTS utterances that ended in a terminal 'error' without
  // a successful 'end' in between. Reset on success; caps skip-on-error so a
  // wholly-unusable engine stops instead of racing to the book end. See #4613.
  #consecutiveSpeakErrors: number = 0;
  #currentSpeakAbortController: AbortController | null = null;
  #currentSpeakPromise: Promise<void> | null = null;

  #ttsSectionIndex: number = -1;

  // Virtual section timeline for position/duration/seek (Edge client only).
  // Built lazily OFF the playback critical path: enumerating a 2000-sentence
  // chapter must never delay first audio.
  #sectionTimeline: SectionTimeline | null = null;
  #timelineSectionIndex: number = -1;
  #currentSentenceIndex: number = -1;
  #ttsDoc: Document | null = null;
  #ttsGranularity: TTSGranularity = 'sentence';

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
  // User-chosen highlight granularity. 'word' (default) highlights word-by-word
  // when the active client reports word boundaries (Edge); 'sentence' keeps the
  // highlight at the sentence level even then. Sentence highlighting is assumed
  // supported by every client, so 'word' falls back to it automatically.
  #highlightGranularity: TTSHighlightGranularity = 'word';

  #state: TTSState = 'stopped';
  #terminated = false;
  // View attachment: false while the session runs headless (book closed).
  // The epoch invalidates in-flight attachView calls when a detach (or a
  // newer attach) supersedes them.
  #attached = true;
  #attachEpoch = 0;
  // Controller-owned foliate TTS text instance. view.close() nulls view.tts,
  // so the controller keeps its own handle (mirrored to view.tts while a view
  // is attached, for external consumers).
  #tts: FoliateView['tts'] = null;
  // Narration index for the current section, present only while playing the
  // book's own recording.
  #mediaOverlaySection: MediaOverlaySection | null = null;
  #useNarration = true;

  ttsLang: string = '';
  ttsRate: number = 1.0;
  ttsClient: TTSClient;
  ttsWebClient: TTSClient;
  ttsEdgeClient: EdgeTTSClient;
  ttsNativeClient: TTSClient | null = null;
  ttsMediaOverlayClient: MediaOverlayClient;
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
    // Native TTS is backed by Android TextToSpeech and iOS AVSpeechSynthesizer.
    // TODO: implement native TTS client for desktop platforms.
    if (appService?.isAndroidApp || appService?.isIOSApp) {
      this.ttsNativeClient = new NativeTTSClient(this);
    }
    this.ttsMediaOverlayClient = new MediaOverlayClient(this);
    this.ttsClient = this.ttsWebClient;
    this.appService = appService;
    this.view = view;
    this.isAuthenticated = isAuthenticated;
    this.preprocessCallback = preprocessCallback;
    this.onSectionChange = onSectionChange;
  }

  get state(): TTSState {
    return this.#state;
  }

  // The state value is a TRANSIT signal ('stopped' occurs on every paragraph
  // advance and across chapter transitions) — listeners must never infer
  // session death from it; that is what 'tts-session-ended' is for. Dispatch
  // is deferred to a microtask so listeners never run re-entrantly inside
  // stop()/error().
  set state(value: TTSState) {
    if (this.#state === value) return;
    this.#state = value;
    queueMicrotask(() => {
      this.dispatchEvent(new CustomEvent('tts-state-change', { detail: { state: value } }));
    });
  }

  // True once the session reached a terminal condition (end of content or
  // unrecoverable error). Rate/voice/navigation restarts never set this.
  get terminated(): boolean {
    return this.#terminated;
  }

  // The live text instance: prefer the view's mirror (the public surface
  // external callers use) and fall back to the controller-owned handle once
  // view.close() nulls the mirror.
  #getTts(): FoliateView['tts'] {
    return this.view?.tts ?? this.#tts;
  }

  #terminate(reason: 'ended' | 'error') {
    if (this.#terminated) return;
    this.#terminated = true;
    stopAudioKeepAlive();
    queueMicrotask(() => {
      this.dispatchEvent(new CustomEvent('tts-session-ended', { detail: { reason } }));
    });
  }

  // A direct-speak engine (Android system TTS) renders its audio in the OS, not
  // the WebView, and advances sentence-to-sentence from JS timers here. With the
  // screen locked the hidden WebView would be throttled/frozen and that loop
  // stalls — so keep an inaudible tone playing to hold the page "audible" and
  // its timers alive, exactly the exemption Edge/WebAudio playback earns for
  // free. Android-only (iOS drives playout through its own native audio
  // session); a no-op for buffered engines that already emit audible output.
  // See #4408.
  #syncNativeAudioKeepAlive() {
    const needsKeepAlive =
      !!this.appService?.isAndroidApp && this.ttsClient.getCapabilities().mediaClock === false;
    if (needsKeepAlive) {
      startAudioKeepAlive();
    } else {
      stopAudioKeepAlive();
    }
  }

  get isViewAttached(): boolean {
    return this.#attached;
  }

  // Enter headless mode. Audio, the abort signal, and the in-flight speak
  // generator are untouched: only layout-dependent work stops. The old view
  // object is retained as a pure book handle (view.close() destroys the
  // renderer but keeps view.book, and getCFI/resolveCFI are book+range math).
  detachView(): void {
    this.#attached = false;
    this.#attachEpoch++;
    // The unmounted hook's closures read wiped stores; running them headless
    // crashes the speak loop (e.g. proofread preprocessing on a cleared
    // viewSettings). Severed here, rebound by attachView.
    this.preprocessCallback = undefined;
    this.onSectionChange = undefined;
  }

  // Adopt a freshly mounted view without touching in-flight audio. Async prep
  // builds a TTS text instance over the new view's document; the swap itself
  // is synchronous and re-seeds from the OLD instance's cursor at swap time —
  // forward() may have auto-advanced during prep, and a seed captured earlier
  // would replay the previous paragraph.
  async attachView(view: FoliateView, bindings: TTSViewBindings): Promise<void> {
    const epoch = ++this.#attachEpoch;
    const oldTts = this.#getTts();
    const sectionIndex = Math.max(this.#ttsSectionIndex, 0);

    // Prep (no controller state mutated): resolve the section document from
    // the new view, preferring its rendered primary content.
    const contents = view.renderer.getContents();
    const primary = contents.find((x) => x.index === view.renderer.primaryIndex) ?? contents[0];
    let doc = primary && (primary.index ?? 0) === sectionIndex ? primary.doc : undefined;
    if (!doc) {
      const section = view.book.sections?.[sectionIndex];
      doc = section?.createDocument
        ? await transformTTSSectionDocument(view.book, section.id, await section.createDocument())
        : undefined;
    }
    if (!doc) {
      console.warn('[TTS] attachView: no document for section', sectionIndex);
      return;
    }
    // Narration segments by SMIL par, so a re-attach during background
    // narration has to rebuild the same kind of source or its marks would name
    // sentences the client cannot resolve to clips.
    let newTts: ViewTTS;
    let narration: MediaOverlaySection | null = null;
    if (this.narrationActive) {
      narration = await loadMediaOverlaySection(view.book, sectionIndex, doc, this.ttsLang);
    }
    if (narration) {
      newTts = new MediaOverlayTTS(doc, narration, this.#getHighlighter());
    } else {
      const { TTS } = await import('foliate-js/tts.js');
      const { textWalker } = await import('foliate-js/text-walker.js');
      newTts = new TTS(
        doc,
        textWalker,
        createTTSNodeFilter(),
        this.#getHighlighter(),
        this.#ttsGranularity,
      );
    }

    // A detach (new view closed) or a newer attach superseded this one.
    if (epoch !== this.#attachEpoch) return;

    // Synchronous swap.
    this.view = view;
    this.bookKey = bindings.bookKey;
    this.preprocessCallback = bindings.preprocessCallback;
    this.onSectionChange = bindings.onSectionChange;
    this.#attached = true;
    const lastRange = oldTts?.getLastRange?.();
    if (lastRange) {
      try {
        // Re-derive the seed NOW: CFIs are valid from the old (content
        // identical) document, and from() needs a range anchored in the new
        // doc (compareBoundaryPoints throws cross-document).
        const cfi = view.getCFI(sectionIndex, lastRange);
        const anchored = view.resolveCFI(cfi).anchor(doc);
        if (anchored) newTts.from(anchored); // position the iterator; discard SSML
      } catch (err) {
        console.warn('[TTS] attachView re-seed failed', err);
      }
    }
    this.#tts = newTts;
    this.view.tts = newTts;
    this.#ttsDoc = doc;
    if (narration) {
      this.#mediaOverlaySection = narration;
      this.ttsMediaOverlayClient.attachBook(view.book);
      this.ttsMediaOverlayClient.setSection(narration);
    }
    // The timeline maps the old document's ranges; rebuild lazily.
    this.#sectionTimeline = null;
    this.#timelineSectionIndex = -1;
    this.#currentSentenceIndex = -1;
    this.reapplyCurrentHighlight();
    this.redispatchPosition();
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

    // A book that ships its own narration should be read by its narrator, not
    // synthesized — that is the whole point of having the recording. The
    // per-book `ttsUseNarration` opt-out (set when the reader picks a synthetic
    // voice for this book) is what overrides it. Deliberately last, so it wins
    // over the globally remembered preferred client.
    if (this.narrationAvailable) {
      this.ttsMediaOverlayClient.attachBook(this.view.book);
      if (this.useNarration && (await this.ttsMediaOverlayClient.init())) {
        this.ttsClient = this.ttsMediaOverlayClient;
      }
    }
  }

  get narrationAvailable(): boolean {
    return this.#attached && hasMediaOverlays(this.view?.book);
  }

  get narrationActive(): boolean {
    return this.ttsClient === this.ttsMediaOverlayClient;
  }

  // Per-book opt-in, defaulting on: only an explicit synthetic-voice choice for
  // this book turns narration off.
  set useNarration(value: boolean) {
    this.#useNarration = value;
  }

  get useNarration(): boolean {
    return this.#useNarration;
  }

  #getPrimaryContent() {
    if (!this.#attached) return undefined;
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

  // The rendered document for a section from ANY live view (the multiview
  // paginator keeps preloaded adjacent sections alive), not just the primary.
  #getLiveSectionDoc(sectionIndex: number): Document | undefined {
    if (!this.#attached) return undefined;
    const contents = this.view.renderer.getContents() as { doc?: Document; index?: number }[];
    return contents.find((x) => x.index === sectionIndex && x.doc)?.doc;
  }

  // A fresh section document replayed through the display transform pipeline
  // (see transformTTSSectionDocument), with the lang fixup TTS voices need.
  async #createSectionDoc(section: SectionItem): Promise<Document> {
    const raw = await section.createDocument();
    const doc = await transformTTSSectionDocument(this.view.book, section.id, raw);
    const html = doc.querySelector('html');
    const lang = html?.getAttribute('lang') || html?.getAttribute('xml:lang') || '';
    if (html && !isValidLang(lang) && this.ttsLang) {
      html.setAttribute('lang', this.ttsLang);
      html.setAttribute('xml:lang', this.ttsLang);
    }
    return doc;
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
        // A stale range (re-applied after a relocate that changed the section
        // content) resolves to nothing in the current doc; overlayer.add would
        // then dereference a null range. Skip instead.
        if (!visibleRange) return;
        const { style, color } = this.options;
        overlayer?.remove(HIGHLIGHT_KEY);
        overlayer?.add(HIGHLIGHT_KEY, visibleRange, Overlayer[style], { color });
      } catch (e) {
        console.error('Failed to highlight range', e);
      }
    };
  }

  // Clear the TTS highlight from EVERY live view, not just the primary one.
  // Preloaded adjacent sections keep their documents (and overlays) alive, so
  // a section change or stop that only clears the primary leaves the last
  // spoken word highlighted in the neighboring view forever.
  #clearAllHighlights() {
    if (!this.#attached) return;
    const contents = this.view.renderer.getContents() as { overlayer?: Overlayer }[];
    for (const { overlayer } of contents) {
      overlayer?.remove(HIGHLIGHT_KEY);
      overlayer?.remove(SEEK_PREVIEW_KEY);
    }
  }

  updateHighlightOptions(options: TTSHighlightOptions) {
    this.options.style = options.style;
    this.options.color = options.color;
  }

  setHighlightGranularity(granularity: TTSHighlightGranularity) {
    this.#highlightGranularity = granularity;
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

    // Captured before #ttsSectionIndex is reassigned below, so the narration
    // retry at the end of this method still knows which way playback is going.
    const direction: 1 | -1 = sectionIndex < this.#ttsSectionIndex ? -1 : 1;

    // Narration exists only where the publisher recorded it; front matter,
    // indexes and notes are routinely left out. Step over those sections in
    // whichever direction playback is moving instead of stalling on silence.
    if (this.narrationActive) {
      const narrated = findNarratedSection(this.view.book, sectionIndex, direction);
      if (narrated === -1) return false;
      sectionIndex = narrated;
    }

    const section = sections[sectionIndex];
    if (!section?.createDocument) {
      return false;
    }

    // Entering a section: drop any highlight left behind in the views that
    // are still rendering the outgoing section.
    this.#clearAllHighlights();

    this.#ttsSectionIndex = sectionIndex;

    const currentSection = this.#getPrimaryContent();
    if (currentSection?.index !== sectionIndex) {
      await this.onSectionChange?.(sectionIndex);
    }

    // Prefer a live rendered document for the section, re-queried AFTER the
    // navigation above (auto-advance lands here with the pre-navigation
    // primary captured, so checking only `currentSection` always missed it):
    // it carries the display transforms and highlights anchor into it by
    // identity. Otherwise replay a fresh document through the same transform
    // pipeline so speech and highlight offsets match the displayed text.
    const doc = this.#getLiveSectionDoc(sectionIndex) ?? (await this.#createSectionDoc(section));

    // The section changed (or is initializing): any previous timeline maps a
    // dead document.
    this.#sectionTimeline = null;
    this.#timelineSectionIndex = -1;
    this.#currentSentenceIndex = -1;
    this.#ttsDoc = doc;

    const existing = this.#getTts();
    if (existing && existing.doc === doc) {
      this.#tts = existing;
      this.view.tts = existing;
      return true;
    }

    if (this.narrationActive) {
      const narration = await loadMediaOverlaySection(
        this.view.book,
        sectionIndex,
        doc,
        this.ttsLang || this.view.language?.canonical || 'en',
      );
      if (narration) {
        this.#mediaOverlaySection = narration;
        this.ttsMediaOverlayClient.setSection(narration);
        this.#ttsGranularity = 'sentence';
        this.#tts = new MediaOverlayTTS(doc, narration, this.#getHighlighter());
        this.view.tts = this.#tts;
        console.log(`[TTS] Initialized narration for section ${sectionIndex}`);
        return true;
      }
      // The section advertised an overlay whose SMIL yielded nothing usable
      // (malformed, or every par pointing at absent ids). Treat it as
      // unnarrated and keep looking; the scan above moves monotonically toward
      // the spine edge, so this terminates.
      console.warn(`[TTS] no usable narration in section ${sectionIndex}`);
      return await this.#initTTSForSection(sectionIndex + direction);
    }

    this.#mediaOverlaySection = null;
    const { TTS } = await import('foliate-js/tts.js');
    const { textWalker } = await import('foliate-js/text-walker.js');
    let granularity: TTSGranularity = this.view.language.isCJK ? 'sentence' : 'word';
    const supportedGranularities = this.ttsClient.getGranularities();
    if (!supportedGranularities.includes(granularity)) {
      granularity = supportedGranularities[0]!;
    }
    this.#ttsGranularity = granularity;

    this.#tts = new TTS(
      doc,
      textWalker,
      createTTSNodeFilter(),
      this.#getHighlighter(),
      granularity,
    );
    this.view.tts = this.#tts;
    console.log(`[TTS] Initialized TTS for section ${sectionIndex}`);

    return true;
  }

  // Rebuild the current section's mark source after switching between the
  // book's narration and synthesized speech — the two segment the section
  // differently, so the instance itself has to be replaced. The reading
  // position is carried across when the range still anchors in the new source's
  // document.
  async #rebuildTextSource(): Promise<void> {
    const sectionIndex = this.#ttsSectionIndex;
    if (sectionIndex < 0) return;
    const lastRange = this.#getTts()?.getLastRange();
    this.#tts = null;
    if (this.#attached) this.view.tts = null;
    this.#ttsSectionIndex = -1;
    this.#sectionTimeline = null;
    this.#timelineSectionIndex = -1;
    this.#currentSentenceIndex = -1;
    if (!(await this.#initTTSForSection(sectionIndex))) return;
    if (!lastRange) return;
    try {
      this.#getTts()?.from(lastRange);
    } catch (err) {
      console.warn('[TTS] could not carry position across the voice change', err);
    }
  }

  // Build (or return) the virtual timeline for the current section. Edge-only:
  // it is the only client with measurable audio durations and a chunk clock.
  // Callers invoke this off the playback path (panel poll, media session).
  async ensureTimeline(): Promise<SectionTimeline | null> {
    if (!this.ttsClient.getCapabilities().mediaClock) return null;
    if (this.#sectionTimeline && this.#timelineSectionIndex === this.#ttsSectionIndex) {
      return this.#sectionTimeline;
    }
    const doc = this.#ttsDoc;
    if (!doc || this.#ttsSectionIndex < 0) return null;
    const sentences: TimelineSentence[] = [];
    if (this.narrationActive) {
      // The recording's own clip boundaries — exact durations, so the scrubber
      // needs no estimation tier at all.
      if (!this.#mediaOverlaySection) return null;
      sentences.push(...this.#mediaOverlaySection.timelineSentences());
    } else {
      const { getSentences } = await import('foliate-js/tts.js');
      const { textWalker } = await import('foliate-js/text-walker.js');
      for (const entry of getSentences(
        doc,
        textWalker,
        createTTSNodeFilter(),
        this.#ttsGranularity,
      )) {
        sentences.push({ ...entry, text: entry.range.toString() });
      }
    }
    const timeline = new SectionTimeline(
      sentences,
      this.ttsLang || 'en',
      this.ttsClient.getVoiceId(),
    );
    timeline.setRate(this.ttsRate);
    this.#sectionTimeline = timeline;
    this.#timelineSectionIndex = this.#ttsSectionIndex;
    // Tell the cache which sentences make up this section (ordinal-keyed);
    // once every ordinal has a recorded synthesis key, the section can be
    // compacted into one pack file.
    this.ttsClient.registerSectionManifest?.(
      this.#ttsSectionIndex,
      sentences.map((s) => `${s.blockIndex}:${s.markName}`),
    );
    // Off the critical path: pull cached per-sentence durations (downloaded
    // or previously played audio) into the duration store, so a fully cached
    // chapter reports a fully measured timeline — without this the buffered
    // bar showed an "unbuffered" tail on downloaded chapters until every
    // sentence had been replayed.
    void this.#hydrateTimelineDurations(timeline, sentences, this.#ttsSectionIndex);
    return timeline;
  }

  async #hydrateTimelineDurations(
    timeline: SectionTimeline,
    sentences: TimelineSentence[],
    sectionIndex: number,
  ): Promise<void> {
    try {
      const durations = await this.ttsClient.getSectionDurations?.(sectionIndex);
      if (!durations?.size) return;
      // A section change or voice switch rebuilt the timeline meanwhile.
      if (this.#sectionTimeline !== timeline) return;
      const applied = hydrateProvisionalDurations(
        this.ttsClient.getVoiceId(),
        sentences,
        durations,
      );
      if (applied > 0) timeline.refresh();
    } catch {
      // Cache is best-effort; the timeline keeps its estimates.
    }
  }

  // Build a downloader for headless pre-synthesis, or null when the Edge
  // client has no cache to download into. The enumerator replays the exact
  // live pipeline (per-block SSML -> preprocess -> parseSSMLMarks) on a FRESH
  // document + TTS instance per section, so it never disturbs live playback,
  // and labels sentences identically to ensureTimeline so packs written here
  // and by playback share one manifest.
  canDownload(): boolean {
    return this.ttsEdgeClient.canDownload();
  }

  getTTSDownloader(): TTSDownloader | null {
    const edge = this.ttsEdgeClient;
    if (!edge.canDownload()) return null;
    const enumerator: SectionEnumerator = {
      enumerateSection: async (sectionIndex: number) => {
        const sections = this.view.book.sections;
        const section = sections?.[sectionIndex];
        if (!section?.createDocument) return null;
        try {
          // Same transformed document as live playback, or the synthesized
          // text (and its cache keys) would diverge from what gets spoken.
          const doc = await this.#createSectionDoc(section);
          const { TTS, getSentences } = await import('foliate-js/tts.js');
          const { textWalker } = await import('foliate-js/text-walker.js');
          const nodeFilter = createTTSNodeFilter();
          let granularity: TTSGranularity = this.view.language.isCJK ? 'sentence' : 'word';
          const supported = edge.getGranularities();
          if (!supported.includes(granularity)) granularity = supported[0]!;

          // getSentences enumerates EVERY segment; parseSSMLMarks drops the
          // ones that carry no speech (punctuation- or symbol-only lines like
          // "* * *", empty separators). The manifest must count only the
          // recordable sentences, or a section with any such separator can
          // never complete. Filter getSentences by the same rule so the
          // meaningful segments line up 1:1 with the marks.
          const isSpeakable = (text: string) => {
            const trimmed = text.trim();
            return trimmed.length > 0 && !/^[\p{P}\p{S}]+$/u.test(trimmed);
          };
          const speakableSegs: { blockIndex: number; markName: string }[] = [];
          for (const entry of getSentences(doc, textWalker, nodeFilter, granularity)) {
            if (isSpeakable(entry.range.toString())) {
              speakableSegs.push({ blockIndex: entry.blockIndex, markName: entry.markName });
            }
          }
          // Per-sentence language + preprocessed text: identical to what
          // playback synthesizes, so the computed cache keys match. A no-op
          // highlighter: this throwaway instance only generates SSML and must
          // never draw on the live view.
          const tts = new TTS(doc, textWalker, nodeFilter, () => {}, granularity);
          const marks: { language: string; text: string }[] = [];
          let raw = tts.start();
          while (raw) {
            const ssml = await this.#preprocessSSML(raw);
            if (ssml) marks.push(...parseSSMLMarks(ssml, this.ttsLang || 'en').marks);
            raw = tts.next();
          }
          // Pair speakable segments with marks in reading order; contiguous
          // ordinals so the manifest is exactly what gets recorded.
          const n = Math.min(speakableSegs.length, marks.length);
          const out: DownloadableSentence[] = [];
          for (let i = 0; i < n; i++) {
            out.push({
              ordinal: i,
              label: `${speakableSegs[i]!.blockIndex}:${speakableSegs[i]!.markName}`,
              lang: marks[i]!.language,
              text: marks[i]!.text,
            });
          }
          return out;
        } catch (err) {
          console.warn('TTS download enumeration failed for section', sectionIndex, err);
          return null;
        }
      },
    };
    return new TTSDownloader(enumerator, edge);
  }

  // Per-section download status keyed by section index, for the podcast UI.
  async getSectionCacheStatuses() {
    return this.ttsEdgeClient.getSectionCacheStatuses();
  }

  async getCacheBytes() {
    return this.ttsEdgeClient.getCacheBytes();
  }

  // Whether the active client can ever produce a timeline — it needs a real
  // audio clock. The scrubber renders a reserved disabled slot while true and
  // info is still null, and hides entirely while false.
  supportsPlaybackInfo(): boolean {
    return this.ttsClient.getCapabilities().mediaClock;
  }

  // Whether the active client supports the inter-sentence gap control.
  supportsGapControl(): boolean {
    return this.ttsClient.getCapabilities().gapControl;
  }

  // Passthrough to the Edge client's inter-sentence gap. ttsEdgeClient is
  // always a constructed instance, whether or not it's the currently active
  // client (same as supportsPlaybackInfo/supportsGapControl's comparison).
  setSentenceGap(sec: number): void {
    this.ttsEdgeClient.setSentenceGap(sec);
  }

  // Universal (not Edge-only) paragraph-to-paragraph gap. See
  // DEFAULT_PARAGRAPH_GAP_SEC and #delayParagraphGap for where it's applied.
  setParagraphGap(sec: number): void {
    this.#paragraphGapSec = sec;
  }

  // Abortable delay inserted before auto-advancing to the next paragraph.
  // Scales with rate like the sentence gap so pauses shrink with speed.
  // Races against `signal` so a stop()/pause() during the gap resolves
  // immediately instead of leaving a stray forward() to fire afterward.
  //
  // Skipped entirely for a continuous timeline (recorded narration): the audio
  // for the next paragraph is the same recording playing on, so padding it adds
  // silence the narrator did not leave and pushes the highlight behind the voice.
  async #delayParagraphGap(signal: AbortSignal): Promise<void> {
    if (this.ttsClient.getCapabilities().continuousTimeline) return;
    const ms = (this.#paragraphGapSec / this.ttsRate) * 1000;
    if (ms <= 0 || signal.aborted) return;
    await new Promise<void>((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  // Position/duration of the current section playback at the current rate.
  // Null while no timeline exists (non-Edge client, timeline not yet built,
  // or nothing located yet) — the UI reserves a disabled slot for that state.
  getPlaybackInfo(): { position: number; duration: number; measuredFraction: number } | null {
    if (!this.ttsClient.getCapabilities().mediaClock) return null;
    const timeline = this.#sectionTimeline;
    if (!timeline || this.#timelineSectionIndex !== this.#ttsSectionIndex) return null;
    const duration = timeline.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) return null;
    let index = this.#currentSentenceIndex;
    if (index < 0) {
      const range = this.#getTts()?.getLastRange();
      index = range ? timeline.indexOfRange(range) : -1;
    }
    if (index < 0) return null;
    const within = this.ttsClient.getChunkPosition?.() ?? 0;
    return {
      position: timeline.positionAt(index, within),
      duration,
      measuredFraction: timeline.getMeasuredFraction(),
    };
  }

  // Live preview of the sentence under a scrubber drag, without touching
  // playback or session state: navigate the view along the same follow path
  // as playback highlights (preview-flagged so it doesn't stamp ttsLocation)
  // and draw a preview overlay at the target sentence. Synchronous on
  // purpose — the scrubber only renders once playback info (and thus the
  // timeline) exists, and a drag fires this at a 100ms cadence.
  previewSeekTime(seconds: number): void {
    if (!this.#attached) return;
    const timeline = this.#sectionTimeline;
    if (!timeline || this.#timelineSectionIndex !== this.#ttsSectionIndex) return;
    const target = timeline.sentenceAtTime(seconds);
    if (!target) return;
    const range = target.sentence.range;
    try {
      const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
      this.dispatchEvent(new CustomEvent('tts-highlight-mark', { detail: { cfi, preview: true } }));
    } catch {}
    this.#drawSeekPreview(range);
  }

  #drawSeekPreview(range: Range) {
    const content = this.#getPrimaryContent();
    if (!content) return;
    const { doc, index, overlayer } = content;
    if (!doc || index === undefined || index !== this.#ttsSectionIndex) return;
    try {
      const cfi = this.view.getCFI(index, range);
      const visibleRange = this.view.resolveCFI(cfi).anchor(doc);
      if (!visibleRange) return;
      const { style, color } = this.options;
      overlayer?.remove(SEEK_PREVIEW_KEY);
      overlayer?.add(SEEK_PREVIEW_KEY, visibleRange, Overlayer[style], { color });
    } catch {}
  }

  clearSeekPreview() {
    if (!this.#attached) return;
    const contents = this.view.renderer.getContents() as { overlayer?: Overlayer }[];
    for (const { overlayer } of contents) {
      overlayer?.remove(SEEK_PREVIEW_KEY);
    }
  }

  // Sentence-snapped seek through the same navigation machinery as prev/next:
  // foliate's from(range) returns the paragraph SSML sliced at the target
  // sentence, so highlighting, page-follow, and mark bookkeeping come free.
  async seekToTime(seconds: number): Promise<void> {
    this.clearSeekPreview();
    await this.initViewTTS();
    const timeline = await this.ensureTimeline();
    if (!timeline) return;
    const target = timeline.sentenceAtTime(seconds);
    if (!target) return;
    const isPlaying = this.state === 'playing';
    // While playing, this is a handover to the utterance about to be spoken
    // below; only a stopped session should actually be silenced here.
    await this.stop(isPlaying);
    if (!isPlaying) this.state = 'forward-paused';
    this.#currentSentenceIndex = target.index;
    const ssml = this.#getTts()?.from(target.sentence.range);
    await this.#handleNavigationWithSSML(ssml, isPlaying);
    if (!isPlaying) this.reapplyCurrentHighlight();
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

  // "Stop at end of chapter" mode: advance into the next section but leave it
  // unspoken. Unlike the duration timer (which means "I'm done" and tears the
  // player down), this mode is for chapter-by-chapter listening, so the panel
  // stays put and Play continues into the chapter now queued up.
  //
  // Two deliberate omissions:
  //   - No tts.start(). #initTTSForNextSection() built a fresh TTS instance
  //     with nothing current yet; priming its first mark here would be
  //     re-read by the tts.resume() that the public start() issues on Play,
  //     leaving the controls "playing" with no audio. Untouched, resume()'s
  //     own nothing-current -> next() fallback bootstraps the first paragraph.
  //   - No pause(). Nothing is speaking at this instant (the previous chunk
  //     finished), so its ttsClient.pause()/stop() fallback is dead weight.
  //     'forward-paused' rather than plain 'paused' because handleTogglePlay
  //     routes exact 'paused' to the lightweight ttsClient.resume() — a no-op
  //     when nothing was ever spoken — and everything else to start().
  //
  // Falls back to a full stop only at end of book, where there is nothing
  // left to pause on.
  async #stopAtChapterBoundary() {
    if (await this.#initTTSForNextSection()) {
      stopAudioKeepAlive();
      this.state = 'forward-paused';
    } else {
      this.#terminate('ended');
      await this.stop();
    }
  }

  async #handleNavigationWithoutSSML(initSection: () => Promise<boolean>, isPlaying: boolean) {
    if (await initSection()) {
      if (isPlaying) {
        this.#speak(this.#getTts()?.start());
      } else {
        this.#getTts()?.start();
      }
    } else {
      // No adjacent section in this direction: the session has run out of
      // content (end of book on forward, start of book on backward).
      this.#terminate('ended');
      await this.stop();
    }
  }

  async preloadSSML(ssml: string | undefined, signal: AbortSignal) {
    if (!ssml) return;
    const iter = await this.ttsClient.speak(ssml, signal, true);
    for await (const _ of iter);
  }

  async preloadNextSSML(count: number = 4) {
    const tts = this.#getTts();
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
    // A handover, not a stop: this clears the previous utterance so the next one
    // can start. Recorded narration stays rolling through it, because the next
    // utterance is the same recording playing on.
    await this.stop(true);
    this.#terminated = false;
    this.#currentSpeakAbortController = new AbortController();
    const { signal } = this.#currentSpeakAbortController;

    this.#currentSpeakPromise = new Promise(async (resolve, reject) => {
      try {
        console.log('[TTS] speak');
        this.state = 'playing';
        this.#syncNativeAudioKeepAlive();

        signal.addEventListener('abort', () => {
          resolve();
        });

        ssml = await this.#preprocessSSML(await ssml);
        if (!ssml) {
          this.#nossmlCnt++;
          // FIXME: in case we are at the end of the book, need a better way to handle this
          if (this.#nossmlCnt < 10 && this.state === 'playing' && !oneTime) {
            resolve();
            if (this.stopAtChapterEnd) {
              // This branch means the section has nothing (more) to say, so
              // the advance below would cross a chapter boundary on its own -
              // exactly what the mode exists to stop. Reached when Play is
              // pressed on an already-exhausted section (tts.resume() dry),
              // since a natural advance is gated earlier, in forward().
              await this.#stopAtChapterBoundary();
              return;
            }
            if (await this.#initTTSForNextSection()) {
              await this.forward(false, true);
            } else {
              // End of book: nothing left to speak.
              this.#terminate('ended');
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
            return await this.forward(false, true);
          } else {
            this.dispatchSpeakMark(marks[0]);
          }
          await this.preloadSSML(ssml, signal);
        }
        // Only the native client surfaces an offline engine failure as a
        // terminal 'error' code (Edge/Web throw, which the catch below handles).
        const canSkipOnError = this.ttsClient === this.ttsNativeClient;
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
          this.#consecutiveSpeakErrors = 0;
          resolve();
          await this.#delayParagraphGap(signal);
          if (signal.aborted) return;
          await this.forward(false, true);
        } else if (
          lastCode === 'error' &&
          canSkipOnError &&
          !signal.aborted &&
          this.state === 'playing' &&
          !oneTime
        ) {
          // The native engine reported it can't speak this chunk. Offline this
          // is almost always a specific unsynthesizable utterance (e.g. an
          // unsupported character) that would fail every time, not a transient
          // glitch — so retrying the same text is futile. Skip it and advance
          // exactly as a normal 'end' would, so one bad chunk (often the first
          // utterance across a chapter boundary) can't strand playback with the
          // controls wedged in 'playing'. Bound consecutive failures so a
          // wholly-unusable engine stops gracefully instead of silently racing
          // to the end of the book. See #4613, #4408.
          this.#consecutiveSpeakErrors++;
          resolve();
          if (this.#consecutiveSpeakErrors <= TTS_NATIVE_SPEAK_MAX_CONSECUTIVE_ERRORS) {
            await this.forward(false, true);
          } else {
            this.#consecutiveSpeakErrors = 0;
            this.#terminate('error');
            await this.stop();
          }
        } else if (
          lastCode === 'error' &&
          !canSkipOnError &&
          !signal.aborted &&
          this.state === 'playing' &&
          !oneTime
        ) {
          // A buffered client (Edge/Web) reported a synthesis error that
          // survived its retries: offline with this sentence uncached, or a
          // persistent service failure, with no online fallback available.
          // Stop cleanly rather than skip to the end of the book or leave the
          // controls wedged in 'playing'.
          resolve();
          this.#terminate('error');
          await this.stop();
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
    const ssml = this.#getTts()?.resume();
    if (this.state.includes('paused')) {
      this.resume();
    }
    this.#speak(ssml);
    this.preloadNextSSML();
  }

  async pause() {
    this.state = 'paused';
    stopAudioKeepAlive();
    if (!(await this.ttsClient.pause().catch((e) => this.error(e)))) {
      await this.stop();
      this.state = 'stop-paused';
    }
  }

  async resume() {
    this.state = 'playing';
    await this.ttsClient.resume().catch((e) => this.error(e));
  }

  async stop(handover = false) {
    if (this.#currentSpeakAbortController) {
      this.#currentSpeakAbortController.abort();
    }
    await this.ttsClient.stop(handover).catch((e) => this.error(e));

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
    // While playing, this is a handover to the utterance about to be spoken
    // below; only a stopped session should actually be silenced here.
    await this.stop(isPlaying);
    if (!isPlaying) this.state = 'backward-paused';

    const ssml = byMark ? this.#getTts()?.prevMark(!isPlaying) : this.#getTts()?.prev(!isPlaying);
    if (!ssml) {
      await this.#handleNavigationWithoutSSML(() => this.#initTTSForPrevSection(), isPlaying);
    } else {
      await this.#handleNavigationWithSSML(ssml, isPlaying);
    }
  }

  // goto next mark/paragraph. `isAutoAdvance` marks the calls the speak loop
  // makes to continue on its own — the only ones "stop at end of chapter" may
  // gate. A user skip (the next buttons, and the media session's nexttrack /
  // seekforward) lands here too and must always cross the boundary: asking to
  // skip ahead and getting playback stopped instead is the opposite of the
  // request, and on the lock screen there is no obvious way to recover.
  async forward(byMark = false, isAutoAdvance = false) {
    await this.initViewTTS();
    const isPlaying = this.state === 'playing';
    // While playing, this is a handover to the utterance about to be spoken
    // below; only a stopped session should actually be silenced here. This is
    // the auto-advance path, so for recorded narration it is what decides
    // whether every paragraph boundary gets a gap.
    await this.stop(isPlaying);
    if (!isPlaying) this.state = 'forward-paused';

    const ssml = byMark ? this.#getTts()?.nextMark(!isPlaying) : this.#getTts()?.next(!isPlaying);
    if (!ssml) {
      if (isAutoAdvance && isPlaying && this.stopAtChapterEnd) {
        return await this.#stopAtChapterBoundary();
      }
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
    if (this.ttsMediaOverlayClient.initialized) this.ttsMediaOverlayClient.setPrimaryLang(lang);
  }

  async setRate(rate: number) {
    this.state = 'setrate-paused';
    this.ttsRate = rate;
    this.#sectionTimeline?.setRate(rate);
    await this.ttsClient.setRate(this.ttsRate);
  }

  async getVoices(lang: string) {
    const ttsWebVoices = await this.ttsWebClient.getVoices(lang);
    const ttsEdgeVoices = await this.ttsEdgeClient.getVoices(lang);
    const ttsNativeVoices = (await this.ttsNativeClient?.getVoices(lang)) ?? [];
    // The book's own narrator leads the list when there is one: it is the best
    // voice available for that book by a wide margin.
    const narrationVoices = this.narrationAvailable
      ? await this.ttsMediaOverlayClient.getVoices(lang)
      : [];

    const voicesGroups = [
      ...narrationVoices,
      ...ttsNativeVoices,
      ...ttsEdgeVoices,
      ...ttsWebVoices,
    ];
    return voicesGroups;
  }

  async setVoice(voiceId: string, lang: string) {
    this.state = 'setvoice-paused';

    // Switching into or out of narration changes the mark source, not just the
    // engine: the current section's TTS instance has to be rebuilt.
    const wantsNarration = voiceId === MEDIA_OVERLAY_VOICE_ID && this.narrationAvailable;
    if (wantsNarration !== this.narrationActive) {
      this.#useNarration = wantsNarration;
      if (wantsNarration) await this.ttsMediaOverlayClient.init();
      this.ttsClient = wantsNarration ? this.ttsMediaOverlayClient : this.ttsWebClient;
      await this.#rebuildTextSource();
    }
    if (wantsNarration) {
      await this.ttsMediaOverlayClient.setRate(this.ttsRate);
      TTSUtils.setPreferredVoice(this.ttsMediaOverlayClient.name, lang, voiceId);
      this.#sectionTimeline?.setVoice(this.ttsMediaOverlayClient.getVoiceId());
      return;
    }

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
    // A different voice speaks at a different pace: re-estimate the timeline
    // under the new voice (measured durations are keyed per voice already).
    this.#sectionTimeline?.setVoice(this.ttsClient.getVoiceId());
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
    const range = this.#getTts()?.getLastRange();
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

  // Returns where the mark landed on the section timeline (section index +
  // sentence ordinal) when a timeline exists, so the buffered client can
  // record the sentence's cache key against the section manifest.
  // How far through the sentence now sounding, 0..1, or null when the engine
  // has no clock to say. The view uses it to follow the reading position across
  // a page break inside a single sentence.
  getSentenceProgress(): number | null {
    return this.ttsClient.getChunkProgress?.() ?? null;
  }

  dispatchSpeakMark(mark?: TTSMark): { sectionIndex: number; sentenceIndex: number } | null {
    let located: { sectionIndex: number; sentenceIndex: number } | null = null;
    this.#resetSpeakWords();
    this.dispatchEvent(new CustomEvent('tts-speak-mark', { detail: mark || { text: '' } }));
    if (mark && mark.name !== '-1') {
      try {
        // When the active client highlights word-by-word, suppress the
        // sentence highlight that setMark would otherwise draw, so the page
        // doesn't flash the whole sentence before the first word. The fallback
        // (no boundaries) is drawn later in prepareSpeakWords. When the user
        // forces sentence granularity we keep the sentence highlight, so don't
        // suppress it.
        this.#suppressMarkHighlight =
          this.ttsClient.getCapabilities().wordBoundaries && this.#highlightGranularity === 'word';
        const range = this.#getTts()?.setMark(mark.name);
        this.#suppressMarkHighlight = false;
        this.#speakWordsArmed = !!range;
        if (this.#sectionTimeline && range) {
          // Keep the timeline honest as measurements land, then locate the
          // audible sentence for position reporting.
          this.#sectionTimeline.refresh();
          this.#currentSentenceIndex = this.#sectionTimeline.indexOfRange(range);
          if (this.#currentSentenceIndex >= 0) {
            located = {
              sectionIndex: this.#ttsSectionIndex,
              sentenceIndex: this.#currentSentenceIndex,
            };
          }
        }
        const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
        this.dispatchEvent(new CustomEvent('tts-highlight-mark', { detail: { cfi } }));
        this.#dispatchPosition(cfi, 'sentence');
      } catch {
        this.#suppressMarkHighlight = false;
      }
    }
    return located;
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
    if (!this.#attached) return;
    if (this.#wordHighlightActive && this.#lastSpeakWordRange) {
      this.#getHighlighter()(this.#lastSpeakWordRange.cloneRange());
      return;
    }
    // Word mode during playback: between a sentence's mark and its first word
    // boundary there is nothing word-level to re-draw yet, and re-drawing the
    // sentence here is exactly the whole-sentence flash word mode suppresses
    // at setMark. Draw nothing; the next word boundary paints momentarily.
    // Paused/stopped states keep the sentence re-draw (navigation UX).
    if (
      this.state === 'playing' &&
      this.ttsClient.getCapabilities().wordBoundaries &&
      this.#highlightGranularity === 'word'
    ) {
      return;
    }
    const range = this.#getTts()?.getLastRange();
    if (range) this.#getHighlighter()(range.cloneRange());
  }

  // CFI of the currently highlighted word during word-by-word playback. Used
  // for the "in view" check that drives the back-to-TTS button: when a sentence
  // spans a page break, the word can be on a different page than the sentence's
  // ttsLocation, so the word position is the accurate reference. Returns null
  // outside word mode, where the sentence-level ttsLocation is correct.
  // Whether any part of the sentence now sounding is still on the visible page.
  //
  // A sentence can be laid out across a page break, and once the view has
  // followed the voice onto the next page, the sentence's *start* — which is
  // what ttsLocation records — is behind it. Judging by that alone reads as
  // "the reader navigated away" and raises the back-to-position prompt while
  // the reader is in fact looking at the words being spoken. Engines that
  // report words dodge this because their highlight cfi moves with the voice;
  // a phrase-timed recording has no such cfi, so ask the layout instead.
  isSoundingSentenceOnScreen(): boolean {
    if (!this.#attached) return false;
    const range = this.#getTts()?.getLastRange();
    if (!range) return false;
    try {
      const { renderer } = this.view;
      const axis = renderer.sideProp === 'height' ? 'y' : 'x';
      const sizeProp = renderer.sideProp === 'height' ? 'height' : 'width';
      const { start, end } = renderer;
      return [...range.getClientRects()].some(
        (rect) => rect[axis] < end && rect[axis] + rect[sizeProp] > start,
      );
    } catch {
      return false;
    }
  }

  getCurrentHighlightCfi(): string | null {
    if (!this.#attached) return null;
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
    const range = this.#getTts()?.getLastRange();
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
    // User forced sentence-level highlighting: the sentence highlight was drawn
    // at mark dispatch (not suppressed), so there's nothing to do here — leave
    // word mode off even though the client reported word boundaries.
    if (this.#highlightGranularity === 'sentence') return;
    const range = this.#getTts()?.getLastRange();
    if (!range) return;
    this.#speakWordBaseRange = range;
    const matchText = rangeTextExcludingInert(range);
    this.#speakWordOffsets = computeWordOffsets(matchText, words);
    this.#speakWordRanges = [];
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
    this.#terminate('error');
    this.state = 'stopped';
  }

  async shutdown() {
    stopAudioKeepAlive();
    await this.stop();
    this.#clearAllHighlights();
    this.#ttsSectionIndex = -1;
    this.#sectionTimeline = null;
    this.#timelineSectionIndex = -1;
    this.#currentSentenceIndex = -1;
    this.#ttsDoc = null;
    this.#tts = null;
    this.#mediaOverlaySection = null;
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
    if (this.ttsMediaOverlayClient.initialized) {
      await this.ttsMediaOverlayClient.shutdown();
    }
  }
}
