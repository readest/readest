import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

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

const SPEAK_DELAY_MS = 25;

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
      await new Promise((r) => setTimeout(r, SPEAK_DELAY_MS));
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
    supportsWordBoundaries: () => false,
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
  EdgeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, makeMockTTSClient('edge'));
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
});
