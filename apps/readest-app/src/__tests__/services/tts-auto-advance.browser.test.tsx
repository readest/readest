import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode, RefObject } from 'react';

import { DocumentLoader } from '@/libs/document';
import type { BookDoc, TOCItem } from '@/libs/document';
import { FoliateView, wrappedFoliateView } from '@/types/view';
import type { Book, BookConfig, PageInfo, ViewSettings } from '@/types/book';
import type { FileSystem } from '@/types/system';
import type { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import type { SystemSettings } from '@/types/settings';
import { getDefaultViewSettings } from '@/services/settingsService';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { useTTSControl } from '@/app/reader/hooks/useTTSControl';
import { useParagraphMode } from '@/app/reader/hooks/useParagraphMode';

// ---------------------------------------------------------------------------
// Mock ONLY the speech client. Everything else is real: the foliate
// <foliate-view> renders Alice and lays out pages, the real TTSController
// walks the real `view.tts` over the real document, and the real
// `useTTSControl` hook (with the real Zustand stores) drives the page turn
// and the "Back to TTS Location" badge. The client is the single seam — the
// thing that would otherwise talk to a speech engine / network.
//
// The controller's #speak() loop only inspects the event `code`: when the
// last event is `end`, it calls forward(), which advances `view.tts` to the
// next sentence (and, at a section boundary, into the next chapter). So the
// mock just needs to emit `end` after a short delay. Marks/SSML/highlights
// all come from the real document.
// ---------------------------------------------------------------------------

// Mutable so a single test can slow the synthetic walk down. The default 25ms
// keeps the existing tests fast; the paragraph-mode boundary test raises it so
// the per-section dwell exceeds the paragraph hook's relocate debounce + rAFs
// (the cross-section re-init needs the view to sit on the new section briefly).
// Always restored in that test's finally so other tests keep the fast default.
let speakDelayMs = 25;

function makeMockTTSClient(name: string): TTSClient {
  return {
    name,
    initialized: false,
    init: () => Promise.resolve(true),
    shutdown: () => Promise.resolve(),
    speak: async function* (
      _ssml: string,
      signal: AbortSignal,
      preload?: boolean,
    ): AsyncGenerator<TTSMessageEvent> {
      // The preload path only warms a cache in real clients — emit nothing.
      if (preload) return;
      await new Promise((r) => setTimeout(r, speakDelayMs));
      if (signal.aborted) return;
      yield { code: 'end' };
    },
    pause: () => Promise.resolve(true),
    resume: () => Promise.resolve(true),
    stop: () => Promise.resolve(),
    setPrimaryLang: () => {},
    setRate: () => Promise.resolve(),
    setPitch: () => Promise.resolve(),
    setVoice: () => Promise.resolve(),
    getAllVoices: () => Promise.resolve([]),
    getVoices: () => Promise.resolve([]),
    getGranularities: () => ['sentence'],
    getCapabilities: () => ({
      wordBoundaries: false,
      mediaClock: false,
      gapControl: false,
      liveRateChange: false,
    }),
    getVoiceId: () => 'mock-voice',
    getSpeakingLang: () => 'en',
  };
}

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, makeMockTTSClient('web'));
  }),
}));
vi.mock('@/services/tts/EdgeTTSClient', () => ({
  // useTTSControl also imports this named const from the same module; the
  // mock factory replaces the whole module, so it must re-export it too.
  DEFAULT_SENTENCE_GAP_SEC: 0.15,
  EdgeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    // TTSController.setSentenceGap always forwards to the real ttsEdgeClient
    // instance regardless of the active engine, so this mock needs the method
    // even though the other two client mocks don't.
    Object.assign(this, makeMockTTSClient('edge'), { setSentenceGap: () => {} });
  }),
}));
vi.mock('@/services/tts/NativeTTSClient', () => ({
  NativeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, makeMockTTSClient('native'));
  }),
}));

// useEnv/useAuth throw outside their providers; stub them (test-side module
// mocks, not a production seam). A null appService exercises the web/desktop
// code paths in useTTSControl (no mobile/iOS branches).
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
  EnvProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Fixture: sample-alice.epub spine (all linear), 0-based section indices:
//   0 cover · 1 title · 2 about · 3 main0=Ch1 · 4 main1=Ch2 · 5 main2=Ch3
//   6 main3=Ch4 (The Rabbit Sends in a Little Bill)
//   7 main4=Ch5 (Advice from a Caterpillar)
// Chapters 4 and 5 are adjacent sections — exactly the boundary we cross.
// ---------------------------------------------------------------------------
const EPUB_URL = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;
const CH4_SECTION_INDEX = 6;
const CH5_SECTION_INDEX = 7;
const BOOK_ID = 'alice';
const BOOK_KEY = 'alice'; // id = key.split('-')[0]

let bookDoc: BookDoc;

interface RelocateDetail {
  cfi: string;
  tocItem?: TOCItem;
  pageItem?: BookProgressPageItem;
  section: PageInfo;
  location: PageInfo;
  time: { section: number; total: number };
  range: Range;
  fraction: number;
}
type BookProgressPageItem = { label?: string; href?: string } | null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const resp = await fetch(EPUB_URL);
  const buffer = await resp.arrayBuffer();
  const file = new File([buffer], 'sample-alice.epub', { type: 'application/epub+zip' });
  bookDoc = (await new DocumentLoader(file).open()).book;
  // Hydrate TOC so relocate's tocItem carries chapter labels ("Chapter 4 …").
  const { computeBookNav, hydrateBookNav } = await import('@/services/nav');
  hydrateBookNav(bookDoc, await computeBookNav(bookDoc));
  await import('foliate-js/view.js');
}, 60000);

const createView = (viewSettings: ViewSettings) => {
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '800px',
    height: '600px',
  });
  document.body.appendChild(container);

  const view = wrappedFoliateView(document.createElement('foliate-view') as FoliateView);
  container.appendChild(view);
  return { container, view, viewSettings };
};

const seedStores = (view: FoliateView, viewSettings: ViewSettings) => {
  const book = {
    hash: BOOK_ID,
    format: 'EPUB',
    title: "Alice's Adventures in Wonderland",
    author: 'Lewis Carroll',
    coverImageUrl: '',
    primaryLanguage: 'en',
  } as unknown as Book;
  const config = {
    updatedAt: Date.now(),
    booknotes: [],
    progress: [1, 1],
    location: '',
    viewSettings,
  } as unknown as BookConfig;

  // proofreadStore.getMergedRules reads settings.globalViewSettings.* during
  // SSML preprocessing; without it the speak chain rejects and TTS stops.
  useSettingsStore.setState((s) => ({
    settings: { ...s.settings, globalViewSettings: viewSettings } as SystemSettings,
  }));

  useBookDataStore.setState((s) => ({
    booksData: {
      ...s.booksData,
      [BOOK_ID]: { id: BOOK_ID, book, file: null, config, bookDoc, isFixedLayout: false },
    },
  }));
  useReaderStore.setState((s) => ({
    viewStates: {
      ...s.viewStates,
      [BOOK_KEY]: {
        key: BOOK_KEY,
        view,
        viewerKey: BOOK_KEY,
        isPrimary: true,
        loading: false,
        inited: true,
        error: null,
        ribbonVisible: false,
        ttsEnabled: false,
        autoScrollEnabled: false,
        syncing: false,
        gridInsets: null,
        previewMode: false,
        viewSettings,
      },
    },
  }));
};

// Reproduce FoliateViewer's relocate → setProgress glue (the one production
// bit not under test here) so useBookProgress updates on every page turn —
// which is what drives the badge effect.
const wireRelocate = (view: FoliateView) => {
  const { setProgress } = useReaderStore.getState();
  view.addEventListener('relocate', (e: Event) => {
    const detail = (e as CustomEvent<RelocateDetail>).detail;
    const atEnd = view.renderer.atEnd || false;
    const { current, next, total } = detail.location;
    const currentPage = atEnd && total > 0 ? total - 1 : current;
    const pageInfo: PageInfo = { current: currentPage, next, total };
    setProgress(
      BOOK_KEY,
      detail.cfi,
      (detail.tocItem ?? {}) as TOCItem,
      detail.pageItem ?? null,
      detail.section,
      pageInfo,
      detail.time,
      detail.range,
      detail.fraction,
    );
  });
};

// Page forward from the start of Ch4 to its LAST page, so TTS starts at the
// last paragraph of Ch4 and only a sentence or two remain before the boundary.
const goToLastPageOfCh4 = async (view: FoliateView) => {
  await view.renderer.goTo({ index: CH4_SECTION_INDEX });
  let guard = 0;
  while (view.renderer.primaryIndex === CH4_SECTION_INDEX && guard++ < 300) {
    await view.renderer.next();
  }
  // next() at the end of Ch4 loads Ch5; step back onto Ch4's final page.
  if (view.renderer.primaryIndex !== CH4_SECTION_INDEX) {
    await view.renderer.prev();
  }
};

afterEach(async () => {
  await eventDispatcher.dispatch('tts-stop', { bookKey: BOOK_KEY });
  document.querySelectorAll('foliate-view').forEach((el) => el.parentElement?.remove());
  useBookDataStore.setState(() => ({ booksData: {} }));
  useReaderStore.setState(() => ({ viewStates: {} }));
});

describe('TTS auto-advance across a chapter boundary (browser e2e)', () => {
  it('reads from the last paragraph of Ch4 into Ch5, turns the page, and shows no "Back to TTS Location" badge', async () => {
    const viewSettings: ViewSettings = {
      ...getDefaultViewSettings({
        fs: {} as FileSystem,
        isMobile: false,
        isEink: false,
        isAppDataSandbox: false,
      }),
      maxColumnCount: 1,
      scrolled: false,
    };

    const { view } = createView(viewSettings);
    await view.open(bookDoc);
    view.renderer.setAttribute('max-column-count', '1');
    view.renderer.setAttribute('max-inline-size', '800px');
    view.renderer.setAttribute('max-block-size', '1000px');
    view.renderer.setAttribute('margin-top', '0px');
    view.renderer.setAttribute('margin-bottom', '0px');
    view.renderer.setAttribute('margin-left', '0px');
    view.renderer.setAttribute('margin-right', '0px');
    view.renderer.setAttribute('gap', '0%');
    await view.goToFraction(0);

    seedStores(view, viewSettings);
    wireRelocate(view);
    await goToLastPageOfCh4(view);
    await sleep(50); // let the relocate → setProgress settle

    // Precondition: we are on Ch4, and progress reflects it.
    expect(view.renderer.primaryIndex).toBe(CH4_SECTION_INDEX);
    expect(useReaderStore.getState().getProgress(BOOK_KEY)?.sectionLabel).toMatch(/Chapter 4/);

    const { result, unmount } = renderHook(() => useTTSControl({ bookKey: BOOK_KEY }));

    // Start TTS at the last paragraph of Ch4 (index pins the start section).
    await act(async () => {
      await eventDispatcher.dispatch('tts-speak', { bookKey: BOOK_KEY, index: CH4_SECTION_INDEX });
    });

    // Drive the mock 'end' events; the controller walks to the end of Ch4 and
    // auto-advances into Ch5. Watch the badge the whole time — under normal
    // TTS following it must never appear.
    let badgeEverAppeared = false;
    await act(async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (result.current.showBackToCurrentTTSLocation) badgeEverAppeared = true;
        if (view.renderer.primaryIndex === CH5_SECTION_INDEX) break;
        await sleep(50);
      }
    });

    // Let the badge effect settle against the Ch5 progress (past any grace).
    await act(async () => {
      await sleep(700);
      if (result.current.showBackToCurrentTTSLocation) badgeEverAppeared = true;
    });

    // 1. The page turned into Ch5.
    expect(view.renderer.primaryIndex).toBe(CH5_SECTION_INDEX);
    expect(useReaderStore.getState().getProgress(BOOK_KEY)?.sectionLabel).toMatch(/Chapter 5/);

    // 2. TTS actually read into Ch5 (its highlighted location is in Ch5).
    const ttsLocation = useReaderStore.getState().getViewSettings(BOOK_KEY)?.ttsLocation;
    expect(ttsLocation).toBeTruthy();
    expect(view.resolveCFI(ttsLocation!).index).toBe(CH5_SECTION_INDEX);

    // 3. No "Back to TTS Location" badge — the TTS location is already in view,
    //    so the gating flag is false now and never flipped true while crossing.
    expect(result.current.showBackToCurrentTTSLocation).toBe(false);
    expect(badgeEverAppeared).toBe(false);

    unmount();
  }, 60000);

  // Slice 2: the hook republishes the controller's canonical 'tts-position'
  // CustomEvent onto the app-wide eventDispatcher (tagged with bookKey) so
  // paragraph mode + RSVP can follow TTS without touching the controller. It
  // also emits 'tts-playback-state' transitions for consumers (like RSVP) that
  // can't read the hook-local isPlaying flag.
  it('republishes controller tts-position + tts-playback-state onto the global eventDispatcher', async () => {
    const viewSettings: ViewSettings = {
      ...getDefaultViewSettings({
        fs: {} as FileSystem,
        isMobile: false,
        isEink: false,
        isAppDataSandbox: false,
      }),
      maxColumnCount: 1,
      scrolled: false,
    };

    const { view } = createView(viewSettings);
    await view.open(bookDoc);
    view.renderer.setAttribute('max-column-count', '1');
    view.renderer.setAttribute('max-inline-size', '800px');
    view.renderer.setAttribute('max-block-size', '1000px');
    view.renderer.setAttribute('margin-top', '0px');
    view.renderer.setAttribute('margin-bottom', '0px');
    view.renderer.setAttribute('margin-left', '0px');
    view.renderer.setAttribute('margin-right', '0px');
    view.renderer.setAttribute('gap', '0%');
    await view.goToFraction(0);

    seedStores(view, viewSettings);
    wireRelocate(view);
    await view.renderer.goTo({ index: CH4_SECTION_INDEX });
    await sleep(50);

    interface BusPosition {
      bookKey: string;
      cfi: string;
      kind: 'word' | 'sentence';
      sectionIndex: number;
      sequence: number;
    }
    const positions: BusPosition[] = [];
    const playbackStates: string[] = [];
    const onPosition = (e: CustomEvent) => {
      positions.push(e.detail as BusPosition);
    };
    const onPlaybackState = (e: CustomEvent) => {
      const detail = e.detail as { bookKey: string; state: string };
      if (detail.bookKey === BOOK_KEY) playbackStates.push(detail.state);
    };
    eventDispatcher.on('tts-position', onPosition);
    eventDispatcher.on('tts-playback-state', onPlaybackState);

    const { unmount } = renderHook(() => useTTSControl({ bookKey: BOOK_KEY }));

    try {
      await act(async () => {
        await eventDispatcher.dispatch('tts-speak', {
          bookKey: BOOK_KEY,
          index: CH4_SECTION_INDEX,
        });
      });

      // Let the controller walk a few sentences so several 'tts-position'
      // events fire on the bus.
      await act(async () => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && positions.length < 3) {
          await sleep(50);
        }
      });

      // 1. Playback started -> the bus saw a 'playing' state.
      expect(playbackStates).toContain('playing');

      // 2. The global bus received the controller's canonical positions, each
      //    tagged with the bookKey and carrying the controller detail.
      expect(positions.length).toBeGreaterThan(0);
      for (const pos of positions) {
        expect(pos.bookKey).toBe(BOOK_KEY);
        expect(pos.kind).toBe('sentence'); // mock client reports no word boundaries
        expect(typeof pos.cfi).toBe('string');
        expect(pos.cfi.length).toBeGreaterThan(0);
        expect(pos.sectionIndex).toBe(CH4_SECTION_INDEX);
        expect(typeof pos.sequence).toBe('number');
      }
      // Sequence is monotonic from the controller.
      const sequences = positions.map((p) => p.sequence);
      expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);

      // 3. Stopping TTS emits a 'stopped' state on the bus.
      await act(async () => {
        await eventDispatcher.dispatch('tts-stop', { bookKey: BOOK_KEY });
        await sleep(50);
      });
      expect(playbackStates[playbackStates.length - 1]).toBe('stopped');
    } finally {
      eventDispatcher.off('tts-position', onPosition);
      eventDispatcher.off('tts-playback-state', onPlaybackState);
      unmount();
    }
  }, 60000);

  // Slice 9 (the primary high-risk case): with PARAGRAPH MODE active, the
  // focused paragraph must follow the spoken position AND correctly re-target
  // after the section boundary. The trap this guards against: TTS sync arms
  // isFocusingRef on a same-section focus, the next (section-change) relocate is
  // eaten, the iterator never re-inits for Ch5, and focus stays stuck on
  // paragraph 0 of the wrong (Ch4) document. Here EVERYTHING is real — the
  // <foliate-view>, the real useTTSControl walk, AND the real useParagraphMode
  // iterator built on the live section docs. Only the speech client is mocked.
  it('paragraph mode follows TTS across the Ch4→Ch5 boundary and re-targets the new section', async () => {
    const viewSettings: ViewSettings = {
      ...getDefaultViewSettings({
        fs: {} as FileSystem,
        isMobile: false,
        isEink: false,
        isAppDataSandbox: false,
      }),
      maxColumnCount: 1,
      scrolled: false,
      // Paragraph mode enabled at mount: the hook auto-builds the iterator on
      // the live section doc (first-mount effect) and registers its TTS-sync
      // listeners. We avoid toggleParagraphMode() so the fire-and-forget
      // saveViewSettings → saveConfig (appService is null in this harness) is
      // never exercised — enabling via the seeded config is enough.
      paragraphMode: { enabled: true },
    };

    const { view } = createView(viewSettings);
    await view.open(bookDoc);
    view.renderer.setAttribute('max-column-count', '1');
    view.renderer.setAttribute('max-inline-size', '800px');
    view.renderer.setAttribute('max-block-size', '1000px');
    view.renderer.setAttribute('margin-top', '0px');
    view.renderer.setAttribute('margin-bottom', '0px');
    view.renderer.setAttribute('margin-left', '0px');
    view.renderer.setAttribute('margin-right', '0px');
    view.renderer.setAttribute('gap', '0%');
    await view.goToFraction(0);

    seedStores(view, viewSettings);
    wireRelocate(view);
    await goToLastPageOfCh4(view);
    await sleep(50); // let the relocate → setProgress settle

    expect(view.renderer.primaryIndex).toBe(CH4_SECTION_INDEX);

    // Attribute a Range to its owning section by matching its document against
    // the renderer's live section contents. This is how we tell whether a
    // focused paragraph belongs to Ch4 (start side) or Ch5 (post-boundary).
    const ownerSectionIndex = (range: Range): number | undefined => {
      const owner = range?.startContainer?.ownerDocument;
      return view.renderer.getContents().find((c) => c.doc === owner)?.index;
    };

    // Record every paragraph-focus the hook dispatches (by owning section) for
    // the failure-diagnostic string; the load-bearing assertions read the
    // iterator's current range directly (see currentSection below).
    const focuses: (number | undefined)[] = [];
    const onParagraphFocus = (e: CustomEvent) => {
      const detail = e.detail as { bookKey: string; range: Range };
      if (detail.bookKey !== BOOK_KEY) return;
      focuses.push(ownerSectionIndex(detail.range));
    };
    eventDispatcher.on('paragraph-focus', onParagraphFocus);

    // Record the section of every spoken position on the bus — proves TTS read
    // out of Ch4 and into Ch5 (the audio actually crossed the boundary).
    const posSections: number[] = [];
    const onPos = (e: CustomEvent) => {
      const d = e.detail as { bookKey: string; sectionIndex: number };
      if (d.bookKey === BOOK_KEY) posSections.push(d.sectionIndex);
    };
    eventDispatcher.on('tts-position', onPos);

    // Mount BOTH hooks for the same book: the real TTS controller hook (drives
    // the walk + publishes tts-position/tts-playback-state on the bus) and the
    // real paragraph-mode hook (follows that bus). The viewRef points at the
    // same live <foliate-view> the store holds.
    const viewRef = { current: view } as RefObject<FoliateView | null>;
    // Mount the two hooks in SEPARATE React roots (separate renderHook calls)
    // so a store write from one doesn't synchronously re-enter the other's
    // render commit — mirrors how the app mounts them in distinct components.
    const tts = renderHook(() => useTTSControl({ bookKey: BOOK_KEY }));
    const para = renderHook(() => useParagraphMode({ bookKey: BOOK_KEY, viewRef }));
    const ttsApi = () => tts.result.current;
    const paragraphApi = () => para.result.current;
    const unmount = () => {
      para.unmount();
      tts.unmount();
    };

    let syncStatusEverFollowing = false;

    // Slow the synthetic walk so each section is spoken long enough for the
    // paragraph hook's cross-section re-init (relocate debounce + rAFs) to land
    // before TTS sprints onward. Restored in finally.
    const prevSpeakDelay = speakDelayMs;
    speakDelayMs = 800;

    // The robust, event-agnostic observable: the section the iterator's CURRENT
    // range belongs to. A paragraph-focus CustomEvent only fires when focus
    // actually MOVES, so the first paragraph of the new section (which TTS reads
    // first) need not emit one — but the iterator's current range still belongs
    // to that section. So we track currentRange's owning section directly.
    const currentSection = (): number | undefined => {
      const cr = paragraphApi().paragraphState.currentRange;
      return cr ? ownerSectionIndex(cr) : undefined;
    };
    // Distinct (section,index) pairs of the iterator's current paragraph over
    // the whole walk — proves it tracked TTS rather than sitting still.
    const currentTrail: string[] = [];
    const recordCurrent = () => {
      const sec = currentSection();
      const idx = paragraphApi().paragraphState.currentIndex;
      const key = `${sec}:${idx}`;
      if (currentTrail[currentTrail.length - 1] !== key) currentTrail.push(key);
    };

    try {
      // Wait for paragraph mode to build its iterator on the live Ch4 doc (the
      // first-mount effect runs after ~100ms, then focuses the first paragraph).
      await act(async () => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (paragraphApi().paragraphState.currentIndex >= 0 && currentSection() !== undefined) {
            break;
          }
          await sleep(50);
        }
      });
      // Precondition: the iterator built on the live Ch4 doc and its current
      // paragraph belongs to Ch4 (section 6) — the start side of the boundary.
      expect(paragraphApi().paragraphState.totalParagraphs).toBeGreaterThan(0);
      expect(currentSection()).toBe(CH4_SECTION_INDEX);
      const ch4ParagraphTotal = paragraphApi().paragraphState.totalParagraphs;
      recordCurrent();

      // Drain the mount-focus isFocusingRef window (200ms) so the iterator's own
      // initial focus can't swallow the upcoming TTS section-change relocate.
      await act(async () => {
        await sleep(300);
      });

      // Start TTS at the last paragraph of Ch4 (index pins the start section).
      await act(async () => {
        await eventDispatcher.dispatch('tts-speak', {
          bookKey: BOOK_KEY,
          index: CH4_SECTION_INDEX,
        });
      });

      // Drive the mock 'end' events; the controller walks to the end of Ch4 and
      // auto-advances into Ch5, publishing tts-position the whole way. Paragraph
      // mode follows. The mock client never stops yielding 'end', so the walk
      // would run on forever — we STOP TTS the moment the iterator's current
      // paragraph belongs to Ch5's document, then assert on captured evidence.
      let ch4CurrentSeenDuringWalk = false;
      await act(async () => {
        const deadline = Date.now() + 40000;
        while (Date.now() < deadline) {
          if (paragraphApi().ttsSyncStatus === 'following') syncStatusEverFollowing = true;
          recordCurrent();
          if (currentSection() === CH4_SECTION_INDEX) ch4CurrentSeenDuringWalk = true;
          // Stop as soon as the iterator's current paragraph belongs to Ch5's
          // document: this is the exact moment the re-target across the boundary
          // succeeded.
          if (currentSection() === CH5_SECTION_INDEX) break;
          await sleep(50);
        }
        // Halt the (otherwise endless) walk so the view doesn't run past Ch5.
        await eventDispatcher.dispatch('tts-stop', { bookKey: BOOK_KEY });
      });

      // Let the final cross-section sync settle (re-init + applySyncCfi run
      // across a couple of rAFs / event turns).
      await act(async () => {
        await sleep(300);
        recordCurrent();
      });

      const diag =
        `trail=${currentTrail.join(' ')} | ` +
        `posSecs(first/last)=${posSections[0]}/${posSections[posSections.length - 1]} | ` +
        `nPos=${posSections.length} | focuses=${focuses.join(',')}`;

      // 1. TTS published spoken positions in BOTH sections — it genuinely read
      //    out of Ch4 and into Ch5 (the boundary was crossed by the audio).
      expect(posSections, diag).toContain(CH4_SECTION_INDEX);
      expect(posSections, diag).toContain(CH5_SECTION_INDEX);

      // 2. While in the first section, the iterator's current paragraph stayed in
      //    Ch4's document (it never wrongly jumped to a foreign section early).
      expect(ch4CurrentSeenDuringWalk, diag).toBe(true);

      // 3. AFTER the boundary, the iterator re-inited for the NEW section: its
      //    current range belongs to Ch5's document, NOT the stale Ch4 one. This
      //    is the wrong-section-paragraph-0 / isFocusingRef trap.
      const finalCurrentRange = paragraphApi().paragraphState.currentRange;
      expect(finalCurrentRange, diag).toBeTruthy();
      expect(ownerSectionIndex(finalCurrentRange!), diag).toBe(CH5_SECTION_INDEX);

      // 4. The re-target is a genuine new-section iterator (Ch5's paragraph count
      //    differs from Ch4's), not the old Ch4 iterator mislabeled.
      expect(paragraphApi().paragraphState.totalParagraphs, diag).not.toBe(ch4ParagraphTotal);

      // 5. The current-paragraph trail moved from a Ch4 entry to a Ch5 entry and,
      //    once in Ch5, never reverted to Ch4 (no bounce-back to the old doc).
      const firstCh5TrailAt = currentTrail.findIndex((k) => k.startsWith(`${CH5_SECTION_INDEX}:`));
      expect(firstCh5TrailAt, diag).toBeGreaterThanOrEqual(0);
      expect(
        currentTrail.slice(0, firstCh5TrailAt).some((k) => k.startsWith(`${CH4_SECTION_INDEX}:`)),
        diag,
      ).toBe(true);
      expect(
        currentTrail.slice(firstCh5TrailAt).some((k) => k.startsWith(`${CH4_SECTION_INDEX}:`)),
        diag,
      ).toBe(false);

      // 6. ttsSyncStatus reported 'following' during the walk.
      expect(syncStatusEverFollowing, diag).toBe(true);

      // Keep ttsApi referenced (it owns the live walk under test).
      expect(ttsApi()).toBeTruthy();
    } finally {
      speakDelayMs = prevSpeakDelay;
      eventDispatcher.off('paragraph-focus', onParagraphFocus);
      eventDispatcher.off('tts-position', onPos);
      unmount();
    }
  }, 60000);
});
