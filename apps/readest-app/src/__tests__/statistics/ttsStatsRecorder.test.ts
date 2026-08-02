import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookConfig, BookProgress } from '@/types/book';
import type { TTSSession } from '@/services/tts/TTSSessionManager';

const mocks = vi.hoisted(() => ({
  progress: null as BookProgress | null,
  config: null as BookConfig | null,
  book: null as { hash: string; title: string; author: string } | null,
  db: {
    upsertBook: vi.fn(),
    insertPageEvent: vi.fn(),
    recomputeBookTotals: vi.fn(),
  },
  open: vi.fn(),
  pushStats: vi.fn(),
  syncEnabled: false,
  accessToken: null as string | null,
}));

vi.mock('@/services/environment', () => ({
  default: { getAppService: async () => ({}) },
}));
vi.mock('@/services/statistics/statisticsDb', () => ({
  StatisticsDb: { open: mocks.open },
}));
vi.mock('@/services/statistics/statsSync', () => ({ pushStats: mocks.pushStats }));
vi.mock('@/services/sync/syncCategories', () => ({
  isSyncCategoryEnabled: () => mocks.syncEnabled,
}));
vi.mock('@/libs/sync', () => ({ SyncClient: class {} }));
vi.mock('@/utils/access', () => ({ getAccessToken: async () => mocks.accessToken }));
vi.mock('@/store/readerProgressStore', () => ({ getBookProgress: () => mocks.progress }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({
      getBookData: () => (mocks.book ? { book: mocks.book } : null),
      getConfig: () => mocks.config,
    }),
  },
}));

import {
  pageFromFraction,
  TTS_STATS_HEARTBEAT_MS,
  TtsStatsRecorder,
} from '@/services/statistics/ttsStatsRecorder';

type RecordedEvent = { page: number; startTime: number; duration: number; totalPages: number };

const insertedEvents = (): RecordedEvent[] =>
  mocks.db.insertPageEvent.mock.calls.map((call) => (call as unknown[])[1] as RecordedEvent);

const totalDuration = () => insertedEvents().reduce((sum, e) => sum + e.duration, 0);

const makeDoc = (text: string) =>
  new DOMParser().parseFromString(`<html><body><p>${text}</p></body></html>`, 'text/html');

// Halfway through a 100-character third section. With sizes [1000, 1000, 2000]
// that is 3000/4000 = 0.75 of the way through the book.
const SECTION_TEXT_LENGTH = 100;
const sectionDocs = [makeDoc('a'), makeDoc('b'), makeDoc('x'.repeat(SECTION_TEXT_LENGTH))];

const makeBook = () => ({
  sections: sectionDocs.map((doc, i) => ({
    size: i === 2 ? 2000 : 1000,
    linear: 'yes',
    createDocument: async () => doc,
  })),
});

const resolveCFIToSectionMidpoint = () => ({
  index: 2,
  anchor: (doc: Document) => {
    const textNode = doc.body.firstChild!.firstChild!;
    const range = doc.createRange();
    range.setStart(textNode, SECTION_TEXT_LENGTH / 2);
    range.collapse(true);
    return range;
  },
});

/**
 * `view.close()` nulls the view's own progress helpers, so a headless session
 * only ever has the book and resolveCFI to work with. Model exactly that.
 */
const makeSession = (opts: { isViewAttached: boolean; hasBook?: boolean }): TTSSession => {
  const controller = {
    isViewAttached: opts.isViewAttached,
    view: {
      book: opts.hasBook === false ? undefined : makeBook(),
      resolveCFI: resolveCFIToSectionMidpoint,
    },
  };
  return {
    bookHash: 'hash-1',
    bookKey: 'hash-1-view1',
    controller,
  } as unknown as TTSSession;
};

const setViewPage = (current: number, total: number) => {
  mocks.progress = { pageinfo: { current, next: current + 1, total } } as unknown as BookProgress;
};

describe('pageFromFraction', () => {
  it('maps a fraction onto a 1-based page within the layout', () => {
    expect(pageFromFraction(0, 100)).toBe(1);
    expect(pageFromFraction(0.5, 100)).toBe(51);
    expect(pageFromFraction(0.999, 100)).toBe(100);
  });

  it('clamps out-of-range and degenerate inputs to a usable page', () => {
    expect(pageFromFraction(1, 100)).toBe(100);
    expect(pageFromFraction(-0.5, 100)).toBe(1);
    expect(pageFromFraction(Number.NaN, 100)).toBe(1);
    expect(pageFromFraction(0.5, 0)).toBe(1);
  });
});

describe('TtsStatsRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.open.mockResolvedValue(mocks.db);
    mocks.db.upsertBook.mockResolvedValue(1);
    mocks.db.insertPageEvent.mockResolvedValue(undefined);
    mocks.db.recomputeBookTotals.mockResolvedValue(undefined);
    mocks.pushStats.mockResolvedValue(undefined);
    mocks.book = { hash: 'md5-1', title: 'Book', author: 'Author' };
    mocks.config = { progress: [1, 200], updatedAt: 0 } as BookConfig;
    mocks.progress = null;
    mocks.syncEnabled = false;
    mocks.accessToken = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('credits listening time to the displayed page while a view is attached', async () => {
    setViewPage(9, 200);
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: true }));

    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(TTS_STATS_HEARTBEAT_MS);

    setViewPage(10, 200);
    await vi.advanceTimersByTimeAsync(TTS_STATS_HEARTBEAT_MS * 2);
    await recorder.stop();

    const events = insertedEvents();
    expect(events[0]).toMatchObject({ page: 10, totalPages: 200 });
    expect(events.some((e) => e.page === 11)).toBe(true);
  });

  it('renews the event on a long page so narration time is not lost to the 120s cap', async () => {
    setViewPage(9, 200);
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: true }));

    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await recorder.stop();

    const events = insertedEvents();
    expect(events.length).toBeGreaterThan(1);
    expect(events.every((e) => e.page === 10)).toBe(true);
    expect(events.every((e) => e.duration <= 120)).toBe(true);
    expect(totalDuration()).toBeGreaterThanOrEqual(290);
    expect(totalDuration()).toBeLessThanOrEqual(300);
  });

  it('stops accruing time while playback is paused', async () => {
    setViewPage(9, 200);
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: true }));

    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(60_000);
    recorder.onPlaybackState('paused');
    await vi.advanceTimersByTimeAsync(0);
    const afterPause = totalDuration();

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await recorder.stop();

    expect(afterPause).toBeGreaterThan(0);
    expect(totalDuration()).toBe(afterPause);
  });

  // Regression: the first implementation resolved the headless page through
  // view.getCFIProgress, but view.close() nulls the helpers that method depends
  // on - so closing the book (the only way to reach this path) guaranteed it
  // returned null and nothing was ever recorded.
  it('derives the page from the book itself once the view has been closed', async () => {
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: false }));

    recorder.onMark('epubcfi(/6/8!/4/2)');
    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(90_000);
    await recorder.stop();

    // 0.75 through a book the layout last measured at 200 pages -> page 151,
    // on the same scale the reading tracker writes.
    expect(insertedEvents()[0]).toMatchObject({ page: 151, totalPages: 200 });
  });

  it('falls back to foliate locations when the book has no laid-out page count', async () => {
    mocks.config = { updatedAt: 0 } as BookConfig;
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: false }));

    recorder.onMark('epubcfi(/6/8!/4/2)');
    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(90_000);
    await recorder.stop();

    // size 3000 of 4000 at 1500 bytes per location -> location 2 (0-based).
    expect(insertedEvents()[0]).toMatchObject({ page: 3, totalPages: 3 });
  });

  it('resolves the headless page at most once per unchanged CFI', async () => {
    const session = makeSession({ isViewAttached: false });
    const resolveCFI = vi.fn(resolveCFIToSectionMidpoint);
    (session.controller.view as unknown as { resolveCFI: unknown }).resolveCFI = resolveCFI;
    const recorder = new TtsStatsRecorder(session);

    recorder.onMark('epubcfi(/6/8!/4/2)');
    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await recorder.stop();

    expect(resolveCFI).toHaveBeenCalledTimes(1);
  });

  it('records nothing when the book is gone rather than guessing a page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: false, hasBook: false }));

    recorder.onMark('epubcfi(/6/8!/4/2)');
    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(90_000);
    await recorder.stop();

    expect(mocks.db.insertPageEvent).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('records nothing when the book identity is unavailable', async () => {
    mocks.book = null;
    setViewPage(9, 200);
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: true }));

    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(90_000);
    await recorder.stop();

    expect(mocks.db.insertPageEvent).not.toHaveBeenCalled();
  });

  it('keeps a failing CFI resolve from tearing down the session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = makeSession({ isViewAttached: false });
    (session.controller.view as unknown as { resolveCFI: unknown }).resolveCFI = () => {
      throw new Error('synthetic resolve failure');
    };
    const recorder = new TtsStatsRecorder(session);

    recorder.onMark('epubcfi(/6/8!/4/2)');
    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(90_000);
    await expect(recorder.stop()).resolves.toBeUndefined();

    expect(mocks.db.insertPageEvent).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('pushes stats on stop when stats sync is enabled and the user is signed in', async () => {
    setViewPage(9, 200);
    mocks.syncEnabled = true;
    mocks.accessToken = 'token';
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: true }));

    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(60_000);
    await recorder.stop();

    expect(mocks.pushStats).toHaveBeenCalled();
  });

  it('does not push stats when the user is signed out', async () => {
    setViewPage(9, 200);
    mocks.syncEnabled = true;
    mocks.accessToken = null;
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: true }));

    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(60_000);
    await recorder.stop();

    expect(mocks.pushStats).not.toHaveBeenCalled();
  });
});
