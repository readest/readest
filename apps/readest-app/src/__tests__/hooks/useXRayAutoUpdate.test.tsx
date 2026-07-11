import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BookProgress } from '@/types/book';

const h = vi.hoisted(() => ({
  updateXRayForProgress: vi.fn(async () => {}),
  getXRayState: vi.fn(async () => null),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({
      book: { title: 'Test Book', metadata: {} },
    }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      aiSettings: {
        enabled: true,
        provider: 'ai-gateway',
        aiGatewayApiKey: 'test-key',
      },
    },
  }),
}));

vi.mock('@/services/ai', () => ({
  aiStore: { getXRayState: h.getXRayState },
}));

vi.mock('@/services/ai/xrayService', () => ({
  updateXRayForProgress: h.updateXRayForProgress,
}));

import { useXRayAutoUpdate } from '@/app/reader/hooks/useXRayAutoUpdate';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';

const bookKey = 'book-hash-view';

const makeProgress = (current: number): BookProgress => ({
  location: `location-${current}`,
  sectionHref: 'chapter.xhtml',
  sectionLabel: 'Chapter',
  section: { current, total: 10 },
  pageinfo: { current, total: 10 },
  timeinfo: { section: 1, total: 10 },
  fraction: current / 10,
  index: 0,
  range: new Range(),
  page: current,
});

const flushTimers = async (milliseconds: number) => {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  h.updateXRayForProgress.mockReset().mockResolvedValue(undefined);
  h.getXRayState.mockReset().mockResolvedValue(null);
  setBookProgress(bookKey, makeProgress(1));
});

afterEach(() => {
  clearBookProgress(bookKey);
  cleanup();
  vi.useRealTimers();
});

describe('useXRayAutoUpdate', () => {
  test('schedules another X-Ray update when the reader advances to a new page', async () => {
    renderHook(() => useXRayAutoUpdate(bookKey));
    await flushTimers(0);

    expect(h.updateXRayForProgress).toHaveBeenCalledTimes(1);
    expect(h.updateXRayForProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentPage: 1 }),
    );

    act(() => setBookProgress(bookKey, makeProgress(2)));
    await flushTimers(0);
    act(() => setBookProgress(bookKey, makeProgress(3)));
    await flushTimers(2999);

    expect(h.updateXRayForProgress).toHaveBeenCalledTimes(1);

    await flushTimers(1);
    await flushTimers(1);

    expect(h.updateXRayForProgress).toHaveBeenCalledTimes(2);
    expect(h.updateXRayForProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentPage: 3 }),
    );
  });

  test('processes the latest page after an in-flight update completes', async () => {
    let resolveFirstUpdate!: () => void;
    h.updateXRayForProgress
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstUpdate = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    renderHook(() => useXRayAutoUpdate(bookKey));
    await flushTimers(0);
    expect(h.updateXRayForProgress).toHaveBeenCalledTimes(1);

    act(() => setBookProgress(bookKey, makeProgress(2)));
    act(() => setBookProgress(bookKey, makeProgress(3)));
    await flushTimers(3000);
    await flushTimers(0);

    expect(h.updateXRayForProgress).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstUpdate();
      await Promise.resolve();
    });
    await flushTimers(1);

    expect(h.updateXRayForProgress).toHaveBeenCalledTimes(2);
    expect(h.updateXRayForProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentPage: 3 }),
    );
  });
});
