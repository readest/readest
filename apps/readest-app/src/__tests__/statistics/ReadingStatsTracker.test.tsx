import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookProgress } from '@/types/book';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  getBookData: vi.fn(() => null as unknown),
  progress: null as BookProgress | null,
  playbackState: null as 'playing' | 'paused' | null,
  db: {
    upsertBook: vi.fn(),
    insertPageEvent: vi.fn(),
    recomputeBookTotals: vi.fn(),
  },
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => mocks.progress,
  getBookProgress: () => mocks.progress,
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => mocks.getBookData,
}));
vi.mock('@/services/statistics/statisticsDb', () => ({
  StatisticsDb: { open: mocks.open },
}));
vi.mock('@/services/statistics/statsSync', () => ({
  pushStats: vi.fn(),
  pullStats: vi.fn(),
}));
vi.mock('@/services/sync/syncCategories', () => ({ isSyncCategoryEnabled: () => false }));
vi.mock('@/libs/sync', () => ({ SyncClient: class {} }));
vi.mock('@/services/tts/TTSSessionManager', () => ({
  ttsSessionManager: {
    getPlaybackState: () => mocks.playbackState,
    getActiveSession: () => (mocks.playbackState ? { bookHash: 'hash1' } : null),
  },
  getBookHashFromKey: (key: string) => key.split('-')[0],
}));

import { eventDispatcher } from '@/utils/event';
import ReadingStatsTracker from '@/app/reader/components/ReadingStatsTracker';

describe('ReadingStatsTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('contains a database-open failure instead of leaking an unhandled rejection', async () => {
    const error = new Error('synthetic database open failure');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.open.mockRejectedValueOnce(error);

    render(<ReadingStatsTracker bookKey='book-1' />);

    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('[stats] background operation failed:', error);
    });
  });
});

describe('ReadingStatsTracker while TTS plays', () => {
  const BOOK_KEY = 'hash1-view1';

  const setPage = (current: number) => {
    mocks.progress = {
      pageinfo: { current, next: current + 1, total: 100 },
    } as unknown as BookProgress;
  };

  const mount = () => render(<ReadingStatsTracker bookKey={BOOK_KEY} />);

  const settle = async (ms = 0) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  const emitPlaybackState = async (state: string, bookKey = BOOK_KEY) => {
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', { bookKey, state });
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.open.mockResolvedValue(mocks.db);
    mocks.db.upsertBook.mockResolvedValue(1);
    mocks.db.insertPageEvent.mockResolvedValue(undefined);
    mocks.db.recomputeBookTotals.mockResolvedValue(undefined);
    mocks.getBookData.mockReturnValue({
      book: { hash: 'md5-1', title: 'Book', author: 'Author' },
    } as unknown as null);
    mocks.playbackState = null;
    setPage(0);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('records page dwell normally when TTS is idle', async () => {
    const { rerender } = mount();
    await settle();

    await settle(30_000);
    setPage(1);
    rerender(<ReadingStatsTracker bookKey={BOOK_KEY} />);
    await settle();

    expect(mocks.db.insertPageEvent).toHaveBeenCalled();
  });

  it('stops recording page dwell while TTS is playing', async () => {
    const { rerender } = mount();
    await settle();
    await emitPlaybackState('playing');

    await settle(30_000);
    setPage(1);
    rerender(<ReadingStatsTracker bookKey={BOOK_KEY} />);
    await settle(30_000);
    setPage(2);
    rerender(<ReadingStatsTracker bookKey={BOOK_KEY} />);
    await settle();

    expect(mocks.db.insertPageEvent).not.toHaveBeenCalled();
  });

  it('resumes recording once TTS stops', async () => {
    const { rerender } = mount();
    await settle();
    await emitPlaybackState('playing');
    await settle(30_000);
    await emitPlaybackState('stopped');

    await settle(30_000);
    setPage(1);
    rerender(<ReadingStatsTracker bookKey={BOOK_KEY} />);
    await settle();

    expect(mocks.db.insertPageEvent).toHaveBeenCalled();
  });

  it('starts dormant when mounted into an already-playing session', async () => {
    mocks.playbackState = 'playing';
    const { rerender } = mount();
    await settle();

    await settle(30_000);
    setPage(1);
    rerender(<ReadingStatsTracker bookKey={BOOK_KEY} />);
    await settle();

    expect(mocks.db.insertPageEvent).not.toHaveBeenCalled();
  });

  it('keeps recording when another book is the one being read aloud', async () => {
    const { rerender } = mount();
    await settle();
    await emitPlaybackState('playing', 'hash2-view1');

    await settle(30_000);
    setPage(1);
    rerender(<ReadingStatsTracker bookKey={BOOK_KEY} />);
    await settle();

    expect(mocks.db.insertPageEvent).toHaveBeenCalled();
  });
});
