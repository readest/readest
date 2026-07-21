import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  getBookData: vi.fn(() => null),
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/store/readerProgressStore', () => ({ useBookProgress: () => null }));
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
