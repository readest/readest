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
    UnmatchedError: class extends Error {},
    AuthError: class extends Error {},
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
        oauth?: { accessToken: string };
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
    clientCtorMock: vi.fn(),
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
    constructor() {
      h.clientCtorMock();
    }
    pushProgress() {
      return h.pushProgressMock();
    }
    syncBookNotes() {
      return h.syncBookNotesMock();
    }
  },
  HardcoverSyncMapStore: class {},
  HardcoverUnmatchedError: h.UnmatchedError,
  HardcoverAuthError: h.AuthError,
  isHardcoverConnected: (hc?: { accessToken?: string; oauth?: { accessToken?: string } }) =>
    !!(hc?.accessToken || hc?.oauth?.accessToken),
  createHardcoverTokenStore: vi.fn(),
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
import { useHardcoverSyncStore } from '@/store/hardcoverSyncStore';

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
  h.clientCtorMock.mockClear();
  h.pushProgressMock.mockClear();
  h.syncBookNotesMock.mockClear();
  h.setSettingsMock.mockClear();
  h.saveSettingsMock.mockClear();
  h.setConfigMock.mockClear();
  h.saveConfigMock.mockClear();
  h.toasts.length = 0;
  h.eventListeners.clear();
  useHardcoverSyncStore.setState({ byBook: {} });
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

  test('flush-hardcover-sync flushes a pending auto-push immediately', async () => {
    h.settings.hardcover.autoSync = true;
    const { rerender } = renderHook(() => useHardcoverSync('h1-view1'));

    h.state.progress = { location: 'cfi-loc-2' };
    rerender();

    // Without advancing the full debounce window, the close-flush event should
    // force the pending push out.
    await act(async () => {
      dispatch('flush-hardcover-sync', { bookKey: 'h1-view1' });
      await flushMicrotasks();
    });

    expect(h.pushProgressMock).toHaveBeenCalledTimes(1);
  });
});

describe('useHardcoverSync Readest Cloud sync event', () => {
  test('sync-book-progress does not push Hardcover', async () => {
    h.settings.hardcover.autoSync = true;
    const { rerender } = renderHook(() => useHardcoverSync('h1-view1'));

    h.state.progress = { location: 'cfi-loc-2' };
    rerender();
    await act(async () => {
      dispatch('sync-book-progress', { bookKey: 'h1-view1' });
      await flushMicrotasks();
    });

    expect(h.pushProgressMock).not.toHaveBeenCalled();
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

describe('useHardcoverSync silent manual push (sync row)', () => {
  const pushAll = async (detail: object) =>
    act(async () => {
      dispatch('hardcover-push-progress', { bookKey: 'h1-view1', ...detail });
      dispatch('hardcover-push-notes', { bookKey: 'h1-view1', ...detail });
      await flushMicrotasks();
    });

  test('pushes without any toast, including when Hardcover is not configured', async () => {
    h.config = { progress: [5, 100], booknotes: [{ type: 'annotation' }], hardcover: undefined };
    renderHook(() => useHardcoverSync('h1-view1'));

    await pushAll({ silent: true });
    expect(h.pushProgressMock).toHaveBeenCalledTimes(1);
    expect(h.syncBookNotesMock).toHaveBeenCalledTimes(1);
    expect(h.toasts).toHaveLength(0);

    h.settings.hardcover.enabled = false;
    await pushAll({ silent: true });
    expect(h.pushProgressMock).toHaveBeenCalledTimes(1);
    expect(h.toasts).toHaveLength(0);

    await pushAll({});
    expect(h.toasts.map((t) => t.message)).toContain('Configure Hardcover in Settings first.');
  });
});

describe('useHardcoverSync push health store', () => {
  test('counts a push while running, records a failure even when silent, and clears it on success', async () => {
    let finish!: () => void;
    h.pushProgressMock.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve(h.resolvedLink))),
    );
    h.pushProgressMock.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() => useHardcoverSync('h1-view1'));
    const push = () =>
      act(async () => {
        dispatch('hardcover-push-progress', { bookKey: 'h1-view1', silent: true });
        await flushMicrotasks();
      });
    const state = () => useHardcoverSyncStore.getState().byBook['h1-view1'];

    await push();
    expect(state()?.pending).toBe(1);
    await act(async () => {
      finish();
      await flushMicrotasks();
    });
    expect(state()).toMatchObject({ pending: 0, lastError: null });

    await push();
    expect(state()).toMatchObject({ pending: 0, lastError: 'offline' });

    await push();
    expect(state()).toMatchObject({ pending: 0, lastError: null });
  });

  test('a book Hardcover cannot match is not a failure', async () => {
    h.pushProgressMock.mockRejectedValueOnce(
      new h.UnmatchedError('Unable to resolve this book in Hardcover'),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() => useHardcoverSync('h1-view1'));

    await act(async () => {
      dispatch('hardcover-push-progress', { bookKey: 'h1-view1', silent: true });
      await flushMicrotasks();
    });

    expect(useHardcoverSyncStore.getState().byBook['h1-view1']).toEqual({
      pending: 0,
      lastError: null,
    });
  });

  test('an auth failure toasts a reconnect hint instead of the raw error', async () => {
    h.pushProgressMock.mockRejectedValueOnce(new h.AuthError('Hardcover token was rejected'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() => useHardcoverSync('h1-view1'));

    await act(async () => {
      dispatch('hardcover-push-progress', { bookKey: 'h1-view1' });
      await flushMicrotasks();
    });

    expect(h.toasts).toEqual([
      { message: 'Authentication failed. Reconnect in Settings.', type: 'error' },
    ]);
  });
});

describe('useHardcoverSync client sharing', () => {
  const noteConfig = () => ({
    progress: [5, 100] as [number, number],
    booknotes: [{ type: 'annotation' }],
    hardcover: undefined,
  });

  test('shares one client across pushes and rebuilds it when the token changes', async () => {
    h.config = noteConfig();
    const { result } = renderHook(() => useHardcoverSync('h1-view1'));

    await act(async () => {
      await result.current.pushProgress();
      await result.current.pushNotes();
    });
    expect(h.clientCtorMock).toHaveBeenCalledTimes(1);

    h.settings.hardcover.accessToken = 'tok2';
    await act(async () => {
      await result.current.pushProgress();
    });
    expect(h.clientCtorMock).toHaveBeenCalledTimes(2);
  });

  test('rebuilds the client when an OAuth login is reconnected', async () => {
    h.config = noteConfig();
    h.settings.hardcover = {
      ...h.settings.hardcover,
      accessToken: '',
      oauth: { accessToken: 'a1' },
    };
    const { result } = renderHook(() => useHardcoverSync('h1-view1'));

    await act(async () => {
      await result.current.pushProgress();
      await result.current.pushProgress();
    });
    expect(h.clientCtorMock).toHaveBeenCalledTimes(1);

    h.settings.hardcover.oauth = { accessToken: 'a2' };
    await act(async () => {
      await result.current.pushProgress();
    });
    expect(h.clientCtorMock).toHaveBeenCalledTimes(2);
  });

  test('runs overlapping notes pushes one at a time', async () => {
    h.config = noteConfig();
    let active = 0;
    let maxActive = 0;
    h.syncBookNotesMock.mockImplementation(async () => {
      maxActive = Math.max(maxActive, ++active);
      await Promise.resolve();
      await Promise.resolve();
      active--;
      return { inserted: 0, updated: 0, skipped: 1, link: h.resolvedLink };
    });
    const { result } = renderHook(() => useHardcoverSync('h1-view1'));

    await act(async () => {
      await Promise.all([result.current.pushNotes(), result.current.pushNotes()]);
    });
    expect(h.syncBookNotesMock).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });
});
