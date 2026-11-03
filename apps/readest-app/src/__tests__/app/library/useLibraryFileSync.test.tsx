import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Task 8 (issue #5062) — `useLibraryFileSync` was collapsed to a pure trigger:
 * it no longer builds an engine or talks to a backend itself, it only decides
 * WHEN to call `runFileLibrarySyncPass` (Task 7's shared pass, which owns
 * device ids, strategy, progress, lastSyncedAt, per-backend failure isolation
 * and the mutex). These tests cover the three things left in the hook's remit:
 *   - it debounces bursts of library changes into a single pass call
 *   - it never fires when no third-party backend is active
 *   - it never fires before the library has loaded from disk
 */

const routing = vi.hoisted(() => ({
  backends: [] as ('webdav' | 'gdrive' | 's3' | 'onedrive')[],
}));

const runFileLibrarySyncPass = vi.hoisted(() =>
  vi.fn(async (): Promise<{ booksSynced: number } | null> => null),
);

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string) => text,
}));

vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: 'free' }),
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  getActiveFileSyncBackends: () => routing.backends,
}));

vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runFileLibrarySyncPass,
}));

const { useLibraryFileSync } = await import('@/app/library/hooks/useLibraryFileSync');
const { useLibraryStore } = await import('@/store/libraryStore');

const book = (hash: string): Book =>
  ({
    hash,
    title: hash,
  }) as Book;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  routing.backends = [];
  useLibraryStore.setState({ library: [], libraryLoaded: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useLibraryFileSync trigger (issue #5062 Task 8)', () => {
  it('debounces a burst of library changes into a single pass call', async () => {
    routing.backends = ['webdav'];

    const { rerender } = renderHook(() => useLibraryFileSync());

    // Three library mutations in quick succession (e.g. an import burst).
    act(() => {
      useLibraryStore.setState({ library: [book('a')], libraryLoaded: true });
    });
    rerender();
    act(() => {
      vi.advanceTimersByTime(1_000);
      useLibraryStore.setState({ library: [book('a'), book('b')], libraryLoaded: true });
    });
    rerender();
    act(() => {
      vi.advanceTimersByTime(1_000);
      useLibraryStore.setState({
        library: [book('a'), book('b'), book('c')],
        libraryLoaded: true,
      });
    });
    rerender();

    expect(runFileLibrarySyncPass).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(runFileLibrarySyncPass).toHaveBeenCalledTimes(1);
  });

  it('does not fire when no backend is active', async () => {
    routing.backends = [];

    const { rerender } = renderHook(() => useLibraryFileSync());

    act(() => {
      useLibraryStore.setState({ library: [book('a')], libraryLoaded: true });
    });
    rerender();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(runFileLibrarySyncPass).not.toHaveBeenCalled();
  });

  it('does not fire before the library has loaded', async () => {
    routing.backends = ['webdav'];
    useLibraryStore.setState({ library: [], libraryLoaded: false });

    const { rerender } = renderHook(() => useLibraryFileSync());

    act(() => {
      useLibraryStore.setState({ library: [book('a')], libraryLoaded: false });
    });
    rerender();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(runFileLibrarySyncPass).not.toHaveBeenCalled();
  });

  it('keeps the debounced trigger stable across unrelated re-renders', async () => {
    // Regression test for #5062: if the debounce is recreated on every render
    // (no useMemo), the effect dependency changes on every render, causing the
    // debounced sync to be called and rescheduled on every render. Without the
    // debounce being stable (memoized), each rerender pushes the timer further
    // into the future, potentially preventing it from firing in a timely manner.
    routing.backends = ['webdav'];

    const { rerender } = renderHook(() => useLibraryFileSync());

    act(() => {
      useLibraryStore.setState({ library: [book('a')], libraryLoaded: true });
    });
    rerender();
    // At this point, debouncedSync() was called, scheduling a timer for 5000ms.
    // With stable memoized debounce: timer stays at 5000.
    // With unstable per-render debounce: timer will be rescheduled on each rerender.

    // Simulate unrelated re-renders (not caused by library mutations) spaced
    // 1 second apart. With unstable debounce, each rerender reschedules the timer.
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      rerender();
    }
    // At time 4000ms:
    // - Stable: timer scheduled for 5000, not yet fired
    // - Unstable: timer scheduled for 9000, not yet fired

    expect(runFileLibrarySyncPass).not.toHaveBeenCalled();

    // Advance to time 5000 and rerender. The stable timer fires,
    // but the unstable timer gets rescheduled to 10000.
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    rerender();

    // With stable memoized debounce, timer fires at 5000: 1 call.
    // With unstable per-render debounce, timer is rescheduled at time 5000: 0 calls.
    expect(runFileLibrarySyncPass).toHaveBeenCalledTimes(1);
  });
});
