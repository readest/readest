import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  appService: {},
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: mocks.appService }) }));
vi.mock('@/services/statistics/statisticsDb', () => ({
  StatisticsDb: { open: mocks.open },
}));

import type { Book } from '@/types/book';
import {
  useMedianPageDurationSecs,
  useMedianPageDurationsSecs,
} from '@/hooks/useMedianPageDurationSecs';

describe('useMedianPageDurationSecs', () => {
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

    renderHook(() => useMedianPageDurationSecs('md5-1'));

    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('[stats] median page duration failed:', error);
    });
  });
});

describe('useMedianPageDurationsSecs', () => {
  afterEach(cleanup);
  it('refreshes shelf paces when books change and ignores stale loads', async () => {
    let finishFirst!: (values: Record<string, number>) => void;
    const readPaces = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Record<string, number>>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ fast: 15, slow: 120 });
    mocks.open.mockResolvedValue({ getMedianPageDurationsSecs: readPaces });
    const books: Book[] = [];
    const { result, rerender } = renderHook(
      ({ books }) => useMedianPageDurationsSecs(books, true),
      { initialProps: { books } },
    );
    await waitFor(() => expect(readPaces).toHaveBeenCalledTimes(1));
    rerender({ books: [...books] });
    await waitFor(() => expect(result.current).toEqual({ fast: 15, slow: 120 }));
    finishFirst({ slow: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toEqual({ fast: 15, slow: 120 });
  });
});
