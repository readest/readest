import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
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
  LibraryPageDurationsContext,
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

  it('uses current batch values for every card without reading per-book statistics', () => {
    const getBookByMd5 = vi.fn();
    const getMedianPageDurationSecs = vi.fn();
    mocks.open.mockResolvedValue({ getBookByMd5, getMedianPageDurationSecs });
    let durations: Record<string, number> = { fast: 15, slow: 120 };
    const { result, rerender } = renderHook(
      () => [
        useMedianPageDurationSecs('fast'),
        useMedianPageDurationSecs('slow'),
        useMedianPageDurationSecs('missing'),
      ],
      {
        wrapper: ({ children }) => (
          <LibraryPageDurationsContext.Provider value={durations}>
            {children}
          </LibraryPageDurationsContext.Provider>
        ),
      },
    );

    expect(result.current).toEqual([15, 120, null]);
    durations = { fast: 30, missing: 60 };
    rerender();
    expect(result.current).toEqual([30, null, 60]);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(getBookByMd5).not.toHaveBeenCalled();
    expect(getMedianPageDurationSecs).not.toHaveBeenCalled();
  });
});

describe('useMedianPageDurationsSecs', () => {
  beforeEach(() => {
    mocks.open.mockReset();
    mocks.appService = {};
  });
  afterEach(cleanup);

  it('shares one pending statistics load between library and preview consumers', async () => {
    let finishLoad!: (values: Record<string, number>) => void;
    const readPaces = vi.fn(
      () =>
        new Promise<Record<string, number>>((resolve) => {
          finishLoad = resolve;
        }),
    );
    mocks.open.mockResolvedValue({ getMedianPageDurationsSecs: readPaces });
    const books: Book[] = [];
    const library = renderHook(() => useMedianPageDurationsSecs(books, true));
    const preview = renderHook(() => useMedianPageDurationsSecs(books, true));

    await waitFor(() => expect(readPaces).toHaveBeenCalledOnce());
    const durations = { fast: 15, slow: 120 };
    await act(async () => finishLoad(durations));

    expect(library.result.current).toEqual(durations);
    expect(preview.result.current).toEqual(durations);
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(mocks.appService);
    expect(readPaces).toHaveBeenCalledOnce();
  });

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
