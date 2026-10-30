import { FoliateView, ViewTTS } from '@/types/view';
import { AppService } from '@/types/system';
import type { PageInfo, PairedAudiobook } from '@/types/book';
import { SectionItem } from '@/libs/document';
import { convertFileSrc } from '@tauri-apps/api/core';
import { transformTTSSectionDocument } from './transformDoc';
import { filterSSMLWithLang, parseSSMLMarks, truncateSSMLAfterMark } from '@/utils/ssml';
import * as CFI from 'foliate-js/epubcfi.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import { adjacentChunkAnchor } from 'foliate-js/section-chunks.js';
import {
  MULTILINGUAL_LANG,
  TTSGranularity,
  TTSHighlightGranularity,
  TTSHighlightOptions,
  TTSMark,
  TTSVoice,
} from './types';
import { createTTSNodeFilter } from './nodeFilter';
import { expandRangeOverRuby } from '@/utils/ruby';
import { WebSpeechClient } from './WebSpeechClient';
import { NativeTTSClient } from './NativeTTSClient';
import { EdgeTTSClient } from './EdgeTTSClient';
import { BufferedTTSClient } from './BufferedTTSClient';
import { createBookTTSCacheStore } from './providers/bookCacheStore';
import { CachingProvider } from './providers/cache';
import { ReadestVoiceProvider } from './providers/readest';
import { OpenAICompatibleSpeechProvider } from './providers/openaiCompatible';
import type { CustomTTSService } from '@/types/customTTS';
import { getAccessToken, isCustomTTSAllowed } from '@/utils/access';
import { SectionTimeline, TimelineSentence } from './SectionTimeline';
import { estimateSentenceSeconds, hydrateProvisionalDurations } from './ttsDuration';
import { DownloadableSentence, SectionEnumerator, TTSDownloader } from './TTSDownloader';
import { TTSUtils } from './TTSUtils';
import { TTSClient } from './TTSClient';
import { startAudioKeepAlive, stopAudioKeepAlive } from './WebAudioPlayer';
import { isSameLang, isValidLang } from '@/utils/lang';
import { normalizeLyricText } from '@/utils/ttsLyrics';
import {
  computeWordOffsets,
  getTextSubRange,
  rangeTextExcludingInert,
  TTSWordOffset,
} from './wordHighlight';
import {
  audioType,
  findNarratedSection,
  hasMediaOverlays,
  loadMediaOverlaySection,
  MediaOverlayClient,
  MediaOverlaySection,
  MediaOverlayTTS,
  MEDIA_OVERLAY_VOICE_ID,
} from './mediaOverlay';
import {
  adjacentAudioChapter,
  findPairedAudiobookSection,
  loadPairedAudiobookSection,
  narratedAudioChapters,
  type NarratedAudioChapter,
} from './pairedAudiobook';
import { SKIP_BACKWARD_SEC, SKIP_FORWARD_SEC } from '@/services/playback/playbackSource';
import {
  stripInlineReadingAnnotations,
  stripInlineReadingAnnotationsFromSSML,
} from './inlineAnnotations';

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
// Windowed engines (TTSCapabilities.windowedPrefetch): preload upcoming
// paragraphs until about this much estimated audio, at most this many.
const PRELOAD_AHEAD_SEC = 180;
const PRELOAD_MAX_PARAGRAPHS = 40;
// Preload the next paragraphs this long after a paragraph starts at the latest.
const PRELOAD_NEXT_AFTER_MS = 500;

const isSameRange = (a: Range, b: Range) =>
  a.startContainer.ownerDocument === b.startContainer.ownerDocument &&
  a.compareBoundaryPoints(Range.START_TO_START, b) === 0 &&
  a.compareBoundaryPoints(Range.END_TO_END, b) === 0;

// An engine that does not answer in time (a server that never replies, a
// voice list that never loads) is unavailable for this session: one stuck
// engine must not hold up the others, the player sheet, or the next start.
const ENGINE_INIT_TIMEOUT_MS = 15_000;

const withinEngineTimeout = <T>(work: Promise<T>, fallback: T): Promise<T> =>
  new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ENGINE_INIT_TIMEOUT_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });

type TTSState =
  | 'stopped'
  | 'playing'
  | 'paused'
  | 'stop-paused'
  | 'backward-paused'
  | 'forward-paused'
  | 'setrate-paused'
  | 'setvoice-paused';

// A sentence position for A-B repeat. A CFI rather than a Range: the section's
// document is replaced on re-attach and section changes.
type TTSLoopPoint = { sectionIndex: number; cfi: string };
export type TTSLoopState = 'off' | 'a' | 'ab';

const HIGHLIGHT_KEY = 'tts-highlight';
// Scrubber-drag preview overlay. A separate key from the playback highlight:
// while a drag previews a location, playback keeps repainting the spoken
// word/sentence under HIGHLIGHT_KEY, and sharing a key would erase the
// preview on every word boundary.
const SEEK_PREVIEW_KEY = 'tts-seek-preview';
// The A-B repeat span, tinted under the spoken highlight.
const LOOP_KEY = 'tts-loop';
const LOOP_TINT_OPACITY = '0.12';
// In word mode, the sounding sentence tinted under the spoken word.
const SENTENCE_KEY = 'tts-sentence';
const SENTENCE_TINT_OPACITY = '0.2';

// Hook-supplied callbacks rebound on view attach: the constructor-captured
// closures belong to whichever reader hook created the controller and die
// with it.
export interface TTSViewBindings {
  bookKey: string;
  preprocessCallback?: (ssml: string) => Promise<string>;
  onSectionChange?: (sectionIndex: number) => Promise<void>;
}

// Silence inserted between paragraphs when auto-advancing during continuous
// playback. Unlike the Edge-only inter-sentence gap, this applies to every
// TTS client: the paragraph-to-paragraph transition (stop -> next -> speak)
// is engine-agnostic, handled entirely in #speak()/forward() below. There is
// no natural pause here otherwise -- the transition is as fast as the async
// stop/init overhead allows, which reads as no pause at all.
export const DEFAULT_PARAGRAPH_GAP_SEC = 0.3;

const drawTint = (opacity: string) => (rects: DOMRectList, options: Record<string, unknown>) => {
  const g = Overlayer.highlight(rects, options);
  g.style.opacity = opacity;
  return g;
};
const drawLoopTint = drawTint(LOOP_TINT_OPACITY);
const drawSentenceTint = drawTint(SENTENCE_TINT_OPACITY);

export class TTSController extends EventTarget {
  // PlaybackSource tag: the media bridge and the session manager consume this
  // controller through that seam, and TTS-only consumers narrow back with
  // asTTSController(). See src/services/playback/playbackSource.ts.
  readonly kind = 'tts' as const;
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
  // Word mode tints the sounding sentence under the spoken word. Off on e-ink:
  // a translucent fill is a gray smear there and repaints every sentence.
  sentenceTint: boolean = true;
  // Sentence-by-sentence mode (#5233): park on the next sentence after each
  // one instead of reading on. Like A-B repeat it steps by sentence mark, so a
  // paired audiobook (whose marks are chapters) ignores both.
  pauseAfterSentence: boolean = false;
  #loopA: TTSLoopPoint | null = null;
  #loopB: TTSLoopPoint | null = null;
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
  // Set while an utterance has been handed to the client but no audio has been
  // heard from it yet — synthesis, network, decode, or a recording still
  // loading. The first event the speak() iterator yields IS the first audible
  // chunk (see BufferedTTSClient/MediaOverlayClient), so it is the only signal
  // needed here. Surfaced as isBuffering() for the player's spinner.
  #awaitingAudio = false;
  // Opening paragraphs (raw SSML) of what is read after the current document
  // (the next chunk of a chunked section, else the next section), for preloads
  // across its end; built once per document read.
  #nextOpening: { after: Document | null; ssmls: Promise<string[]> } | null = null;
  // Signal for queued background preloads: a windowed provider keeps them
  // until it aborts, so a voice change or stop must withdraw them.
  #preloadAbort = new AbortController();
  #ttsDoc: Document | null = null;
  // Bumped whenever a different document is read: the lyric sheet's identity,
  // since a section read in chunks changes document but not section index.
  #ttsDocSheet = 0;
  #ttsGranularity: TTSGranularity = 'sentence';
  #skipInlineAnnotations = false;

  // Word-level highlight state for the currently spoken chunk. Armed by a
  // successful dispatchSpeakMark, populated by prepareSpeakWords when a TTS
  // client has word-boundary metadata for the chunk.
  #speakWordsArmed = false;
  #speakWordBaseRange: Range | null = null;
  #speakWordOffsets: (TTSWordOffset | null)[] = [];
  #speakWordRanges: (Range | null | undefined)[] = [];
  #suppressMarkHighlight = false;
  // The mark dispatchSpeakMark last set on the live TTS, so a look-ahead that
  // steps the TTS can put the sentence being read back (#6850).
  #lastSetMark: { name: string; range: Range } | null = null;
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
  #pairedAudiobook: PairedAudiobook | null = null;

  ttsLang: string = '';
  ttsRate: number = 1.0;
  ttsClient: TTSClient;
  ttsWebClient: TTSClient;
  ttsEdgeClient: EdgeTTSClient;
  // Readest Voice (premium, Plus/Pro): never the default engine, only chosen
  // by picking one of its voices.
  ttsReadestClient: BufferedTTSClient;
  #readestProvider: ReadestVoiceProvider;
  // The user's own OpenAI-compatible services (premium, BYOK): like Readest
  // Voice, never the default engine, only chosen by picking one of its voices.
  ttsCustomClient: BufferedTTSClient;
  // Supplied by the reader (setCustomTTSServices) so the controller stays free
  // of store imports.
  #customTTSServices: () => CustomTTSService[] = () => [];
  ttsNativeClient: TTSClient | null = null;
  ttsMediaOverlayClient: MediaOverlayClient;
  ttsWebVoices: TTSVoice[] = [];
  ttsEdgeVoices: TTSVoice[] = [];
  ttsReadestVoices: TTSVoice[] = [];
  ttsCustomVoices: TTSVoice[] = [];
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
    // One per-book cache store for every synthetic engine: they share the
    // book's cache.db (see createBookTTSCacheStore). The book key lands in
    // init(), after this constructor, hence the lazy resolver.
    const cacheStore = createBookTTSCacheStore(
      appService,
      () => this.bookKey?.split('-')[0] || null,
    );
    this.ttsEdgeClient = new EdgeTTSClient(this, appService, cacheStore);
    this.#readestProvider = new ReadestVoiceProvider(this);
    this.ttsReadestClient = new BufferedTTSClient(
      cacheStore ? new CachingProvider(this.#readestProvider, cacheStore) : this.#readestProvider,
      this,
      appService,
    );
    const customProvider = new OpenAICompatibleSpeechProvider(
      () => this.#customTTSServices(),
      async () => isCustomTTSAllowed(await getAccessToken()),
    );
    this.ttsCustomClient = new BufferedTTSClient(
      cacheStore ? new CachingProvider(customProvider, cacheStore) : customProvider,
      this,
      appService,
    );
    // Native TTS is backed by Android TextToSpeech and iOS AVSpeechSynthesizer.
    // TODO: implement native TTS client for desktop platforms.
    if (appService?.isAndroidApp || appService?.isIOSApp) {
      this.ttsNativeClient = new NativeTTSClient(this);
    }
    this.ttsMediaOverlayClient = new MediaOverlayClient(this, appService);
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

  // Keep the hidden WebView schedulable, in the two cases where it would
  // otherwise fall silent and get frozen by Chromium. Android-only (iOS drives
  // playout through its own native audio session).
  //
  //   - Playing a direct-speak engine (Android system TTS): its audio renders
  //     in the OS, not the WebView, and the sentence-to-sentence advance runs
  //     on JS timers here, so the loop stalls once the page is throttled. See
  //     #4408. Buffered engines earn the exemption for free while speaking.
  //
  //   - Paused, whatever the engine: no engine emits audio while paused, and
  //     the media-session play/pause/next handlers live in this page. Let it
  //     freeze and Play from a Bluetooth headset only flips the notification —
  //     the native foreground service answers, the reader never wakes to speak,
  //     and the in-app player drifts out of sync until the app is foregrounded.
  //     See #5561.
  #syncAudioKeepAlive() {
    const directSpeak = this.ttsClient.getCapabilities().mediaClock === false;
    const needsKeepAlive =
      !!this.appService?.isAndroidApp && (directSpeak || this.state.includes('paused'));
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
      narration = await this.#loadNarrationSection(view, sectionIndex, doc);
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
    if (this.#ttsDoc !== doc) this.#ttsDocSheet++;
    this.#ttsDoc = doc;
    if (narration) {
      this.#mediaOverlaySection = narration;
      this.#attachNarrationSource(view.book);
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
    // Started together: each can take seconds (Edge synthesizes a probe
    // sentence, system TTS waits for its voices), and play waits on them all.
    // Results are still taken in priority order.
    const readestReady = withinEngineTimeout(this.ttsReadestClient.init(), false);
    const customReady = withinEngineTimeout(this.ttsCustomClient.init(), false);
    const edgeReady = withinEngineTimeout(this.ttsEdgeClient.init(), false);
    const nativeReady = this.ttsNativeClient
      ? withinEngineTimeout(this.ttsNativeClient.init(), false)
      : undefined;
    const webReady = withinEngineTimeout(this.ttsWebClient.init(), false);
    if (await edgeReady) {
      availableClients.push(this.ttsEdgeClient);
    }
    if (this.ttsNativeClient && (await nativeReady)) {
      availableClients.push(this.ttsNativeClient);
      this.ttsNativeVoices = await withinEngineTimeout(this.ttsNativeClient.getAllVoices(), []);
    }
    if (await webReady) {
      availableClients.push(this.ttsWebClient);
    }
    // Last: Readest Voice is never the default, only a remembered choice.
    const readestOk = await readestReady;
    if (readestOk) {
      availableClients.push(this.ttsReadestClient);
    }
    const customOk = await customReady;
    if (customOk) {
      availableClients.push(this.ttsCustomClient);
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
    // An engine whose init failed or timed out has no voices to list.
    [this.ttsWebVoices, this.ttsEdgeVoices, this.ttsReadestVoices, this.ttsCustomVoices] =
      await Promise.all([
        withinEngineTimeout(this.ttsWebClient.getAllVoices(), []),
        withinEngineTimeout(this.ttsEdgeClient.getAllVoices(), []),
        readestOk ? withinEngineTimeout(this.ttsReadestClient.getAllVoices(), []) : [],
        customOk ? this.ttsCustomClient.getAllVoices() : [],
      ]);

    // A book that ships its own narration should be read by its narrator, not
    // synthesized — that is the whole point of having the recording. The
    // per-book `ttsUseNarration` opt-out (set when the reader picks a synthetic
    // voice for this book) is what overrides it. Deliberately last, so it wins
    // over the globally remembered preferred client.
    if (this.narrationAvailable) {
      this.#attachNarrationSource(this.view.book);
      if (this.useNarration && (await this.ttsMediaOverlayClient.init())) {
        this.ttsClient = this.ttsMediaOverlayClient;
      }
    }
  }

  get narrationAvailable(): boolean {
    return (
      this.#attached &&
      (this.#pairedAudiobookAvailable(this.view?.book) || hasMediaOverlays(this.view?.book))
    );
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

  set pairedAudiobook(value: PairedAudiobook | null | undefined) {
    this.#pairedAudiobook = value ?? null;
  }

  get pairedAudiobook(): PairedAudiobook | null {
    return this.#pairedAudiobook;
  }

  #pairedAudiobookAvailable(book: FoliateView['book'] | null | undefined): boolean {
    return !!(
      this.appService &&
      book &&
      this.#pairedAudiobook &&
      findPairedAudiobookSection(book, this.#pairedAudiobook, 0, 1) >= 0
    );
  }

  #usesPairedAudiobook(book: FoliateView['book']): boolean {
    return this.#pairedAudiobookAvailable(book);
  }

  #attachNarrationSource(book: FoliateView['book']): void {
    if (this.#usesPairedAudiobook(book) && this.#pairedAudiobook && this.appService) {
      const narrator = this.#pairedAudiobook.narrator;
      const source = this.#pairedAudiobook.source;
      if (source?.kind === 'audiobookshelf') {
        // Streamed from the server: the tracks resolve to URLs carrying the
        // live token, and there is no blob to fall back to. Loaded on demand
        // so the server store (and its settings graph) stays out of this
        // module's imports for every other book.
        this.ttsMediaOverlayClient.attachSource({
          ...(narrator ? { narrator } : {}),
          textHighlight: false,
          resolveTracks: async () => {
            const [{ absNarrationTracks }, { getMediaProxyBase }] = await Promise.all([
              import('@/services/audiobook/absPairing'),
              import('@/services/audiobook/mediaProxy'),
            ]);
            return absNarrationTracks(source, await getMediaProxyBase());
          },
          loadBlob: async () => {
            throw new Error('Audiobookshelf server not found');
          },
        });
        return;
      }
      if (source?.kind === 'bookorbit') {
        // Streamed like the above, but the tracks cannot be handed to a media
        // element as URLs at all: BookOrbit marks its audio
        // `Cross-Origin-Resource-Policy: same-origin`, so `loadTrack` fetches
        // each one natively and the composite plays it from a blob.
        this.ttsMediaOverlayClient.attachSource({
          ...(narrator ? { narrator } : {}),
          textHighlight: false,
          resolveTracks: async () =>
            (await import('@/services/bookorbit/narration')).bookOrbitNarrationTracks(source),
          loadTrack: async (path) =>
            (await import('@/services/bookorbit/narration')).loadBookOrbitTrack(path),
          loadBlob: async () => {
            throw new Error('BookOrbit server not found');
          },
        });
        return;
      }
      this.ttsMediaOverlayClient.attachSource({
        ...(narrator ? { narrator } : {}),
        textHighlight: false,
        loadBlob: async (href) => await this.appService!.openFile(href, 'Books'),
        resolveUrl: async (href) => {
          const appService = this.appService!;
          if (appService.appPlatform !== 'tauri' || appService.isMobileApp) return null;
          const path = await appService.resolveFilePath(href, 'Books');
          const { getLocalMediaUrl } = await import('@/services/audiobook/mediaProxy');
          return (await getLocalMediaUrl(path, audioType(href))) ?? convertFileSrc(path);
        },
        resolvePath: async (href) => await this.appService!.resolveFilePath(href, 'Books'),
      });
      return;
    }
    this.ttsMediaOverlayClient.attachBook(book);
  }

  #findNarratedSection(book: FoliateView['book'], from: number, direction: 1 | -1): number {
    if (this.#usesPairedAudiobook(book) && this.#pairedAudiobook) {
      return findPairedAudiobookSection(book, this.#pairedAudiobook, from, direction);
    }
    return findNarratedSection(book, from, direction);
  }

  #loadNarrationSection(
    view: FoliateView,
    sectionIndex: number,
    doc: Document,
  ): Promise<MediaOverlaySection | null> | MediaOverlaySection | null {
    const lang = this.ttsLang || view.language?.canonical || 'en';
    if (this.#usesPairedAudiobook(view.book) && this.#pairedAudiobook) {
      return loadPairedAudiobookSection(view.book, this.#pairedAudiobook, sectionIndex, doc, lang);
    }
    return loadMediaOverlaySection(view.book, sectionIndex, doc, lang);
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
    // As the view does when it renders a page (foliate view.js #onLoad): a page
    // with no lang attribute is read in the book's language, even when it has
    // an xml:lang. Preloads must name the language the live read will, or their
    // audio is cached under keys playback never looks up.
    if (html && !html.getAttribute('lang') && this.view.language?.canonical) {
      html.setAttribute('lang', this.view.language.canonical);
    }
    const lang = html?.getAttribute('lang') || html?.getAttribute('xml:lang') || '';
    if (html && !isValidLang(lang) && this.ttsLang) {
      html.setAttribute('lang', this.ttsLang);
      html.setAttribute('xml:lang', this.ttsLang);
    }
    return doc;
  }

  #getHighlighter() {
    return (range: Range) => {
      if (this.ttsClient.getCapabilities().textHighlight === false) return;
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
        const cfi = this.view.getCFI(index, expandRangeOverRuby(range));
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
      overlayer?.remove(SENTENCE_KEY);
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

  // The user's enabled custom TTS services, read live; set before init().
  setCustomTTSServices(getServices: () => CustomTTSService[]) {
    this.#customTTSServices = getServices;
  }

  setSkipInlineAnnotations(enabled: boolean) {
    if (this.#skipInlineAnnotations === enabled) return;
    this.#skipInlineAnnotations = enabled;
    this.#sectionTimeline = null;
    this.#timelineSectionIndex = -1;
  }

  // The reader's visible section can intentionally diverge from the section
  // queued by Read Aloud (for example while paused at a chapter boundary).
  // Expose the session cursor so player surfaces never have to infer it from
  // reader progress.
  getSectionIndex(): number | null {
    return this.#ttsSectionIndex >= 0 ? this.#ttsSectionIndex : null;
  }

  #setSectionIndex(sectionIndex: number) {
    if (this.#ttsSectionIndex === sectionIndex) return;
    this.#ttsSectionIndex = sectionIndex;
    this.dispatchEvent(
      new CustomEvent('tts-section-change', {
        detail: { sectionIndex },
      }),
    );
  }

  async initViewTTS(index?: number) {
    if (this.#ttsSectionIndex === -1) {
      const fromSectionIndex = (index || this.#getPrimaryContent()?.index) ?? 0;
      await this.#initTTSForSection(fromSectionIndex);
    }
  }

  // Position the text iterator and, for a chapter-only audiobook mapping,
  // carry the current page's proportional offset into the first audio chunk.
  startFromRange(range: Range): string | undefined {
    const tts = this.#getTts();
    const ssml = tts?.from(range);
    if (
      this.ttsClient.getCapabilities().textHighlight === false &&
      tts &&
      'takeStartPosition' in tts
    ) {
      const position = tts.takeStartPosition();
      if (position !== null) this.ttsClient.setNextChunkPosition?.(position);
    }
    return ssml;
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
      const narrated = this.#findNarratedSection(this.view.book, sectionIndex, direction);
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

    this.#setSectionIndex(sectionIndex);

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
    if (this.#ttsDoc !== doc) this.#ttsDocSheet++;
    this.#ttsDoc = doc;

    const existing = this.#getTts();
    if (existing && existing.doc === doc) {
      this.#tts = existing;
      this.view.tts = existing;
      return true;
    }

    if (this.narrationActive) {
      const narration = await this.#loadNarrationSection(this.view, sectionIndex, doc);
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
    // Pin the section this build is FOR. The enumeration below awaits, and a
    // chapter can turn inside that await; committing then would file sentences
    // read out of the old document under the new section's index, which every
    // `#timelineSectionIndex === #ttsSectionIndex` guard would wave through.
    const sectionIndex = this.#ttsSectionIndex;
    if (!doc || sectionIndex < 0) return null;
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
        const text = entry.range.toString();
        sentences.push({
          ...entry,
          text: this.#skipInlineAnnotations ? stripInlineReadingAnnotations(text) : text,
        });
      }
    }
    // The section moved on while this was being enumerated: these sentences
    // belong to a document nobody is reading any more. Drop them; the next
    // caller rebuilds against the section now loaded.
    if (this.#ttsSectionIndex !== sectionIndex || this.#ttsDoc !== doc) return null;
    const timeline = new SectionTimeline(
      sentences,
      this.ttsLang || 'en',
      this.ttsClient.getVoiceId(),
    );
    timeline.setRate(this.ttsRate);
    this.#sectionTimeline = timeline;
    this.#timelineSectionIndex = sectionIndex;
    // Tell the cache which sentences make up this section (ordinal-keyed);
    // once every ordinal has a recorded synthesis key, the section can be
    // compacted into one pack file.
    this.ttsClient.registerSectionManifest?.(
      sectionIndex,
      sentences.map((s) => `${s.blockIndex}:${s.markName}`),
    );
    // Off the critical path: pull cached per-sentence durations (downloaded
    // or previously played audio) into the duration store, so a fully cached
    // chapter reports a fully measured timeline — without this the buffered
    // bar showed an "unbuffered" tail on downloaded chapters until every
    // sentence had been replayed.
    void this.#hydrateTimelineDurations(timeline, sentences, sectionIndex);
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
  // Downloads synthesize with the engine the reader listens with: Readest
  // Voice or a custom service when one is active, Edge otherwise.
  #downloadClient(): BufferedTTSClient {
    if (this.ttsClient === this.ttsReadestClient) return this.ttsReadestClient;
    if (this.ttsClient === this.ttsCustomClient) return this.ttsCustomClient;
    return this.ttsEdgeClient;
  }

  canDownload(): boolean {
    return this.#downloadClient().canDownload();
  }

  getTTSDownloader(): TTSDownloader | null {
    const client = this.#downloadClient();
    if (!client.canDownload()) return null;
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
          const supported = client.getGranularities();
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
    return new TTSDownloader(enumerator, client);
  }

  // Per-section download status keyed by section index, for the podcast UI.
  async getSectionCacheStatuses() {
    return this.#downloadClient().getSectionCacheStatuses();
  }

  async getCacheBytes() {
    return this.#downloadClient().getCacheBytes();
  }

  async beginDownloadSections(sections: number[]) {
    await this.#downloadClient().beginDownloadSections(sections);
  }

  async completeDownloadSections(sections: number[]) {
    await this.#downloadClient().completeDownloadSections(sections);
  }

  async cancelDownloadSections(sections: number[]) {
    await this.#downloadClient().cancelDownloadSections(sections);
  }

  async clearDownloads() {
    await this.#downloadClient().clearDownloads();
  }

  // Whether the active client can ever produce a timeline — it needs a real
  // audio clock. The scrubber renders a reserved disabled slot while true and
  // info is still null, and hides entirely while false.
  supportsPlaybackInfo(): boolean {
    return this.ttsClient.getCapabilities().mediaClock;
  }

  // A recording with chapter-level text timing only (a paired audiobook) has
  // no sentences or paragraphs to step by: its marks ARE chapters, so the
  // sentence step used to skip a whole chapter. The transport moves by audio
  // instead — the small step is the audiobook player's time skip
  // (SKIP_FORWARD_SEC / SKIP_BACKWARD_SEC of recording), the large step walks
  // the reachable audiobook chapters, those a mapped chapter's clip covers
  // (#5863).
  usesAudioTransport(): boolean {
    const capabilities = this.ttsClient.getCapabilities();
    return capabilities.mediaClock && capabilities.textHighlight === false;
  }

  // Whether the active engine aligns audio to the text closely enough to drive
  // the lyric view: a media clock to seek with AND real per-sentence timing.
  // A chapter-only audiobook pairing has the clock but no sentence alignment,
  // so it keeps the plain cover player, as do the direct-speak engines (#5755).
  supportsLyrics(): boolean {
    const capabilities = this.ttsClient.getCapabilities();
    return capabilities.mediaClock && capabilities.textHighlight !== false;
  }

  // The sentences of the section now playing, as display lines. Section-scoped
  // exactly like the scrubber: one chapter is one lyric sheet.
  async getLyrics(): Promise<{ sectionIndex: number; sheet: number; lines: string[] } | null> {
    if (!this.supportsLyrics()) return null;
    const timeline = await this.ensureTimeline();
    if (!timeline || timeline.length === 0) return null;
    const lines: string[] = [];
    for (let i = 0; i < timeline.length; i++) {
      lines.push(normalizeLyricText(timeline.sentenceAt(i)?.text ?? ''));
    }
    return { sectionIndex: this.#ttsSectionIndex, sheet: this.#ttsDocSheet, lines };
  }

  // Ordinal of the sentence now sounding, or -1 while nothing is located —
  // same resolution order as getPlaybackInfo (live index, else the last range).
  getCurrentLyricIndex(): number {
    const timeline = this.#sectionTimeline;
    if (!timeline || this.#timelineSectionIndex !== this.#ttsSectionIndex) return -1;
    if (this.#currentSentenceIndex >= 0) return this.#currentSentenceIndex;
    const range = this.#getTts()?.getLastRange();
    return range ? timeline.indexOfRange(range) : -1;
  }

  // Playing, but nothing audible yet: synthesis, network, decode, or a
  // recording still loading. Drives the spinner in the lyric play button.
  isBuffering(): boolean {
    return this.#awaitingAudio && this.state === 'playing';
  }

  // Start speaking at a lyric line. Unlike the scrubber's seek this always
  // plays — its only caller is the play button on the line under the reader's
  // finger, and that button means "read from here".
  async seekToLyric(index: number): Promise<void> {
    this.clearSeekPreview();
    await this.initViewTTS();
    const timeline = await this.ensureTimeline();
    const sentence = timeline?.sentenceAt(index);
    if (!sentence) return;
    // Same handover rule as seekToTime: a live session hands over to the
    // utterance started below, a parked one is really stopped first.
    await this.stop(this.state === 'playing');
    await this.#resumeAt({ index, withinMediaSec: 0 }, sentence.range, true);
  }

  // Where a lyric line sits in the book, for the page readout on the seek row.
  // Resolved through the same CFI -> location machinery the footer uses, so the
  // number the reader sees while dragging matches the one they left behind.
  async getLyricPage(index: number): Promise<PageInfo | null> {
    const timeline = this.#sectionTimeline;
    if (!timeline || this.#timelineSectionIndex !== this.#ttsSectionIndex) return null;
    const sentence = timeline.sentenceAt(index);
    if (!sentence) return null;
    try {
      const cfi = this.view.getCFI(this.#ttsSectionIndex, sentence.range);
      const progress = await this.view.getCFIProgress(cfi);
      if (!progress) return null;
      // Fixed-layout books count pages by section, matching FooterBar.
      return this.view.book?.rendition?.layout === 'pre-paginated'
        ? progress.section
        : progress.location;
    } catch {
      return null;
    }
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
    this.ttsReadestClient.setSentenceGap(sec);
    this.ttsCustomClient.setSentenceGap(sec);
  }

  // Universal (not Edge-only) paragraph-to-paragraph gap, in wall-clock
  // seconds at the current rate. See DEFAULT_PARAGRAPH_GAP_SEC and
  // #delayParagraphGap for where it's applied.
  setParagraphGap(sec: number): void {
    this.#paragraphGapSec = sec;
    // The buffered client needs it too: it schedules this pause as silence on
    // its own audio clock rather than letting #delayParagraphGap sleep for it.
    this.ttsEdgeClient.setParagraphGap(sec);
    this.ttsReadestClient.setParagraphGap(sec);
    this.ttsCustomClient.setParagraphGap(sec);
  }

  // Abortable delay inserted before auto-advancing to the next paragraph.
  // Already scaled for the rate before it gets here (see scaleGapForRate), so
  // this waits it out as given. Races against `signal` so a stop()/pause()
  // during the gap resolves immediately instead of leaving a stray forward()
  // to fire afterward.
  //
  // Skipped entirely for a continuous timeline (recorded narration): the audio
  // for the next paragraph is the same recording playing on, so padding it adds
  // silence the narrator did not leave and pushes the highlight behind the voice.
  async #delayParagraphGap(signal: AbortSignal): Promise<void> {
    const capabilities = this.ttsClient.getCapabilities();
    if (capabilities.continuousTimeline) return;
    // Already scheduled as silence on the client's own audio clock, with the
    // next paragraph's synthesis and decode running inside it. Sleeping here
    // too would play the pause twice and put that latency back on top (#5750).
    if (capabilities.scheduledGaps) return;
    const ms = this.#paragraphGapSec * 1000;
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
    // A client whose voices load asynchronously resolves its voice only when
    // the first sentence plays, after the timeline was built: measured
    // durations are keyed by that voice. A no-op once they match.
    timeline.setVoice(this.ttsClient.getVoiceId());
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
      // The buffer bar: how far synthesized audio reaches past this sentence.
      measuredFraction: timeline.getBufferedFraction(index),
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
    const range = this.#rangeAtSeekTarget(target.sentence, target.withinMediaSec);
    try {
      const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
      this.dispatchEvent(new CustomEvent('tts-highlight-mark', { detail: { cfi, preview: true } }));
    } catch {}
    this.#drawSeekPreview(range);
  }

  #drawSeekPreview(range: Range) {
    if (this.ttsClient.getCapabilities().textHighlight === false) return;
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

  // A paired audiobook has only chapter-level timing. Convert the scrubber's
  // exact audio offset into the same proportional one-character text location
  // used by live playback, while precisely timed narration stays par-snapped.
  #rangeAtSeekTarget(sentence: TimelineSentence, withinMediaSec: number): Range {
    if (this.ttsClient.getCapabilities().textHighlight !== false) return sentence.range;
    const duration = sentence.duration;
    const length = rangeTextExcludingInert(sentence.range).length;
    if (!duration || !Number.isFinite(duration) || length <= 1) return sentence.range;
    const fraction = Math.min(Math.max(withinMediaSec / duration, 0), 1);
    const offset = Math.min(Math.floor(fraction * length), length - 1);
    return getTextSubRange(sentence.range, offset, offset + 1) ?? sentence.range;
  }

  #dispatchSeekLocation(range: Range) {
    try {
      const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
      this.dispatchEvent(new CustomEvent('tts-highlight-mark', { detail: { cfi } }));
      this.#dispatchPosition(cfi, 'sentence');
    } catch {}
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
    const range = this.#rangeAtSeekTarget(target.sentence, target.withinMediaSec);
    if (
      target.index === this.#currentSentenceIndex &&
      this.ttsClient.getCapabilities().continuousTimeline &&
      (await this.ttsClient.seekToChunkPosition?.(target.withinMediaSec))
    ) {
      this.#dispatchSeekLocation(range);
      return;
    }
    const isPlaying = this.state === 'playing';
    // While playing, this is a handover to the utterance about to be spoken
    // below; only a stopped session should actually be silenced here.
    await this.stop(isPlaying);
    if (!isPlaying) this.state = 'forward-paused';
    await this.#resumeAt(target, range, isPlaying);
  }

  // Continue (or park a paused session) at a timeline target once the current
  // utterance has been stopped.
  async #resumeAt(
    target: { index: number; withinMediaSec: number },
    range: Range,
    isPlaying: boolean,
  ): Promise<void> {
    this.#currentSentenceIndex = target.index;
    const ssml = this.#getTts()?.from(range);
    if (this.ttsClient.getCapabilities().textHighlight === false) {
      this.ttsClient.setNextChunkPosition?.(target.withinMediaSec);
    }
    await this.#handleNavigationWithSSML(ssml, isPlaying);
    if (!isPlaying) this.reapplyCurrentHighlight();
  }

  // Move through the recording by a span of recording seconds. The timeline
  // counts seconds at the playback rate, so the span is scaled back first.
  async #seekBy(seconds: number): Promise<void> {
    await this.initViewTTS();
    await this.ensureTimeline();
    const info = this.getPlaybackInfo();
    if (!info) return;
    await this.seekToTime(info.position + seconds / this.ttsRate);
  }

  // The recording position now sounding: the clip of the current mark plus
  // the clock's offset into it.
  #narrationPosition(): { audioHref: string; seconds: number } | null {
    const timeline = this.#sectionTimeline;
    const section = this.#mediaOverlaySection;
    if (!timeline || !section || this.#timelineSectionIndex !== this.#ttsSectionIndex) return null;
    let index = this.#currentSentenceIndex;
    if (index < 0) {
      const range = this.#getTts()?.getLastRange();
      index = range ? timeline.indexOfRange(range) : -1;
    }
    const par = section.pars[index];
    if (!par) return null;
    return {
      audioHref: par.audioHref,
      seconds: par.clipBegin + (this.ttsClient.getChunkPosition?.() ?? 0),
    };
  }

  // Timeline seconds of a recording position inside the current section, or
  // null when no clip of the section plays it.
  #sectionTimeAt(audioHref: string, seconds: number): number | null {
    const timeline = this.#sectionTimeline;
    const section = this.#mediaOverlaySection;
    if (!timeline || !section) return null;
    const index = section.pars.findIndex(
      (par) => par.audioHref === audioHref && par.clipBegin <= seconds && seconds < par.clipEnd,
    );
    return index < 0 ? null : timeline.positionAt(index, seconds - section.pars[index]!.clipBegin);
  }

  // Skip to the adjacent reachable audiobook chapter (narratedAudioChapters:
  // the ones a mapped chapter's clip covers, often finer than the EPUB's TOC;
  // audio before the first mapped chapter is not among them). A chapter inside
  // the section already playing is a plain seek; one narrated by another
  // section navigates there first — the page turns only when the recording
  // moves to a different mapped chapter.
  async #stepAudioChapter(direction: 1 | -1): Promise<void> {
    await this.initViewTTS();
    await this.ensureTimeline();
    const association = this.#pairedAudiobook;
    const current = this.#narrationPosition();
    if (!association || !current) return;
    const chapters = narratedAudioChapters(this.view.book, association);
    const target = adjacentAudioChapter(chapters, current.audioHref, current.seconds, direction);
    if (!target) return;
    if (target.sectionIndex === this.#ttsSectionIndex) {
      const seconds = this.#sectionTimeAt(target.audioHref, target.chapter.start);
      if (seconds !== null) await this.seekToTime(seconds);
      return;
    }
    const isPlaying = this.state === 'playing';
    await this.stop(isPlaying);
    if (!isPlaying) this.state = direction > 0 ? 'forward-paused' : 'backward-paused';
    if (!(await this.#initTTSForSection(target.sectionIndex))) return;
    await this.#startSectionAt(target, isPlaying);
  }

  async #startSectionAt(target: NarratedAudioChapter, isPlaying: boolean): Promise<void> {
    const timeline = await this.ensureTimeline();
    const seconds = this.#sectionTimeAt(target.audioHref, target.chapter.start);
    const located = seconds === null ? null : timeline?.sentenceAtTime(seconds);
    if (!located) {
      await this.#handleNavigationWithSSML(this.#getTts()?.start(), isPlaying);
      return;
    }
    const range = this.#rangeAtSeekTarget(located.sentence, located.withinMediaSec);
    await this.#resumeAt(located, range, isPlaying);
  }

  // A section too big to lay out whole is rendered in chunks (foliate-js
  // section-chunks.js), and the document read aloud is the rendered chunk,
  // which ends where the next chunk begins.
  #adjacentChunkAnchor(direction: 1 | -1): ((doc: Document) => Range) | null {
    return this.#ttsDoc ? adjacentChunkAnchor(this.#ttsDoc, direction) : null;
  }

  // Read on into the neighboring chunk of the section. The view goes there
  // even when the user has paged away: a chunk's text exists only once it is
  // rendered.
  async #initTTSForAdjacentChunk(direction: 1 | -1): Promise<boolean> {
    const anchor = this.#adjacentChunkAnchor(direction);
    if (!anchor) return false;
    const index = this.#ttsSectionIndex;
    await this.view.renderer.goTo({ index, anchor });
    return await this.#initTTSForSection(index);
  }

  async #initTTSForNextSection(): Promise<boolean> {
    if (await this.#initTTSForAdjacentChunk(1)) return true;
    const nextIndex = this.#ttsSectionIndex + 1;
    const sections = this.view.book.sections;

    if (!sections || nextIndex >= sections.length) {
      return false;
    }

    return await this.#initTTSForSection(nextIndex);
  }

  async #initTTSForPrevSection(): Promise<boolean> {
    if (await this.#initTTSForAdjacentChunk(-1)) return true;
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
      this.state = 'forward-paused';
      this.#syncAudioKeepAlive();
    } else {
      this.#terminate('ended');
      await this.stop();
    }
  }

  // Stepping back into a section starts at its end: its last paragraph, or by
  // mark its last sentence, rather than its opening (#7065). A closing block
  // with nothing to speak (a "***" divider) is passed over, or playback would
  // move straight on to the section it came from. Paused, the landing spot is
  // shown the way a step back within a section shows it.
  #fromEnd(byMark: boolean, paused: boolean): string | undefined {
    const tts = this.#getTts();
    let last: string | undefined;
    for (let ssml = tts?.next(); ssml; ssml = tts?.next()) last = ssml;
    while (last && !parseSSMLMarks(last).marks.length) last = tts?.prev();
    const mark = byMark && last ? parseSSMLMarks(last).marks.at(-1) : undefined;
    const ssml = mark && tts?.setMark(mark.name) ? tts.resume() : last;
    if (paused && ssml) this.dispatchSpeakMark(parseSSMLMarks(ssml).marks[0]);
    return ssml;
  }

  async #handleNavigationWithoutSSML(
    initSection: () => Promise<boolean>,
    isPlaying: boolean,
    read = () => this.#getTts()?.start(),
  ) {
    if (await initSection()) {
      const ssml = read();
      if (isPlaying) this.#speak(ssml);
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
    // A windowed engine takes preloads as hints it batches on a GPU worker that
    // is slower than an online voice: keep about three minutes of upcoming
    // paragraphs requested, however short they are, so the buffer never drains.
    const capabilities = this.ttsClient.getCapabilities();
    const byDuration = !!capabilities.windowedPrefetch;
    const maxCount = byDuration ? PRELOAD_MAX_PARAGRAPHS : count;
    const voiceId = this.ttsClient.getVoiceId();
    let seconds = 0;

    // Gather all next SSMLs and rewind synchronously to avoid a race condition:
    // tts.next() replaces TTS.#ranges (used by setMark() during playback).
    // If async gaps exist between next()/prev() calls, a concurrent #speak()
    // can dispatch marks against the wrong #ranges, causing incorrect highlights
    // and accidental page turns.
    const estimate = (ssml: string) =>
      estimateSentenceSeconds(ssml.replace(/<[^>]*>/g, ' '), this.ttsLang || 'en', voiceId);
    const rawSsmls: string[] = [];
    let sectionEnded = false;
    const reading = tts.getLastRange();
    for (let i = 0; i < maxCount; i++) {
      const ssml = tts.next();
      if (!ssml) {
        sectionEnded = true;
        break;
      }
      rawSsmls.push(ssml);
      if (!byDuration) continue;
      seconds += estimate(ssml);
      if (seconds >= PRELOAD_AHEAD_SEC) break;
    }
    for (let i = 0; i < rawSsmls.length; i++) {
      tts.prev();
    }
    // next() and prev() forget the sentence being read, even when there is no
    // next block. Put it back, or "next sentence" starts from no sentence and
    // skips the rest of the block: in a chapter that is one block, the chapter.
    const last = this.#lastSetMark;
    if (reading && last && isSameRange(last.range, reading)) {
      this.#suppressMarkHighlight = true;
      tts.setMark(last.name);
      this.#suppressMarkHighlight = false;
    }

    // The document read ends inside the budget: carry on into what follows, so
    // moving on finds its opening already synthesized. In a chunked section
    // that is the next chunk, long before the chapter ends.
    const budgetLeft = () =>
      rawSsmls.length < maxCount && (!byDuration || seconds < PRELOAD_AHEAD_SEC);
    if ((byDuration || capabilities.preloadsAudio) && sectionEnded && budgetLeft()) {
      if (!this.#nextOpening || this.#nextOpening.after !== this.#ttsDoc) {
        const chunkAnchor = this.#adjacentChunkAnchor(1);
        this.#nextOpening = {
          after: this.#ttsDoc,
          ssmls: chunkAnchor
            ? this.#sectionOpening(this.#ttsSectionIndex, chunkAnchor)
            : this.#sectionOpening(this.#ttsSectionIndex + 1),
        };
      }
      for (const ssml of await this.#nextOpening.ssmls) {
        if (!budgetLeft()) break;
        rawSsmls.push(ssml);
        seconds += estimate(ssml);
      }
    }

    const ssmls: string[] = [];
    for (const raw of rawSsmls) {
      const ssml = await this.#preprocessSSML(raw);
      if (!ssml) break;
      ssmls.push(ssml);
    }
    // In reading order, one after another: a windowed provider queues preloads
    // as they arrive, so the paragraph read next must reach it first.
    const { signal } = this.#preloadAbort;
    for (const ssml of ssmls) {
      await this.preloadSSML(ssml, signal);
    }
  }

  // Up to about PRELOAD_AHEAD_SEC of a section's opening paragraphs as raw
  // SSML, from a throwaway TTS over a fresh document (never the live one), the
  // same way the live session will produce them so preloads match playback.
  // `from` starts at a chunk instead: chunk documents keep the full section's
  // element indices, so its anchor resolves in the fresh document too.
  async #sectionOpening(sectionIndex: number, from?: (doc: Document) => Range): Promise<string[]> {
    const section = this.view.book.sections?.[sectionIndex];
    if (!section?.createDocument) return [];
    try {
      const doc = await this.#createSectionDoc(section);
      const { TTS } = await import('foliate-js/tts.js');
      const { textWalker } = await import('foliate-js/text-walker.js');
      const tts = new TTS(doc, textWalker, createTTSNodeFilter(), () => {}, this.#ttsGranularity);
      const voiceId = this.ttsClient.getVoiceId();
      const ssmls: string[] = [];
      let seconds = 0;
      const first = from ? tts.from(from(doc)) : tts.start();
      for (let raw = first; raw && ssmls.length < PRELOAD_MAX_PARAGRAPHS; raw = tts.next()) {
        ssmls.push(raw);
        const text = raw.replace(/<[^>]*>/g, ' ');
        seconds += estimateSentenceSeconds(text, this.ttsLang || 'en', voiceId);
        if (seconds >= PRELOAD_AHEAD_SEC) break;
      }
      return ssmls;
    } catch (err) {
      console.warn('TTS preload of an upcoming opening failed', sectionIndex, err);
      return [];
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

    if (this.#skipInlineAnnotations) {
      ssml = stripInlineReadingAnnotationsFromSSML(ssml);
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
        this.#awaitingAudio = true;
        this.#syncAudioKeepAlive();

        signal.addEventListener('abort', () => {
          resolve();
        });

        ssml = await this.#preprocessSSML(await ssml);
        if (!ssml) {
          this.#nossmlCnt++;
          // FIXME: in case we are at the end of the book, need a better way to handle this
          if (this.#nossmlCnt < 10 && this.state === 'playing' && !oneTime) {
            resolve();
            if (this.stopAtChapterEnd && !this.#adjacentChunkAnchor(1)) {
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
        // A step mode speaks one sentence per utterance, so the engine stops
        // exactly where the sentence does.
        const stepped = !oneTime && this.#stepsBySentence();
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
        const iter = await this.ttsClient.speak(
          stepped ? truncateSSMLAfterMark(ssml, marks[0]!.name) : ssml,
          signal,
        );
        let lastCode;
        // A step mode switched on mid-paragraph still has to stop where the
        // sentence now sounding ends: on its 'end' (engines that speak mark by
        // mark), or else at the next sentence's boundary.
        let sentenceMark: string | undefined;
        let sentenceRange: Range | undefined;
        let stepAfter: { range?: Range; advance: boolean } | null = null;
        let preloadedNext = false;
        const preloadNext = () => {
          if (preloadedNext || oneTime || signal.aborted) return;
          preloadedNext = true;
          void this.preloadNextSSML();
        };
        // Or once this paragraph is slow to become audible (uncached audio
        // waits on the network; the next paragraphs should not).
        const preloadTimer = setTimeout(preloadNext, PRELOAD_NEXT_AFTER_MS);
        signal.addEventListener('abort', () => clearTimeout(preloadTimer), { once: true });
        for await (const { code, mark } of iter) {
          // Anything the iterator yields means the client is done waiting:
          // 'boundary' is the first audible chunk, 'end'/'error' resolve the
          // wait the other way.
          this.#awaitingAudio = false;
          if (signal.aborted) {
            resolve();
            return;
          }
          lastCode = code;
          if (oneTime || this.state !== 'playing') continue;
          // Once this paragraph is audible: stepping through the next ones is
          // synchronous DOM work that would otherwise sit in the pause before it.
          clearTimeout(preloadTimer);
          preloadNext();
          if (code === 'end') {
            const range = this.#getTts()?.getLastRange();
            if (this.#stopsAfter(range)) {
              stepAfter = { range, advance: true };
              break;
            }
          } else if (code === 'boundary' && mark !== sentenceMark) {
            if (sentenceMark !== undefined && this.#stopsAfter(sentenceRange)) {
              stepAfter = { range: sentenceRange, advance: false };
              break;
            }
            sentenceMark = mark;
            sentenceRange = this.#getTts()?.getLastRange();
          }
        }

        if (stepAfter) {
          this.#consecutiveSpeakErrors = 0;
          resolve();
          await this.#afterSentence(stepAfter.range, stepAfter.advance, signal);
        } else if (lastCode === 'end' && this.state === 'playing' && !oneTime) {
          this.#consecutiveSpeakErrors = 0;
          resolve();
          await this.#delayParagraphGap(signal);
          if (signal.aborted) return;
          await this.forward(stepped, true);
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

  #stepsBySentence(): boolean {
    return (this.pauseAfterSentence || this.#loopB !== null) && !this.usesAudioTransport();
  }

  // Whether playback must not simply read on past this sentence.
  #stopsAfter(range: Range | undefined): boolean {
    if (this.usesAudioTransport()) return false;
    return this.pauseAfterSentence || (!!range && this.#isLoopEnd(range));
  }

  // What follows a sentence once a step mode is on: back to A after B,
  // otherwise the next sentence, parked on in sentence-by-sentence mode.
  // `advance` is false when the cursor is already on the next sentence (a mode
  // switched on mid-paragraph is caught at that sentence's boundary).
  async #afterSentence(range: Range | undefined, advance: boolean, signal: AbortSignal) {
    const pause = this.pauseAfterSentence;
    if (pause) {
      await this.stop();
      this.state = 'forward-paused';
    } else {
      await this.#delayParagraphGap(signal);
      if (signal.aborted) return;
    }
    if (range && this.#isLoopEnd(range)) {
      await this.#goToLoopStart(!pause);
    } else if (advance) {
      await this.forward(true, true);
    } else {
      this.reapplyCurrentHighlight();
    }
  }

  get loopState(): TTSLoopState {
    return this.#loopB ? 'ab' : this.#loopA ? 'a' : 'off';
  }

  // A-B repeat: the first call marks the sentence being read as A, the second
  // marks B and loops A..B from then on, the third clears the loop. Marking B
  // before A swaps the two; marking the same sentence twice repeats it.
  toggleLoopPoint(): TTSLoopState {
    if (this.#loopB) {
      this.#loopA = this.#loopB = null;
      this.drawLoopRange();
      return 'off';
    }
    const range = this.#getTts()?.getLastRange();
    const cfi = range && this.#cfiOf(range);
    if (!cfi) return this.loopState;
    const point = { sectionIndex: this.#ttsSectionIndex, cfi };
    if (!this.#loopA) {
      this.#loopA = point;
    } else if (CFI.compare(cfi, this.#loopA.cfi) < 0) {
      this.#loopB = this.#loopA;
      this.#loopA = point;
    } else {
      this.#loopB = point;
    }
    this.drawLoopRange();
    return this.loopState;
  }

  // Tint the A-B span (just A while B is unset) in every live view, so the
  // repeated passage stays visible between the sentences being spoken. Views
  // are re-rendered on navigation, so the reader redraws it on relocate.
  drawLoopRange() {
    if (!this.#attached) return;
    const start = this.#loopA;
    const end = this.#loopB ?? start;
    const contents = this.view.renderer.getContents() as {
      doc?: Document;
      index?: number;
      overlayer?: Overlayer;
    }[];
    for (const { doc, index, overlayer } of contents) {
      overlayer?.remove(LOOP_KEY);
      if (!start || !end || !doc || index === undefined) continue;
      if (index < start.sectionIndex || index > end.sectionIndex) continue;
      try {
        const range = doc.createRange();
        range.selectNodeContents(doc.body);
        const a = index === start.sectionIndex && this.view.resolveCFI(start.cfi).anchor(doc);
        if (a) range.setStart(a.startContainer, a.startOffset);
        const b = index === end.sectionIndex && this.view.resolveCFI(end.cfi).anchor(doc);
        if (b) range.setEnd(b.endContainer, b.endOffset);
        overlayer?.add(LOOP_KEY, range, drawLoopTint, { color: this.options.color });
      } catch {}
    }
  }

  // Lines of the current lyric sheet inside the A-B span, or null when the
  // span does not reach this section. A span from or to another section
  // covers this one up to its edge.
  getLyricLoopRange(): { start: number; end: number } | null {
    const timeline = this.#sectionTimeline;
    const section = this.#ttsSectionIndex;
    const start = this.#loopA;
    const end = this.#loopB ?? start;
    if (!timeline || !timeline.length || this.#timelineSectionIndex !== section) return null;
    if (!start || !end || section < start.sectionIndex || section > end.sectionIndex) return null;
    const lineOf = (cfi: string) => {
      const range = this.view.resolveCFI(cfi).anchor(this.#ttsDoc!);
      return range ? timeline.indexOfRange(range) : -1;
    };
    const first = start.sectionIndex < section ? 0 : lineOf(start.cfi);
    const last = end.sectionIndex > section ? timeline.length - 1 : lineOf(end.cfi);
    return first >= 0 && last >= 0 ? { start: first, end: last } : null;
  }

  #cfiOf(range: Range): string | null {
    try {
      return this.view.getCFI(this.#ttsSectionIndex, range) || null;
    } catch {
      return null;
    }
  }

  #isLoopEnd(range: Range): boolean {
    const end = this.#loopB;
    return !!end && end.sectionIndex === this.#ttsSectionIndex && this.#cfiOf(range) === end.cfi;
  }

  async #goToLoopStart(isPlaying: boolean) {
    const { sectionIndex, cfi } = this.#loopA!;
    if (sectionIndex !== this.#ttsSectionIndex) await this.#initTTSForSection(sectionIndex);
    const range = this.view.resolveCFI(cfi).anchor(this.#ttsDoc!);
    await this.#handleNavigationWithSSML(this.#getTts()?.from(range), isPlaying);
    if (!isPlaying) this.reapplyCurrentHighlight();
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
    if (!oneTime) this.dispatchSpeakMark();
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
  }

  async pause() {
    this.state = 'paused';
    this.#syncAudioKeepAlive();
    if (!(await this.ttsClient.pause().catch((e) => this.error(e)))) {
      await this.stop();
      this.state = 'stop-paused';
    }
  }

  async resume() {
    this.state = 'playing';
    await this.ttsClient.resume().catch((e) => this.error(e));
  }

  #withdrawPreloads() {
    this.#preloadAbort.abort();
    this.#preloadAbort = new AbortController();
  }

  async stop(handover = false) {
    this.#awaitingAudio = false;
    // A handover (the next paragraph starting) keeps them: they are its audio.
    if (!handover) this.#withdrawPreloads();
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
    if (this.usesAudioTransport()) {
      if (byMark) await this.#seekBy(-SKIP_BACKWARD_SEC);
      else await this.#stepAudioChapter(-1);
      return;
    }
    await this.initViewTTS();
    const isPlaying = this.state === 'playing';
    // While playing, this is a handover to the utterance about to be spoken
    // below; only a stopped session should actually be silenced here.
    await this.stop(isPlaying);
    if (!isPlaying) this.state = 'backward-paused';

    const tts = this.#getTts();
    // Mark navigation needs a current paragraph. resume() positions a fresh
    // iterator without resetting an existing position; empty sections return no SSML.
    const ssml = byMark
      ? tts?.resume()
        ? tts.prevMark(!isPlaying)
        : undefined
      : tts?.prev(!isPlaying);
    if (!ssml) {
      await this.#handleNavigationWithoutSSML(
        () => this.#initTTSForPrevSection(),
        isPlaying,
        () => this.#fromEnd(byMark, !isPlaying),
      );
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
    if (!isAutoAdvance && this.usesAudioTransport()) {
      if (byMark) await this.#seekBy(SKIP_FORWARD_SEC);
      else await this.#stepAudioChapter(1);
      return;
    }
    await this.initViewTTS();
    const isPlaying = this.state === 'playing';
    // While playing, this is a handover to the utterance about to be spoken
    // below; only a stopped session should actually be silenced here. This is
    // the auto-advance path, so for recorded narration it is what decides
    // whether every paragraph boundary gets a gap.
    await this.stop(isPlaying);
    if (!isPlaying) this.state = 'forward-paused';

    const tts = this.#getTts();
    // Mark navigation needs a current paragraph. resume() positions a fresh
    // iterator without resetting an existing position; empty sections return no SSML.
    const ssml = byMark
      ? tts?.resume()
        ? tts.nextMark(!isPlaying)
        : undefined
      : tts?.next(!isPlaying);
    if (!ssml) {
      // the end of a chunk is not the end of the chapter
      if (isAutoAdvance && isPlaying && this.stopAtChapterEnd && !this.#adjacentChunkAnchor(1)) {
        return await this.#stopAtChapterBoundary();
      }
      await this.#handleNavigationWithoutSSML(() => this.#initTTSForNextSection(), isPlaying);
    } else {
      await this.#handleNavigationWithSSML(ssml, isPlaying);
    }
  }

  async setLang(lang: string) {
    this.ttsLang = lang;
    // Readest Voice is a remembered choice, never a default: for a book in a
    // language it has no voice for, the default engine reads instead, and the
    // choice stays remembered for books it can read.
    // Custom services likewise, unless a voice of theirs reads any language.
    const speaks = (voices: TTSVoice[]) =>
      voices.some(
        (voice) =>
          !voice.disabled && (voice.lang === MULTILINGUAL_LANG || isSameLang(voice.lang, lang)),
      );
    if (
      (this.ttsClient === this.ttsReadestClient && !speaks(this.ttsReadestVoices)) ||
      (this.ttsClient === this.ttsCustomClient && !speaks(this.ttsCustomVoices))
    ) {
      this.ttsClient = this.ttsEdgeClient.initialized ? this.ttsEdgeClient : this.ttsWebClient;
    }
    this.setPrimaryLang(lang);
  }

  async setPrimaryLang(lang: string) {
    if (this.ttsEdgeClient.initialized) this.ttsEdgeClient.setPrimaryLang(lang);
    if (this.ttsReadestClient.initialized) this.ttsReadestClient.setPrimaryLang(lang);
    if (this.ttsCustomClient.initialized) this.ttsCustomClient.setPrimaryLang(lang);
    if (this.ttsWebClient.initialized) this.ttsWebClient.setPrimaryLang(lang);
    if (this.ttsNativeClient?.initialized) this.ttsNativeClient?.setPrimaryLang(lang);
    if (this.ttsMediaOverlayClient.initialized) this.ttsMediaOverlayClient.setPrimaryLang(lang);
  }

  async setRate(rate: number) {
    // Live rate changes (Edge/MO native AVPlayer) must not flip the state
    // machine to paused — audio keeps rolling and the UI would desync.
    if (this.state !== 'playing') this.state = 'setrate-paused';
    this.ttsRate = rate;
    this.#sectionTimeline?.setRate(rate);
    await this.ttsClient.setRate(this.ttsRate);
  }

  async getVoices(lang: string) {
    const ttsWebVoices = await this.ttsWebClient.getVoices(lang);
    const ttsEdgeVoices = await this.ttsEdgeClient.getVoices(lang);
    const ttsNativeVoices = (await this.ttsNativeClient?.getVoices(lang)) ?? [];
    // Listed for every reader, the voices their plan lacks greyed out; hidden
    // only when there is no catalog (kill switch, offline).
    const ttsReadestVoices =
      (await this.ttsReadestClient.getAllVoices()).length > 0
        ? (await this.ttsReadestClient.getVoices(lang)).filter((group) => group.voices.length > 0)
        : [];
    // The picker is open: boot a GPU worker so the first window is warm, but
    // only for a reader whose plan has a Readest voice to play.
    if (ttsReadestVoices.some((group) => group.voices.some((voice) => !voice.disabled))) {
      this.#readestProvider.warmup();
    }
    // The book's own narrator leads the list when there is one: it is the best
    // voice available for that book by a wide margin.
    const narrationVoices = this.narrationAvailable
      ? await this.ttsMediaOverlayClient.getVoices(lang)
      : [];
    // Services the user set up themselves come next, hidden when unavailable.
    const ttsCustomVoices = this.ttsCustomClient.initialized
      ? (await this.ttsCustomClient.getVoices(lang)).filter((group) => group.voices.length > 0)
      : [];

    const voicesGroups = [
      ...narrationVoices,
      ...ttsCustomVoices,
      ...ttsReadestVoices,
      ...ttsEdgeVoices,
      ...ttsNativeVoices,
      ...ttsWebVoices,
    ];
    return voicesGroups;
  }

  async setVoice(voiceId: string, lang: string) {
    this.state = 'setvoice-paused';
    this.#withdrawPreloads();

    // Switching into or out of narration changes the mark source, not just the
    // engine: the current section's TTS instance has to be rebuilt.
    const wantsNarration = voiceId === MEDIA_OVERLAY_VOICE_ID && this.narrationAvailable;
    if (wantsNarration !== this.narrationActive) {
      // Edge/native share the iOS playout AVPlayer with Media Overlay. Leaving
      // narration (or returning after Edge aborted it) must drop the cached
      // clock, or speak() resumes a dead session and the reader hears silence.
      this.ttsMediaOverlayClient.invalidatePlayback();
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

    // Never for the engine-default voice (''): Edge and native treat it as
    // "any enabled voice", and matching it here would move a paying reader who
    // never chose Readest Voice onto it.
    const useCustomTTS =
      voiceId !== '' &&
      this.ttsCustomClient.initialized &&
      this.ttsCustomVoices.some((voice) => voice.id === voiceId);
    const useReadestTTS =
      voiceId !== '' &&
      this.ttsReadestClient.initialized &&
      this.ttsReadestVoices.some((voice) => voice.id === voiceId && !voice.disabled);
    const useEdgeTTS = !!this.ttsEdgeVoices.find(
      (voice) => (voiceId === '' || voice.id === voiceId) && !voice.disabled,
    );
    const useNativeTTS = !!this.ttsNativeVoices.find(
      (voice) => (voiceId === '' || voice.id === voiceId) && !voice.disabled,
    );
    if (useCustomTTS) {
      this.ttsClient = this.ttsCustomClient;
      await this.ttsClient.setRate(this.ttsRate);
    } else if (useReadestTTS) {
      this.ttsClient = this.ttsReadestClient;
      await this.ttsClient.setRate(this.ttsRate);
    } else if (useEdgeTTS) {
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
          sheet: this.#ttsDocSheet,
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

  #getCurrentPlaybackRange(): Range | undefined {
    const tts = this.#getTts();
    if (!tts) return undefined;
    if (this.ttsClient.getCapabilities().textHighlight === false && 'getPlaybackRange' in tts) {
      return tts.getPlaybackRange(this.ttsClient.getChunkProgress?.());
    }
    return tts.getLastRange();
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
        const wordMode =
          this.ttsClient.getCapabilities().wordBoundaries && this.#highlightGranularity === 'word';
        this.#suppressMarkHighlight = wordMode;
        const range = this.#getTts()?.setMark(mark.name);
        this.#suppressMarkHighlight = false;
        if (range) this.#lastSetMark = { name: mark.name, range };
        this.#speakWordsArmed = !!range;
        if (wordMode && range) {
          // The previous sentence's last word is no longer sounding.
          this.#getPrimaryContent()?.overlayer?.remove(HIGHLIGHT_KEY);
          this.#drawSentenceTint(range);
        }
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
        const playbackRange =
          this.ttsClient.getCapabilities().textHighlight === false
            ? (this.#getCurrentPlaybackRange() ?? range)
            : range;
        const cfi = this.view.getCFI(this.#ttsSectionIndex, playbackRange);
        // A chapter-only pairing highlights a one-character reading dot, but the
        // view needs the whole sounding sentence to know where the page cuts it
        // off (followSentenceAcrossPages). Carry that range's cfi too; it is the
        // mark range itself when the client highlights the full text, so no
        // extra work for synthesized voices or exact Media Overlays.
        const sentenceCfi =
          playbackRange === range ? cfi : this.view.getCFI(this.#ttsSectionIndex, range);
        this.dispatchEvent(new CustomEvent('tts-highlight-mark', { detail: { cfi, sentenceCfi } }));
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

  // Word mode tints the sentence as soon as its mark is dispatched, before its
  // audio may be ready, and keeps it until the next sentence: the tint is where
  // the reader is, the word highlight is what is sounding now.
  #drawSentenceTint(range: Range) {
    const content = this.#getPrimaryContent();
    const overlayer = content?.overlayer;
    overlayer?.remove(SENTENCE_KEY);
    if (!this.sentenceTint || !content?.doc || content.index !== this.#ttsSectionIndex) return;
    try {
      const cfi = this.view.getCFI(content.index, range);
      const visibleRange = this.view.resolveCFI(cfi).anchor(content.doc);
      if (!visibleRange) return;
      overlayer?.add(SENTENCE_KEY, visibleRange, drawSentenceTint, { color: this.options.color });
    } catch (e) {
      console.error('Failed to tint sentence', e);
    }
  }

  // Re-apply the active highlight after the view relocates (page turn,
  // re-render). In word mode this re-draws the current word so the sentence
  // never reappears over it; otherwise it re-draws the sentence.
  reapplyCurrentHighlight() {
    if (!this.#attached) return;
    if (this.ttsClient.getCapabilities().textHighlight === false) return;
    if (this.#wordHighlightActive && this.#lastSpeakWordRange) {
      if (this.#speakWordBaseRange) this.#drawSentenceTint(this.#speakWordBaseRange);
      this.#getHighlighter()(this.#lastSpeakWordRange.cloneRange());
      return;
    }
    // Word mode during playback: between a sentence's mark and its first word
    // boundary only the sentence tint shows; re-drawing the full sentence here
    // is exactly the flash word mode suppresses at setMark. Paused/stopped
    // states keep the sentence re-draw (navigation UX).
    if (
      this.state === 'playing' &&
      this.ttsClient.getCapabilities().wordBoundaries &&
      this.#highlightGranularity === 'word'
    ) {
      const range = this.#getTts()?.getLastRange();
      if (range) this.#drawSentenceTint(range);
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
    // Approximate chapter mapping already exposes a single live-position CFI;
    // judging its full chapter as a "sentence on screen" is what hid the return
    // button on every page in that chapter.
    if (this.ttsClient.getCapabilities().textHighlight === false) return false;
    const range = this.#getCurrentPlaybackRange();
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

  // Live playback location for navigation. For paired audiobooks this is a
  // one-character estimate derived from track progress, not the whole chapter
  // range; synthesized and precisely timed narration retain their normal mark.
  getCurrentPlaybackCfi(): string | null {
    const wordCfi = this.getCurrentHighlightCfi();
    if (wordCfi) return wordCfi;
    if (!this.#attached || this.#ttsSectionIndex < 0) return null;
    const range = this.#getCurrentPlaybackRange();
    if (!range) return null;
    try {
      return this.view.getCFI(this.#ttsSectionIndex, range) || null;
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
    const range = this.#getCurrentPlaybackRange();
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
      // The first word lights when its audio does; until then the sentence
      // tint drawn at mark dispatch shows where reading is.
      this.#wordHighlightActive = true;
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
    // A controller replaced by a newer session leaves that session's text
    // and highlights on the shared view alone.
    const ownsView = !this.view.tts || this.view.tts === this.#tts;
    if (ownsView) this.#clearAllHighlights();
    this.#ttsSectionIndex = -1;
    this.#sectionTimeline = null;
    this.#timelineSectionIndex = -1;
    this.#currentSentenceIndex = -1;
    this.#ttsDoc = null;
    this.#tts = null;
    this.#mediaOverlaySection = null;
    if (ownsView) this.view.tts = null;
    if (this.ttsWebClient.initialized) {
      await this.ttsWebClient.shutdown();
    }
    if (this.ttsEdgeClient.initialized) {
      await this.ttsEdgeClient.shutdown();
    }
    if (this.ttsReadestClient.initialized) {
      await this.ttsReadestClient.shutdown();
    }
    if (this.ttsCustomClient.initialized) {
      await this.ttsCustomClient.shutdown();
    }
    if (this.ttsNativeClient?.initialized) {
      await this.ttsNativeClient.shutdown();
    }
    if (this.ttsMediaOverlayClient.initialized) {
      await this.ttsMediaOverlayClient.shutdown();
    }
  }
}
