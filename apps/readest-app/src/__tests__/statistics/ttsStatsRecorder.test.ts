import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookConfig, BookProgress } from '@/types/book';
import type { TTSSession } from '@/services/tts/TTSSessionManager';

type CFIProgress = {
  fraction: number;
  section: { current: number; total: number };
  location: { current: number; next: number; total: number };
  time: { section: number; total: number };
};

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

const makeSession = (opts: {
  isViewAttached: boolean;
  getCFIProgress?: (cfi: string) => Promise<CFIProgress | null>;
}): TTSSession => {
  const controller = {
    isViewAttached: opts.isViewAttached,
    view: { getCFIProgress: opts.getCFIProgress ?? (async () => null) },
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

const cfiProgressAt = (fraction: number, location: number, locationTotal: number) => async () => ({
  fraction,
  section: { current: 2, total: 10 },
  location: { current: location, next: location + 1, total: locationTotal },
  time: { section: 0, total: 0 },
});

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

  it('derives the page from the TTS position when no view is attached', async () => {
    const getCFIProgress = vi.fn(cfiProgressAt(0.25, 40, 160));
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: false, getCFIProgress }));

    recorder.onMark('epubcfi(/6/8!/4/2)');
    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(90_000);
    await recorder.stop();

    // 0.25 through a book the layout last measured at 200 pages -> page 51,
    // on the same scale the reading tracker writes.
    expect(insertedEvents()[0]).toMatchObject({ page: 51, totalPages: 200 });
  });

  it('falls back to foliate locations when the book has no laid-out page count', async () => {
    mocks.config = { updatedAt: 0 } as BookConfig;
    const getCFIProgress = vi.fn(cfiProgressAt(0.25, 40, 160));
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: false, getCFIProgress }));

    recorder.onMark('epubcfi(/6/8!/4/2)');
    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(90_000);
    await recorder.stop();

    expect(insertedEvents()[0]).toMatchObject({ page: 41, totalPages: 160 });
  });

  it('resolves the headless page at most once per unchanged CFI', async () => {
    const getCFIProgress = vi.fn(cfiProgressAt(0.25, 40, 160));
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: false, getCFIProgress }));

    recorder.onMark('epubcfi(/6/8!/4/2)');
    recorder.onPlaybackState('playing');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await recorder.stop();

    expect(getCFIProgress).toHaveBeenCalledTimes(1);
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
    const getCFIProgress = vi.fn(async () => {
      throw new Error('synthetic resolve failure');
    });
    const recorder = new TtsStatsRecorder(makeSession({ isViewAttached: false, getCFIProgress }));

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
