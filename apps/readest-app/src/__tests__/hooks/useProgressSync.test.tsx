import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => {
  // Zustand-like store mock: callable selector returning `state`, plus `.getState()`.
  const makeStore = <T,>(state: T) => {
    const fn = () => state;
    (fn as unknown as { getState: () => T }).getState = () => state;
    return fn as (() => T) & { getState: () => T };
  };

  const book = {
    hash: 'h1',
    format: 'PDF',
    metaHash: 'm1',
    updatedAt: 2000,
    progress: [5, 100] as [number, number],
  };
  const config = {
    progress: [5, 100] as [number, number],
    location: 'cfi-loc',
    updatedAt: 1000,
  };
  const libraryBook = { hash: 'h1', updatedAt: 2000, progress: [5, 100] as [number, number] };

  return {
    makeStore,
    book,
    config,
    libraryBook,
    user: { id: 'u1' },
    syncConfigsMock: vi.fn(async () => {}),
    syncBooksMock: vi.fn(async () => {}),
    setConfigMock: vi.fn(),
    cfiCompareMock: vi.fn((_a: string, _b: string) => 0),
    view: { renderer: { getContents: () => [], primaryIndex: 0 }, goTo: vi.fn() },
    state: {
      syncedConfigs: [] as unknown[] | null,
      progress: { location: 'cfi-loc' } as { location: string } | null,
    },
    eventListeners: new Map<string, Set<(e: CustomEvent) => void>>(),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: h.user }),
}));

vi.mock('@/hooks/useSync', () => ({
  useSync: () => ({
    syncedConfigs: h.state.syncedConfigs,
    syncConfigs: h.syncConfigsMock,
    syncBooks: h.syncBooksMock,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.config,
    setConfig: h.setConfigMock,
    getBookData: () => ({ book: h.book }),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({
    getView: () => h.view,
    getProgress: () => h.state.progress,
    setHoveredBookKey: vi.fn(),
    getViewState: () => ({ previewMode: false }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: h.makeStore({ settings: { globalViewSettings: {} } }),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: h.makeStore({ library: [h.libraryBook] }),
}));

vi.mock('@/utils/serializer', () => ({
  serializeConfig: () => JSON.stringify({ progress: [5, 100], location: 'cfi-loc' }),
}));

vi.mock('@/utils/xcfi', () => ({
  getCFIFromXPointer: vi.fn(async () => ''),
  getXPointerFromCFI: vi.fn(async () => ({ xpointer: '' })),
}));

vi.mock('@/libs/document', () => ({
  CFI: { compare: (a: string, b: string) => h.cfiCompareMock(a, b) },
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    on: (name: string, fn: (e: CustomEvent) => void) => {
      const set = h.eventListeners.get(name) ?? new Set();
      set.add(fn);
      h.eventListeners.set(name, set);
    },
    off: (name: string, fn: (e: CustomEvent) => void) => {
      h.eventListeners.get(name)?.delete(fn);
    },
    dispatch: (name: string, detail: unknown) => {
      const listeners = h.eventListeners.get(name);
      if (!listeners) return;
      const event = new CustomEvent(name, { detail });
      for (const fn of [...listeners]) fn(event);
    },
  },
}));

import { useProgressSync } from '@/app/reader/hooks/useProgressSync';
import { SYNC_PROGRESS_INTERVAL_SEC } from '@/services/constants';

const flushAutoSync = async () => {
  await act(async () => {
    vi.advanceTimersByTime(SYNC_PROGRESS_INTERVAL_SEC * 1000 + 100);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  h.syncConfigsMock.mockClear();
  h.syncBooksMock.mockClear();
  h.setConfigMock.mockClear();
  h.view.goTo.mockClear();
  h.cfiCompareMock.mockReset();
  h.cfiCompareMock.mockReturnValue(0);
  h.state.syncedConfigs = [];
  h.state.progress = { location: 'cfi-loc' };
  h.eventListeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const flushMicrotasks = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await flushMicrotasks();
  });
};

const pullCallCount = () =>
  h.syncConfigsMock.mock.calls.filter((c) => (c as unknown[])[3] === 'pull').length;
const pushCallCount = () =>
  h.syncConfigsMock.mock.calls.filter((c) => (c as unknown[])[3] === 'push').length;

describe('useProgressSync', () => {
  test('auto-sync push only hits the configs lane; the server piggybacks books.progress', async () => {
    // Issue #4198 used to be fixed by a second syncBooks call from the
    // reader so that other devices' library pull-to-refresh would see fresh
    // progress while a reader stayed open. The /api/sync POST handler now
    // updates books.progress + books.updated_at off the same configs push,
    // so the reader-side syncBooks round-trip is gone.
    renderHook(() => useProgressSync('h1-view1'));
    await flushAutoSync();

    expect(h.syncConfigsMock).toHaveBeenCalledWith(expect.any(Array), 'h1', 'm1', 'push');
    expect(h.syncBooksMock).not.toHaveBeenCalled();
  });

  test('retries the first pull on failure with backoff, then releases the gate', async () => {
    // Pull failure is simulated by a mock that resolves without ever flipping
    // h.state.syncedConfigs to a non-null array — the same observable state
    // as a real pullChanges that threw and skipped setSyncResult. Without
    // retries the configs sync would be stuck on this single failed attempt
    // for the whole reader session (handleAutoSync only re-arms on
    // progress.location changes), so the user's progress never reaches the
    // server until they reopen the book.
    h.state.syncedConfigs = null;
    const { rerender } = renderHook(() => useProgressSync('h1-view1'));

    // Initial attempt fires from the [progress] effect on mount.
    await advance(0);
    expect(pullCallCount()).toBe(1);

    // First backoff = 1500ms.
    await advance(1500);
    expect(pullCallCount()).toBe(2);

    // Second backoff = 4000ms.
    await advance(4000);
    expect(pullCallCount()).toBe(3);

    // Third backoff = 10000ms.
    await advance(10000);
    expect(pullCallCount()).toBe(4);

    // Gate released after exhausted retries — a subsequent location change
    // takes the push branch instead of queueing another pull. Simulate the
    // user paginating: mutate the shared progress state and force a render
    // so the [progress?.location] effect re-arms handleAutoSync.
    h.state.progress = { location: 'cfi-loc-next' };
    rerender();
    await advance(SYNC_PROGRESS_INTERVAL_SEC * 1000 + 100);
    expect(pushCallCount()).toBeGreaterThanOrEqual(1);
  });

  test('a successful pull cancels the pending retry chain', async () => {
    // Render with the default mock (syncedConfigs = [], which the [syncedConfigs]
    // effect treats as a successful empty pull → configPulled flips on mount).
    renderHook(() => useProgressSync('h1-view1'));

    await advance(0);
    const initialPulls = pullCallCount();

    // Wait past every retry window — nothing should fire because the gate
    // is already open and the retry timer was cancelled.
    await advance(20000);
    expect(pullCallCount()).toBe(initialPulls);
  });

  test('discards a malformed synced location instead of navigating to it', async () => {
    // An empty-start range CFI left by the cfi-inert skip-link bug. compare()
    // returns -1 so it would "win" and drive a goTo if it were not discarded.
    h.cfiCompareMock.mockReturnValue(-1);
    h.state.syncedConfigs = [
      { bookHash: 'h1', metaHash: 'm1', location: 'epubcfi(/6/24!/4,,/20/1:58)', updatedAt: 3000 },
    ];
    renderHook(() => useProgressSync('h1-view1'));
    await advance(0);

    // Not navigated to, and not persisted into the local config (the local
    // 'cfi-loc' is kept instead of the malformed remote value).
    expect(h.view.goTo).not.toHaveBeenCalled();
    const persisted = h.setConfigMock.mock.calls.at(-1)?.[1] as { location?: string } | undefined;
    expect(persisted?.location).toBe('cfi-loc');
  });

  test('navigates to a well-formed newer synced location', async () => {
    h.cfiCompareMock.mockReturnValue(-1);
    h.state.syncedConfigs = [
      { bookHash: 'h1', metaHash: 'm1', location: 'epubcfi(/6/24!/4/20/1:58)', updatedAt: 3000 },
    ];
    renderHook(() => useProgressSync('h1-view1'));
    await advance(0);

    expect(h.view.goTo).toHaveBeenCalledWith('epubcfi(/6/24!/4/20/1:58)');
  });

  test('sync-book-progress event resets and re-runs the pull chain', async () => {
    h.state.syncedConfigs = null;
    renderHook(() => useProgressSync('h1-view1'));

    await advance(0);
    // Let one backoff fire, then user invokes a manual refresh.
    await advance(1500);
    const callsBeforeRefresh = pullCallCount();
    expect(callsBeforeRefresh).toBe(2);

    act(() => {
      const listeners = h.eventListeners.get('sync-book-progress');
      listeners?.forEach((fn) =>
        fn(new CustomEvent('sync-book-progress', { detail: { bookKey: 'h1-view1' } })),
      );
    });
    await flushMicrotasks();
    // The refresh issues a fresh pull immediately.
    expect(pullCallCount()).toBe(callsBeforeRefresh + 1);

    // And the retry chain restarts from delay[0].
    await advance(1500);
    expect(pullCallCount()).toBe(callsBeforeRefresh + 2);
  });

  test('sync-book-progress flushes the pending cloud push on book close', async () => {
    // Reproduces issue #4532: the reader is closed inside the 3s auto-sync
    // debounce window, so the pending Readest cloud push would otherwise be
    // dropped on unmount and never reach the cloud.
    // Mount: the empty pull settles and opens the gate (configPulled = true).
    const { rerender } = renderHook(() => useProgressSync('h1-view1'));
    await advance(0);
    expect(pushCallCount()).toBe(0);

    // User paginates to a new position — this arms the 3s auto-sync debounce.
    h.state.progress = { location: 'cfi-loc-next' };
    await act(async () => {
      rerender();
      await flushMicrotasks();
    });
    // The debounce has not fired yet, so nothing has been pushed.
    expect(pushCallCount()).toBe(0);

    // Closing the reader dispatches sync-book-progress within the debounce
    // window — before the 3s timer would have fired.
    await act(async () => {
      const listeners = h.eventListeners.get('sync-book-progress');
      listeners?.forEach((fn) =>
        fn(new CustomEvent('sync-book-progress', { detail: { bookKey: 'h1-view1' } })),
      );
      await flushMicrotasks();
    });

    // The pending push is flushed immediately — Device A's last local position
    // reaches the cloud before the reader tears down.
    expect(pushCallCount()).toBeGreaterThanOrEqual(1);
  });
});
