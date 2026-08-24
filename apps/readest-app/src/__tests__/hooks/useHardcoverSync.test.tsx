import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const HARDCOVER_SYNC_DEBOUNCE_MS = 10000;

const h = vi.hoisted(() => {
  const makeStore = <T,>(state: T) => {
    const fn = <R,>(selector?: (s: T) => R) => (selector ? selector(state) : state) as R | T;
    (fn as unknown as { getState: () => T }).getState = () => state;
    return fn as {
      (): T;
      <R>(selector: (s: T) => R): R;
      getState: () => T;
    };
  };

  const book = { hash: 'h1', format: 'EPUB', metaHash: 'm1' };

  return {
    makeStore,
    book,
    // Mutable settings — tests flip `hardcover.autoSync` between renders.
    settings: {
      hardcover: {
        enabled: true,
        accessToken: 'tok',
        autoSync: false,
        lastSyncedAt: 0,
      } as {
        enabled: boolean;
        accessToken: string;
        autoSync?: boolean;
        lastSyncedAt: number;
      },
    },
    config: {
      progress: [5, 100] as [number, number],
      booknotes: [] as Array<{ type: string; deletedAt?: number }>,
      hardcover: undefined as { bookId: number; title: string } | undefined,
    },
    state: {
      progress: { location: 'cfi-loc' } as { location: string } | null,
    },
    resolvedLink: { bookId: 202, title: 'Resolved Title' },
    setSettingsMock: vi.fn(),
    saveSettingsMock: vi.fn(async () => {}),
    setConfigMock: vi.fn(),
    saveConfigMock: vi.fn(async () => {}),
    pushProgressMock: vi.fn(async () => ({ bookId: 202, title: 'Resolved Title' })),
    syncBookNotesMock: vi.fn(async () => ({
      inserted: 1,
      updated: 0,
      skipped: 0,
      link: { bookId: 202, title: 'Resolved Title' },
    })),
    toasts: [] as Array<{ message: string; type: string }>,
    eventListeners: new Map<string, Set<(e: CustomEvent) => void>>(),
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => ({}) } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: h.makeStore({
    settings: h.settings,
    setSettings: h.setSettingsMock,
    saveSettings: h.saveSettingsMock,
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.config,
    getBookData: () => ({ book: h.book }),
    setConfig: h.setConfigMock,
    saveConfig: h.saveConfigMock,
  }),
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => h.state.progress,
}));

vi.mock('@/services/hardcover', () => ({
  HardcoverClient: class {
    pushProgress() {
      return h.pushProgressMock();
    }
    syncBookNotes() {
      return h.syncBookNotesMock();
    }
  },
  HardcoverSyncMapStore: class {},
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
      if (name === 'toast') h.toasts.push(detail as { message: string; type: string });
      const listeners = h.eventListeners.get(name);
      if (!listeners) return;
      const event = new CustomEvent(name, { detail });
      for (const fn of [...listeners]) fn(event);
    },
  },
}));

import { useHardcoverSync } from '@/app/reader/hooks/useHardcoverSync';

const flushMicrotasks = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await flushMicrotasks();
  });
};

const dispatch = (name: string, detail: unknown) =>
  h.eventListeners.get(name)?.forEach((fn) => fn(new CustomEvent(name, { detail })));

beforeEach(() => {
  vi.useFakeTimers();
  h.settings.hardcover = { enabled: true, accessToken: 'tok', autoSync: false, lastSyncedAt: 0 };
  h.config = { progress: [5, 100], booknotes: [], hardcover: undefined };
  h.state.progress = { location: 'cfi-loc' };
  h.pushProgressMock.mockClear();
  h.syncBookNotesMock.mockClear();
  h.setSettingsMock.mockClear();
  h.saveSettingsMock.mockClear();
  h.setConfigMock.mockClear();
  h.saveConfigMock.mockClear();
  h.toasts.length = 0;
  h.eventListeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('useHardcoverSync auto sync', () => {
  test('pushes progress automatically (silently) on page turn when autoSync is on', async () => {
    h.settings.hardcover.autoSync = true;
    const { rerender } = renderHook(() => useHardcoverSync('h1-view1'));

    // Simulate a page turn.
    h.state.progress = { location: 'cfi-loc-2' };
    rerender();
    await advance(HARDCOVER_SYNC_DEBOUNCE_MS + 100);

    expect(h.pushProgressMock).toHaveBeenCalledTimes(1);
    // Auto-sync must be silent — no success toast on every page turn.
    expect(h.toasts).toHaveLength(0);
  });

  test('does NOT auto-push progress when autoSync is off', async () => {
    h.settings.hardcover.autoSync = false;
    const { rerender } = renderHook(() => useHardcoverSync('h1-view1'));

    h.state.progress = { location: 'cfi-loc-2' };
    rerender();
    await advance(HARDCOVER_SYNC_DEBOUNCE_MS + 100);

    expect(h.pushProgressMock).not.toHaveBeenCalled();
  });

  test('pushes notes automatically when booknotes change and autoSync is on', async () => {
    h.settings.hardcover.autoSync = true;
    const { rerender } = renderHook(() => useHardcoverSync('h1-view1'));

    h.config = { progress: [5, 100], booknotes: [{ type: 'annotation' }], hardcover: undefined };
    rerender();
    await advance(HARDCOVER_SYNC_DEBOUNCE_MS + 100);

    expect(h.syncBookNotesMock).toHaveBeenCalledTimes(1);
  });

  test('does NOT auto-push notes when autoSync is off', async () => {
    h.settings.hardcover.autoSync = false;
    const { rerender } = renderHook(() => useHardcoverSync('h1-view1'));

    h.config = { progress: [5, 100], booknotes: [{ type: 'annotation' }], hardcover: undefined };
    rerender();
    await advance(HARDCOVER_SYNC_DEBOUNCE_MS + 100);

    expect(h.syncBookNotesMock).not.toHaveBeenCalled();
  });

  test('sync-book-progress flushes a pending auto-push immediately', async () => {
    h.settings.hardcover.autoSync = true;
    const { rerender } = renderHook(() => useHardcoverSync('h1-view1'));

    h.state.progress = { location: 'cfi-loc-2' };
    rerender();

    // Without advancing the full debounce window, the close-flush event should
    // force the pending push out.
    await act(async () => {
      dispatch('sync-book-progress', { bookKey: 'h1-view1' });
      await flushMicrotasks();
    });

    expect(h.pushProgressMock).toHaveBeenCalledTimes(1);
  });
});

describe('useHardcoverSync remembers the matched book (#5846)', () => {
  test('records the resolved Hardcover book after a manual progress push when none is linked', async () => {
    renderHook(() => useHardcoverSync('h1-view1'));

    await act(async () => {
      dispatch('hardcover-push-progress', { bookKey: 'h1-view1' });
      await flushMicrotasks();
    });

    expect(h.saveConfigMock).toHaveBeenCalledTimes(1);
    expect(h.saveConfigMock).toHaveBeenCalledWith(
      expect.anything(),
      'h1-view1',
      expect.objectContaining({ hardcover: h.resolvedLink }),
      h.settings,
    );
    expect(h.setConfigMock).toHaveBeenCalledWith('h1-view1', { hardcover: h.resolvedLink });
  });

  test('records the resolved Hardcover book after a notes push', async () => {
    h.config = { progress: [5, 100], booknotes: [{ type: 'annotation' }], hardcover: undefined };
    renderHook(() => useHardcoverSync('h1-view1'));

    await act(async () => {
      dispatch('hardcover-push-notes', { bookKey: 'h1-view1' });
      await flushMicrotasks();
    });

    expect(h.setConfigMock).toHaveBeenCalledWith('h1-view1', { hardcover: h.resolvedLink });
  });

  test('leaves the config alone when the same book is already linked', async () => {
    h.config = { progress: [5, 100], booknotes: [], hardcover: { ...h.resolvedLink } };
    renderHook(() => useHardcoverSync('h1-view1'));

    await act(async () => {
      dispatch('hardcover-push-progress', { bookKey: 'h1-view1' });
      await flushMicrotasks();
    });

    expect(h.pushProgressMock).toHaveBeenCalledTimes(1);
    expect(h.saveConfigMock).not.toHaveBeenCalled();
    expect(h.setConfigMock).not.toHaveBeenCalled();
  });

  test('never overwrites a link the user stored while the push was in flight', async () => {
    // The push snapshot had no link; the user picked a different book in
    // "Link Book" before it resolved. The manual choice must survive.
    h.config = { progress: [5, 100], booknotes: [], hardcover: { bookId: 999, title: 'Chosen' } };
    renderHook(() => useHardcoverSync('h1-view1'));

    await act(async () => {
      dispatch('hardcover-push-progress', { bookKey: 'h1-view1' });
      await flushMicrotasks();
    });

    expect(h.pushProgressMock).toHaveBeenCalledTimes(1);
    expect(h.saveConfigMock).not.toHaveBeenCalled();
    expect(h.setConfigMock).not.toHaveBeenCalled();
  });

  test('reports a failed manual push instead of claiming success', async () => {
    h.pushProgressMock.mockRejectedValueOnce(new Error('Unable to resolve this book in Hardcover'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() => useHardcoverSync('h1-view1'));

    await act(async () => {
      dispatch('hardcover-push-progress', { bookKey: 'h1-view1' });
      await flushMicrotasks();
    });

    expect(h.toasts).toEqual([
      {
        message: 'Hardcover progress sync failed: {{error}}',
        type: 'error',
      },
    ]);
    expect(h.saveConfigMock).not.toHaveBeenCalled();
  });
});
