import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Book } from '@/types/book';
import type { KOSyncSettings } from '@/types/settings';

const KOSYNC_PUSH_DEBOUNCE_MS = 5000;

const h = vi.hoisted(() => {
  // A KOReader native position (CREngine XPointer). On iOS this frequently
  // fails to convert to a local CFI (Bug A), which is what triggers #5065.
  const XPOINTER = '/body/DocFragment[326]/body/div/p[3]/text().0';

  const makeStore = <T,>(state: T) => {
    const fn = <R,>(selector?: (s: T) => R) => (selector ? selector(state) : state) as R | T;
    (fn as unknown as { getState: () => T }).getState = () => state;
    return fn as {
      (): T;
      <R>(selector: (s: T) => R): R;
      getState: () => T;
    };
  };

  const goTo = vi.fn();
  const goToFraction = vi.fn();
  const view = {
    goTo,
    goToFraction,
    select: vi.fn(),
    renderer: { primaryIndex: 0, getContents: () => [{ index: 0, doc: {} }] },
    getCFIProgress: vi.fn(async () => ({ fraction: 0.6 })),
  };

  const book = {
    hash: 'h1',
    title: 'Old title',
    originalFilename: '',
    format: 'EPUB' as string,
    updatedAt: 1,
  };
  const bookDoc = {};

  return {
    makeStore,
    goTo,
    goToFraction,
    view,
    book,
    bookDoc,
    XPOINTER,
    // Mutated per-test.
    settings: {
      kosync: {
        enabled: true,
        username: 'user',
        userkey: 'key',
        strategy: 'prompt' as string,
        checksumMethod: 'binary' as string,
        deviceId: 'this-device',
      },
    },
    // Local reading position (reflowable): (13+1)/100 = 0.14.
    localProgress: {
      location: 'epubcfi(/6/4!/4/2/2)',
      sectionLabel: 'Chapter 9',
      pageinfo: { current: 13, total: 100 },
      section: { current: 0, total: 0 },
    } as Record<string, unknown> | null,
    // No `location` by default: nothing has been read in this book on this
    // device. Tests that model a device with a position of its own set one.
    config: {
      updatedAt: 1,
      xpointer: '' as string | undefined,
      location: undefined as string | undefined,
    },
    // Remote payload returned by the server on GET.
    remote: {
      progress: XPOINTER,
      percentage: 0.14, // deliberately equal to local → the #5065 trap
      timestamp: Math.floor(Date.now() / 1000) + 10_000, // newer than local
      device_id: 'other-device',
    } as Record<string, unknown>,
    // Whether the XPointer→CFI conversion succeeds.
    cfiResolves: true,
    getProgressMock: vi.fn(),
    updateProgressMock: vi.fn(async (..._args: unknown[]): Promise<boolean | void> => {}),
    clientError: null as string | null,
    eventListeners: new Map<string, Set<(e: CustomEvent) => void>>(),
    // Captured useWindowActiveChanged callback — lets tests simulate the
    // window losing/regaining visibility (e.g. a system dictionary popup).
    activeCallback: null as ((isActive: boolean) => void) | null,
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isDesktopApp: false } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, params?: Record<string, unknown>) =>
    s.replace(/\{\{(\w+)\}\}/g, (m, k: string) =>
      params?.[k] !== undefined ? String(params[k]) : m,
    ),
}));

vi.mock('@/app/reader/hooks/useWindowActiveChanged', () => ({
  useWindowActiveChanged: (cb: (isActive: boolean) => void) => {
    h.activeCallback = cb;
  },
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: h.makeStore({ settings: h.settings }),
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => h.localProgress,
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({
    getProgress: () => h.localProgress,
    getView: () => h.view,
    getViewState: () => ({ previewMode: false }),
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getBookData: () => ({
      book: h.book,
      bookDoc: h.bookDoc,
      config: h.config,
      isFixedLayout: h.book.format === 'PDF',
    }),
    getConfig: () => h.config,
    setConfig: (_key: string, patch: Record<string, unknown>) => Object.assign(h.config, patch),
  }),
}));

vi.mock('@/utils/cfi', () => ({
  isMalformedLocationCfi: () => false,
}));

vi.mock('@/utils/xcfi', () => ({
  getCFIFromXPointer: vi.fn(() => {
    // Throw synchronously to model an iOS conversion failure without leaving a
    // floating rejected promise for vitest to flag.
    if (!h.cfiResolves) throw new Error('XPointer could not be resolved (iOS)');
    return Promise.resolve('epubcfi(/6/650!/4/2/6)');
  }),
  getXPointerFromCFI: vi.fn(() => Promise.resolve({ xpointer: h.XPOINTER })),
}));

vi.mock('@/services/sync/KOSyncClient', async (importOriginal) => {
  const { KOSyncClient } = await importOriginal<typeof import('@/services/sync/KOSyncClient')>();
  return {
    KOSyncClient: class {
      private client: InstanceType<typeof KOSyncClient>;
      constructor(config: KOSyncSettings) {
        this.client = new KOSyncClient({ ...config, serverUrl: 'https://sync.example.com' });
      }
      getDocumentDigest(book: Book) {
        return this.client.getDocumentDigest(book);
      }
      getProgress() {
        return h.getProgressMock();
      }
      updateProgress(...args: unknown[]) {
        return h.updateProgressMock(...args);
      }
      get lastError() {
        return h.clientError;
      }
    },
  };
});

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
    dispatch: () => {},
  },
}));

import { useKOSync, type KosyncProgressProvider } from '@/app/reader/hooks/useKOSync';
import { readFlowState } from '@/services/sync/dataFlow/log';
import { getCFIFromXPointer, getXPointerFromCFI } from '@/utils/xcfi';

const flushMicrotasks = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

const settle = async () => {
  await act(async () => {
    await flushMicrotasks();
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await flushMicrotasks();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  h.settings.kosync = {
    enabled: true,
    username: 'user',
    userkey: 'key',
    strategy: 'prompt',
    checksumMethod: 'binary',
    deviceId: 'this-device',
  };
  h.localProgress = {
    location: 'epubcfi(/6/4!/4/2/2)',
    sectionLabel: 'Chapter 9',
    pageinfo: { current: 13, total: 100 },
    section: { current: 0, total: 0 },
  };
  h.config = { updatedAt: 1, xpointer: '', location: undefined };
  h.remote = {
    progress: h.XPOINTER,
    percentage: 0.14,
    timestamp: Math.floor(Date.now() / 1000) + 10_000,
    device_id: 'other-device',
  };
  h.book.title = 'Old title';
  h.book.originalFilename = '';
  h.book.format = 'EPUB';
  h.cfiResolves = true;
  h.clientError = null;
  localStorage.clear();
  h.getProgressMock.mockReset();
  h.getProgressMock.mockResolvedValue(h.remote);
  h.updateProgressMock.mockClear();
  h.goTo.mockClear();
  h.goToFraction.mockClear();
  h.view.select.mockClear();
  h.eventListeners.clear();
  h.activeCallback = null;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('useKOSync — changing checksum method (#7118)', () => {
  test('pulls the new identity before allowing automatic pushes', async () => {
    h.getProgressMock.mockResolvedValue(null);
    const { result, rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);
    h.getProgressMock.mockClear();
    h.updateProgressMock.mockClear();
    h.getProgressMock.mockResolvedValue(h.remote);

    h.settings.kosync = { ...h.settings.kosync, checksumMethod: 'filename' };
    rerender();
    await settle();

    expect(h.getProgressMock).toHaveBeenCalledTimes(1);
    expect(result.current.syncState).toBe('conflict');
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);
    expect(h.updateProgressMock).not.toHaveBeenCalled();
  });

  test('ignores an old empty response after the new identity reports a conflict', async () => {
    let finishOldPull!: (value: null) => void;
    h.getProgressMock.mockImplementationOnce(
      () => new Promise<null>((resolve) => (finishOldPull = resolve)),
    );
    const { result, rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    h.settings.kosync = { ...h.settings.kosync, checksumMethod: 'filename' };
    rerender();
    await settle();
    expect(result.current.syncState).toBe('conflict');

    finishOldPull(null);
    await settle();
    expect(result.current.syncState).toBe('conflict');
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);
    expect(h.updateProgressMock).not.toHaveBeenCalled();
  });

  test('ignores old conflict calculations after switching checksum method', async () => {
    let finishOldPreview!: (value: { fraction: number }) => void;
    h.view.getCFIProgress.mockImplementationOnce(
      () => new Promise<{ fraction: number }>((resolve) => (finishOldPreview = resolve)),
    );
    const { result, rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    const newRemote = { ...h.remote, timestamp: 12345 };
    h.getProgressMock.mockResolvedValue(newRemote);
    h.settings.kosync = { ...h.settings.kosync, checksumMethod: 'filename' };
    rerender();
    await settle();
    expect(result.current.conflictDetails?.remote.timestamp).toBe(12345);

    finishOldPreview({ fraction: 0.6 });
    await settle();
    expect(result.current.conflictDetails?.remote.timestamp).toBe(12345);
    expect(result.current.syncState).toBe('conflict');
  });

  test('does not navigate to an old identity after its conversion finishes', async () => {
    h.settings.kosync.strategy = 'silent';
    let finishOldConversion!: (value: string) => void;
    vi.mocked(getCFIFromXPointer).mockImplementationOnce(
      () => new Promise<string>((resolve) => (finishOldConversion = resolve)),
    );
    const { result, rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    h.getProgressMock.mockResolvedValue(null);
    h.settings.kosync = { ...h.settings.kosync, checksumMethod: 'filename' };
    rerender();
    await settle();
    expect(result.current.syncState).toBe('synced');

    finishOldConversion('epubcfi(/6/650!/4/2/6)');
    await settle();
    expect(h.goTo).not.toHaveBeenCalled();
    expect(result.current.syncState).toBe('synced');
  });

  test('does not upload an old identity after its conversion finishes', async () => {
    h.getProgressMock.mockResolvedValueOnce(null);
    let finishOldConversion!: (value: { xpointer: string }) => void;
    vi.mocked(getXPointerFromCFI).mockImplementationOnce(
      () => new Promise<{ xpointer: string }>((resolve) => (finishOldConversion = resolve)),
    );
    const { result, rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);

    h.settings.kosync = { ...h.settings.kosync, checksumMethod: 'filename' };
    rerender();
    await settle();
    expect(result.current.syncState).toBe('conflict');

    finishOldConversion({ xpointer: h.XPOINTER });
    await settle();
    expect(h.config.xpointer).toBe('');
    expect(h.updateProgressMock).not.toHaveBeenCalled();
  });

  test('does not apply a pending remote conflict resolution after switching methods', async () => {
    const { result, rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    let finishOldConversion!: (value: string) => void;
    vi.mocked(getCFIFromXPointer).mockImplementationOnce(
      () => new Promise<string>((resolve) => (finishOldConversion = resolve)),
    );
    let resolution!: Promise<void>;
    act(() => {
      resolution = result.current.resolveWithRemote();
    });

    h.settings.kosync = { ...h.settings.kosync, checksumMethod: 'filename' };
    rerender();
    await settle();
    expect(result.current.syncState).toBe('conflict');

    await act(async () => {
      finishOldConversion('epubcfi(/6/650!/4/2/6)');
      await resolution;
    });
    expect(h.goTo).not.toHaveBeenCalled();
    expect(result.current.syncState).toBe('conflict');
    expect(result.current.conflictDetails).not.toBeNull();
  });

  test('waits for an active upload before pulling the new checksum identity', async () => {
    h.getProgressMock.mockResolvedValueOnce(null);
    let finishUpload!: () => void;
    h.updateProgressMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishUpload = resolve)),
    );
    const { result, rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);
    expect(h.updateProgressMock).toHaveBeenCalledTimes(1);
    h.getProgressMock.mockClear();

    h.settings.kosync = { ...h.settings.kosync, checksumMethod: 'filename' };
    rerender();
    await settle();
    expect(result.current.syncState).toBe('checking');
    expect(h.getProgressMock).not.toHaveBeenCalled();

    finishUpload();
    await settle();
    expect(h.getProgressMock).toHaveBeenCalledTimes(1);
    expect(result.current.syncState).toBe('conflict');
  });

  test('serializes uploads and discards a queued upload after switching methods', async () => {
    h.getProgressMock.mockResolvedValueOnce(null);
    let finishUpload!: () => void;
    h.updateProgressMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishUpload = resolve)),
    );
    const { result, rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);
    act(() => {
      result.current.pushProgress();
      result.current.pushProgress.flush();
    });
    await settle();
    expect(h.updateProgressMock).toHaveBeenCalledTimes(1);

    h.settings.kosync = { ...h.settings.kosync, checksumMethod: 'filename' };
    rerender();
    await settle();
    finishUpload();
    await settle();
    expect(h.updateProgressMock).toHaveBeenCalledTimes(1);
    expect(result.current.syncState).toBe('conflict');
  });

  test('pulls a renamed legacy book before automatic uploads resume', async () => {
    h.settings.kosync.checksumMethod = 'filename';
    h.getProgressMock.mockResolvedValueOnce(null);
    const { result, rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    h.getProgressMock.mockClear();
    h.updateProgressMock.mockClear();

    h.book.title = 'New title';
    rerender();
    await settle();
    expect(h.getProgressMock).toHaveBeenCalledTimes(1);
    expect(result.current.syncState).toBe('conflict');
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);
    expect(h.updateProgressMock).not.toHaveBeenCalled();
  });

  test('discards an old title response after the renamed book reaches conflict', async () => {
    h.settings.kosync.checksumMethod = 'filename';
    let finishOldPull!: (value: null) => void;
    h.getProgressMock.mockImplementationOnce(
      () => new Promise<null>((resolve) => (finishOldPull = resolve)),
    );
    const { result, rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    h.book.title = 'New title';
    rerender();
    await settle();
    expect(result.current.syncState).toBe('conflict');
    finishOldPull(null);
    await settle();
    expect(result.current.syncState).toBe('conflict');
  });

  test.each([
    'binary',
    'filename',
  ])('does not repull on title edits with a stable %s digest', async (method) => {
    h.settings.kosync.checksumMethod = method;
    h.book.originalFilename = 'Original.epub';
    const { rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    h.getProgressMock.mockClear();
    h.book.title = 'New title';
    rerender();
    await settle();
    expect(h.getProgressMock).not.toHaveBeenCalled();
  });

  test('does not repull when unrelated settings change', async () => {
    h.getProgressMock.mockResolvedValue(null);
    const { rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    h.getProgressMock.mockClear();

    h.settings.kosync = { ...h.settings.kosync, enabled: false };
    rerender();
    await settle();

    expect(h.getProgressMock).not.toHaveBeenCalled();
  });

  test('does not reuse a conflict resolution from the previous checksum identity', async () => {
    const { result, rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    await act(async () => {
      result.current.resolveWithLocal();
      await flushMicrotasks();
    });
    h.getProgressMock.mockClear();
    h.updateProgressMock.mockClear();

    h.settings.kosync = { ...h.settings.kosync, checksumMethod: 'filename' };
    rerender();
    await settle();

    expect(h.getProgressMock).toHaveBeenCalledTimes(1);
    expect(result.current.syncState).toBe('conflict');
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);
    expect(h.updateProgressMock).not.toHaveBeenCalled();
  });
});

describe('useKOSync — applying a newer remote position (#5065)', () => {
  test('applies the newer remote position on open (silent strategy)', async () => {
    h.settings.kosync.strategy = 'silent';
    renderHook(() => useKOSync('h1-view1'));
    await settle();

    // The remote XPointer resolves to a CFI and the reader jumps to it.
    expect(h.getProgressMock).toHaveBeenCalled();
    expect(h.goTo).toHaveBeenCalledWith('epubcfi(/6/650!/4/2/6)');
  });
});

describe('useKOSync — no clobbering when the pull is unresolved (#5065)', () => {
  test('does NOT auto-push (PUT) when an XPointer pull cannot be resolved, even if percentages match', async () => {
    // iOS: the XPointer can't be converted to a local CFI, and KOReader's
    // reported percentage coincidentally equals Readest's. Pre-fix this looked
    // like "no conflict" → synced → auto-push overwrote the remote position.
    h.cfiResolves = false;
    const { rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    // Simulate a page turn after the (unresolved) pull.
    h.localProgress = {
      ...(h.localProgress as Record<string, unknown>),
      location: 'epubcfi(/6/4!/4/2/8)',
    };
    rerender();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);

    // The reader must stay in a conflict state — never silently PUT its stale
    // local position over the remote one.
    expect(h.updateProgressMock).not.toHaveBeenCalled();
  });

  // #5980 review: the 'silent' strategy takes a different branch from 'prompt'
  // and never built a conflict, so `applyRemoteProgress` failing used to fall
  // straight through to setSyncState('synced'). That releases the debounced
  // auto-push, which then PUTs the stale local position over the newer remote
  // XPointer -- the exact #5065 damage, on the path #5065's test didn't cover.
  test('does NOT auto-push (PUT) when a silent pull cannot resolve the XPointer', async () => {
    h.settings.kosync.strategy = 'silent';
    h.cfiResolves = false;
    const { rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    // The reader must not have moved, and a later page turn must not push.
    expect(h.goTo).not.toHaveBeenCalled();
    h.localProgress = {
      ...(h.localProgress as Record<string, unknown>),
      location: 'epubcfi(/6/4!/4/2/8)',
    };
    rerender();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);

    expect(h.updateProgressMock).not.toHaveBeenCalled();
  });

  test('still auto-pushes after a silent pull that DID apply', async () => {
    // Positive control for the branch above: a resolvable XPointer applies,
    // reaches 'synced', and auto-push keeps working.
    h.settings.kosync.strategy = 'silent';
    h.cfiResolves = true;
    const { rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    expect(h.goTo).toHaveBeenCalledWith('epubcfi(/6/650!/4/2/6)');
    h.localProgress = {
      ...(h.localProgress as Record<string, unknown>),
      location: 'epubcfi(/6/4!/4/2/8)',
    };
    rerender();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);

    expect(h.updateProgressMock).toHaveBeenCalled();
  });

  test('still auto-pushes for a genuine non-conflict (resolved position matches)', async () => {
    // Positive control: when the XPointer resolves to a fraction that matches
    // the local position, there is no conflict and auto-push works normally.
    h.cfiResolves = true;
    h.view.getCFIProgress = vi.fn(async () => ({ fraction: 0.14 }));
    const { rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    h.localProgress = {
      ...(h.localProgress as Record<string, unknown>),
      location: 'epubcfi(/6/4!/4/2/8)',
    };
    rerender();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);

    expect(h.updateProgressMock).toHaveBeenCalled();
    // Restore for other tests.
    h.view.getCFIProgress = vi.fn(async () => ({ fraction: 0.6 }));
  });
});

describe('useKOSync — no phantom re-prompt after resolving (#5527)', () => {
  test('a report echoed from this same device never prompts, even when its XPointer cannot be resolved', async () => {
    // The server holds what THIS device pushed. Its percentage was computed
    // with the same formula as the local one, so they compare directly; the
    // XPointer round-trip (which can fail or mis-anchor) must not force a
    // conflict the way it does for other-device reports (#5065).
    h.remote = {
      progress: h.XPOINTER,
      percentage: 0.14,
      timestamp: Math.floor(Date.now() / 1000) + 10_000,
      device_id: 'this-device',
    };
    h.getProgressMock.mockResolvedValue(h.remote);
    h.cfiResolves = false;

    const { result } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    expect(result.current.syncState).toBe('synced');
    expect(result.current.conflictDetails).toBeNull();
  });

  test('an already-resolved unchanged remote report does not re-prompt on window re-activation', async () => {
    // Genuine conflict on open: remote resolves to 0.6 vs local 0.14.
    const { result } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    expect(result.current.syncState).toBe('conflict');

    await act(async () => {
      result.current.resolveWithLocal();
      await flushMicrotasks();
    });
    expect(result.current.syncState).toBe('synced');

    // System dictionary popup: window hidden, then visible again. The re-pull
    // still returns the exact report the user just resolved (the resolve-time
    // push may not have landed on the server yet).
    await act(async () => {
      h.activeCallback?.(false);
      await flushMicrotasks();
    });
    await act(async () => {
      h.activeCallback?.(true);
      await flushMicrotasks();
    });

    expect(result.current.syncState).toBe('synced');
    expect(result.current.conflictDetails).toBeNull();
  });

  test('a NEW remote report after resolution still prompts', async () => {
    const { result } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    expect(result.current.syncState).toBe('conflict');

    await act(async () => {
      result.current.resolveWithLocal();
      await flushMicrotasks();
    });
    expect(result.current.syncState).toBe('synced');

    // KOReader pushed a genuinely new position while we were away.
    h.getProgressMock.mockResolvedValue({
      progress: '/body/DocFragment[326]/body/div/p[9]/text().0',
      percentage: 0.2,
      timestamp: Math.floor(Date.now() / 1000) + 20_000,
      device_id: 'other-device',
    });

    await act(async () => {
      h.activeCallback?.(false);
      await flushMicrotasks();
    });
    await act(async () => {
      h.activeCallback?.(true);
      await flushMicrotasks();
    });

    expect(result.current.syncState).toBe('conflict');
  });
});

describe('useKOSync — manual sync mode (#6029)', () => {
  // Turning BookOrbit's Auto Sync off must stop every push Readest makes on
  // its own, so the server stops accumulating a progress log entry every few
  // minutes. Pulls stay automatic — they add no server-side clutter and are
  // what keeps a second device in step. BookOrbit reaches this hook as a
  // provider whose config carries the flag; KOReader Sync never sets it.
  const manualBookOrbit: KosyncProgressProvider = {
    name: 'bookorbit',
    selectConfig: (settings) => ({ ...settings.kosync, autoSync: false }),
  };
  const turnPage = async (rerender: () => void) => {
    h.localProgress = {
      ...(h.localProgress as Record<string, unknown>),
      location: 'epubcfi(/6/4!/4/2/8)',
    };
    rerender();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);
  };

  const fire = async (name: string, detail: Record<string, unknown>) => {
    await act(async () => {
      for (const listener of h.eventListeners.get(name) ?? []) {
        listener({ detail } as CustomEvent);
      }
      await flushMicrotasks();
    });
  };

  beforeEach(() => {
    h.settings.kosync.strategy = 'silent';
  });

  test('does NOT auto-push on a page turn', async () => {
    const { rerender } = renderHook(() => useKOSync('h1-view1', manualBookOrbit));
    await settle();
    await turnPage(rerender);

    expect(h.updateProgressMock).not.toHaveBeenCalled();
  });

  test('does NOT push when the window is deactivated', async () => {
    renderHook(() => useKOSync('h1-view1', manualBookOrbit));
    await settle();

    await act(async () => {
      h.activeCallback?.(false);
      await flushMicrotasks();
    });

    expect(h.updateProgressMock).not.toHaveBeenCalled();
  });

  test('still pulls automatically on open', async () => {
    renderHook(() => useKOSync('h1-view1', manualBookOrbit));
    await settle();

    expect(h.getProgressMock).toHaveBeenCalled();
    expect(h.goTo).toHaveBeenCalledWith('epubcfi(/6/650!/4/2/6)');
  });

  test('still pushes on an explicit push-kosync request', async () => {
    const { rerender } = renderHook(() => useKOSync('h1-view1', manualBookOrbit));
    await settle();
    await turnPage(rerender);
    expect(h.updateProgressMock).not.toHaveBeenCalled();

    await fire('push-kosync', { bookKey: 'h1-view1' });

    expect(h.updateProgressMock).toHaveBeenCalled();
  });
});

describe('useKOSync — provider-scoped manual sync events (#6029)', () => {
  // Both the KOSync and the BookOrbit hook instances listen on the same
  // event names, so a menu entry meant for one server would otherwise push
  // to both. A `provider` in the detail addresses exactly one instance;
  // an event without one still broadcasts (book close, the Sync row).
  const fire = async (name: string, detail: Record<string, unknown>) => {
    await act(async () => {
      for (const listener of h.eventListeners.get(name) ?? []) {
        listener({ detail } as CustomEvent);
      }
      await flushMicrotasks();
    });
  };

  beforeEach(() => {
    h.settings.kosync.strategy = 'silent';
  });

  test('ignores a push addressed to another provider', async () => {
    renderHook(() => useKOSync('h1-view1'));
    await settle();
    h.updateProgressMock.mockClear();

    await fire('push-kosync', { bookKey: 'h1-view1', provider: 'bookorbit' });

    expect(h.updateProgressMock).not.toHaveBeenCalled();
  });

  test('honours a push addressed to this provider', async () => {
    renderHook(() => useKOSync('h1-view1'));
    await settle();
    h.updateProgressMock.mockClear();

    await fire('push-kosync', { bookKey: 'h1-view1', provider: 'kosync' });

    expect(h.updateProgressMock).toHaveBeenCalled();
  });

  test('ignores a pull addressed to another provider', async () => {
    renderHook(() => useKOSync('h1-view1'));
    await settle();
    h.getProgressMock.mockClear();

    await fire('pull-kosync', { bookKey: 'h1-view1', provider: 'bookorbit' });

    expect(h.getProgressMock).not.toHaveBeenCalled();
  });
});

describe('useKOSync — a book just added to this device (silent strategy)', () => {
  // The book was read on another device, which left its position on the
  // server. It is then added to this device and opened under "Always use
  // latest" (silent). The record this device creates for it has no position,
  // and its updatedAt is stamped when the record is created, later than the
  // server's last sync. So the timestamp rule kept the empty local record: the
  // reader stayed at the start of the book, then pushed that start to the
  // server, which dragged the other device back to the start as well.
  const START_CFI = 'epubcfi(/6/2!/4/2/2)';
  const REMOTE_CFI = 'epubcfi(/6/650!/4/2/6)';
  const SAVED_CFI = 'epubcfi(/6/4!/4/2/2)';
  const startProgress = () => ({
    location: START_CFI,
    sectionLabel: 'Chapter 1',
    pageinfo: { current: 0, total: 100 },
    section: { current: 0, total: 0 },
  });

  beforeEach(() => {
    h.settings.kosync.strategy = 'silent';
    // Created on this open: the local record is newer than the server's report.
    h.config = { updatedAt: Date.now(), xpointer: '', location: undefined };
    h.remote = {
      progress: h.XPOINTER,
      percentage: 0.6,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
      device_id: 'other-device',
    };
    h.getProgressMock.mockResolvedValue(h.remote);
  });

  // Opening the book: the view's first relocate writes the start of the book
  // into both the config and the progress store, and only then can the pull
  // run. Whether this device had a position must be read before that.
  const openAtStart = async (rerender: () => void) => {
    h.config.location = START_CFI;
    h.localProgress = startProgress();
    rerender();
    await settle();
  };

  test('applies the server position when this device has none, although the local record is newer', async () => {
    h.localProgress = null;
    const { rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    expect(h.getProgressMock).not.toHaveBeenCalled();

    await openAtStart(rerender);

    expect(h.getProgressMock).toHaveBeenCalled();
    expect(h.goTo).toHaveBeenCalledWith(REMOTE_CFI);
  });

  test('keeps a position this device already has when the local record is newer', async () => {
    h.config.location = SAVED_CFI;
    const { result } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    expect(h.getProgressMock).toHaveBeenCalled();
    expect(h.goTo).not.toHaveBeenCalled();
    expect(result.current.syncState).toBe('synced');
  });

  test('still applies a newer server position over a position this device has', async () => {
    h.config.location = SAVED_CFI;
    h.remote = { ...h.remote, timestamp: Math.floor(Date.now() / 1000) + 10_000 };
    h.getProgressMock.mockResolvedValue(h.remote);
    renderHook(() => useKOSync('h1-view1'));
    await settle();

    expect(h.goTo).toHaveBeenCalledWith(REMOTE_CFI);
  });

  test('after the server position is applied, a re-pull is back on the timestamp rule', async () => {
    h.localProgress = null;
    const { rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    await openAtStart(rerender);
    expect(h.goTo).toHaveBeenCalledTimes(1);

    // The device now has a position of its own. The window loses and regains
    // focus, which pulls again; the server still holds the older report, and
    // it must not move the reader a second time.
    await act(async () => {
      h.activeCallback?.(false);
      await flushMicrotasks();
    });
    await act(async () => {
      h.activeCallback?.(true);
      await flushMicrotasks();
    });

    expect(h.goTo).toHaveBeenCalledTimes(1);
  });

  test('when the first pull finds nothing, a later older report does not move the reader', async () => {
    // Opened with no position here and none on the server; the user then reads
    // on this device. A report older than that reading arrives afterwards: the
    // timestamps decide, as for any book with a position.
    h.getProgressMock.mockResolvedValueOnce(null);
    h.localProgress = null;
    const { rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    await openAtStart(rerender);
    expect(h.goTo).not.toHaveBeenCalled();

    h.config.updatedAt = Date.now() + 1000;
    await act(async () => {
      h.activeCallback?.(false);
      await flushMicrotasks();
    });
    await act(async () => {
      h.activeCallback?.(true);
      await flushMicrotasks();
    });

    expect(h.getProgressMock).toHaveBeenCalledTimes(2);
    expect(h.goTo).not.toHaveBeenCalled();
  });
});

describe('useKOSync — a remote position with only a percentage (#7330)', () => {
  // Grimmory reports progress made in its own reader as a percentage with
  // `progress: null`; for PDFs it never has a page to send. The pull must
  // still move the reader there instead of treating it as "no progress" and
  // letting the next page turn push the stale local page over it.
  beforeEach(() => {
    h.book.format = 'PDF';
    h.localProgress = {
      location: '0',
      pageinfo: { current: 0, total: 70 },
      section: { current: 0, total: 70 },
    };
    // Grimmory's reader saves page / total: page 27 of 70.
    h.remote = { ...h.remote, progress: null, percentage: 0.386, device_id: 'Grimmory' };
    h.getProgressMock.mockResolvedValue(h.remote);
  });

  test('silent: goes to the page the percentage names', async () => {
    h.settings.kosync.strategy = 'silent';
    const { result } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    expect(h.view.select).toHaveBeenCalledWith(26);
    expect(result.current.syncState).toBe('synced');
  });

  test('prompt: offers the page, and taking it goes there', async () => {
    const { result } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    expect(result.current.syncState).toBe('conflict');
    // The page comes from the local page count, so it is only approximate.
    expect(result.current.conflictDetails?.remote.preview).toBe(
      'Approximately page 27 of 70 (38.60%)',
    );
    await act(async () => {
      await result.current.resolveWithRemote();
    });
    expect(h.view.select).toHaveBeenCalledWith(26);
  });

  test('prompt: the page count shown is the local one', async () => {
    h.localProgress = { ...h.localProgress, section: { current: 26, total: 70 } };
    h.remote = { ...h.remote, percentage: 0.001 };
    h.getProgressMock.mockResolvedValue(h.remote);
    const { result } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    expect(result.current.conflictDetails?.remote.preview).toBe(
      'Approximately page 1 of 70 (0.10%)',
    );
  });

  test('prompt: no conflict when the percentage names the page already open', async () => {
    h.localProgress = { ...h.localProgress, section: { current: 26, total: 70 } };
    const { result } = renderHook(() => useKOSync('h1-view1'));
    await settle();

    expect(result.current.syncState).toBe('synced');
    expect(h.view.select).not.toHaveBeenCalled();
  });

  test('does not push the stale local page over it', async () => {
    renderHook(() => useKOSync('h1-view1'));
    await settle();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);

    expect(h.updateProgressMock).not.toHaveBeenCalled();
  });

  test('prompt: a new percentage after resolving prompts again, even with no timestamp', async () => {
    h.remote = { ...h.remote, timestamp: undefined };
    h.getProgressMock.mockResolvedValue(h.remote);
    const { result } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    expect(result.current.syncState).toBe('conflict');

    await act(async () => {
      result.current.resolveWithLocal();
      await flushMicrotasks();
    });
    expect(result.current.syncState).toBe('synced');

    h.getProgressMock.mockResolvedValue({ ...h.remote, percentage: 0.5 });
    await act(async () => {
      h.activeCallback?.(false);
      await flushMicrotasks();
    });
    await act(async () => {
      h.activeCallback?.(true);
      await flushMicrotasks();
    });

    expect(result.current.syncState).toBe('conflict');
  });

  test('reflowable: goes to the fraction', async () => {
    h.book.format = 'EPUB';
    h.localProgress = {
      location: 'epubcfi(/6/4!/4/2/2)',
      sectionLabel: 'Chapter 9',
      pageinfo: { current: 13, total: 100 },
      section: { current: 0, total: 0 },
    };
    h.settings.kosync.strategy = 'silent';
    renderHook(() => useKOSync('h1-view1'));
    await settle();

    expect(h.goToFraction).toHaveBeenCalledWith(0.386);
  });
});

describe('useKOSync — fixed-layout page numbers (#7330)', () => {
  // KOReader's progress for a PDF is the 1-based page number, which is also
  // what the pull reads. Pushing the 0-based index put every other reader one
  // page back, and Readest itself stepped back a page on each round trip.
  test('pushes the 1-based page number', async () => {
    h.book.format = 'PDF';
    h.localProgress = {
      location: '26',
      pageinfo: { current: 26, total: 70 },
      section: { current: 26, total: 70 },
    };
    h.getProgressMock.mockResolvedValue(null);
    renderHook(() => useKOSync('h1-view1'));
    await settle();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);

    expect(h.updateProgressMock).toHaveBeenCalledWith(h.book, '27', 27 / 70);
  });
});

describe('useKOSync — a provider with its own client and CFI positions (#7337)', () => {
  // Grimmory stores the EPUB CFI its own foliate-based reader writes, so a
  // Grimmory position is pushed and applied as a CFI, never as an XPointer.
  const REMOTE_CFI = 'epubcfi(/6/8!/4/2/10)';
  const cfiProvider: KosyncProgressProvider = {
    name: 'grimmory',
    selectConfig: (settings) => settings.kosync,
    positions: 'cfi',
    createClient: () => ({
      getDocumentDigest: (book: Book) => book.hash,
      getProgress: () => h.getProgressMock(),
      updateProgress: (...args: unknown[]) => h.updateProgressMock(...args),
    }),
  };

  test('pushes the CFI, not an XPointer', async () => {
    vi.mocked(getXPointerFromCFI).mockClear();
    h.getProgressMock.mockResolvedValue(null);
    renderHook(() => useKOSync('h1-view1', cfiProvider));
    await settle();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);

    expect(h.updateProgressMock).toHaveBeenCalledWith(h.book, 'epubcfi(/6/4!/4/2/2)', 0.14);
    expect(getXPointerFromCFI).not.toHaveBeenCalled();
  });

  test('silent: goes to the remote CFI', async () => {
    h.settings.kosync.strategy = 'silent';
    h.getProgressMock.mockResolvedValue({ ...h.remote, progress: REMOTE_CFI, percentage: 0.5 });
    renderHook(() => useKOSync('h1-view1', cfiProvider));
    await settle();

    expect(h.goTo).toHaveBeenCalledWith(REMOTE_CFI);
    expect(h.goToFraction).not.toHaveBeenCalled();
  });

  test('prompt: compares where the CFI is in this copy, not the remote percentage', async () => {
    // The remote reader paginates differently: 50% there is this page here.
    h.view.getCFIProgress.mockResolvedValueOnce({ fraction: 0.14 });
    h.getProgressMock.mockResolvedValue({ ...h.remote, progress: REMOTE_CFI, percentage: 0.5 });
    const { result } = renderHook(() => useKOSync('h1-view1', cfiProvider));
    await settle();

    expect(h.view.getCFIProgress).toHaveBeenCalledWith(REMOTE_CFI);
    expect(result.current.syncState).toBe('synced');
  });

  test('prompt: a remote CFI on the page shown here is not a conflict', async () => {
    // Our own earlier push read back: the CFI's start sits a page before the
    // page-end percentage this device reports, but it is the same page.
    h.localProgress = {
      ...(h.localProgress as Record<string, unknown>),
      location: 'epubcfi(/6/8!/4/2,/10/1:0,/12/1:40)',
    };
    h.view.getCFIProgress.mockResolvedValueOnce({ fraction: 0.13 });
    h.getProgressMock.mockResolvedValue({
      ...h.remote,
      progress: 'epubcfi(/6/8!/4/2,/10/1:0,/12/1:40)',
      percentage: 0.14,
    });
    const { result } = renderHook(() => useKOSync('h1-view1', cfiProvider));
    await settle();

    expect(result.current.conflictDetails).toBeNull();
    expect(result.current.syncState).toBe('synced');
  });
});

describe('useKOSync — data flow', () => {
  const bookOrbit: KosyncProgressProvider = {
    name: 'bookorbit',
    selectConfig: (settings) => settings.kosync,
  };

  const turnPage = async (rerender: () => void) => {
    h.localProgress = {
      ...(h.localProgress as Record<string, unknown>),
      location: 'epubcfi(/6/4!/4/2/8)',
    };
    rerender();
    await advance(KOSYNC_PUSH_DEBOUNCE_MS + 500);
  };

  test('records a remote position it applied', async () => {
    h.settings.kosync.strategy = 'silent';
    renderHook(() => useKOSync('h1-view1'));
    await settle();

    expect(readFlowState().entries[0]).toMatchObject({
      connector: 'kosync',
      direction: 'pull',
      kind: 'progress',
      count: 1,
      bookTitle: 'Old title',
    });
  });

  test('records a pull that found nothing new as working, with nothing moved', async () => {
    h.settings.kosync.strategy = 'silent';
    h.getProgressMock.mockResolvedValue(null);
    renderHook(() => useKOSync('h1-view1'));
    await settle();

    const state = readFlowState();
    expect(state.entries).toEqual([]);
    expect(state.totals['kosync:pull:progress']?.lastSuccessAt).toBeGreaterThan(0);
  });

  test('records a failed pull', async () => {
    h.settings.kosync.strategy = 'silent';
    h.getProgressMock.mockResolvedValue(null);
    h.clientError = 'HTTP 500';
    renderHook(() => useKOSync('h1-view1'));
    await settle();

    expect(readFlowState().entries[0]).toMatchObject({ direction: 'pull', error: 'HTTP 500' });
  });

  test('records a push under the connector that made it', async () => {
    h.settings.kosync.strategy = 'send';
    h.updateProgressMock.mockResolvedValue(true);
    const { rerender } = renderHook(() => useKOSync('h1-view1', bookOrbit));
    await settle();
    await turnPage(rerender);

    const [entry] = readFlowState().entries;
    expect(entry).toMatchObject({ connector: 'bookorbit', direction: 'push' });
    expect(entry?.count).toBeGreaterThan(0);
  });

  test('records a refused push', async () => {
    h.settings.kosync.strategy = 'send';
    h.updateProgressMock.mockImplementation(async () => {
      h.clientError = 'HTTP 403';
      return false;
    });
    const { rerender } = renderHook(() => useKOSync('h1-view1'));
    await settle();
    await turnPage(rerender);

    expect(readFlowState().entries[0]).toMatchObject({ direction: 'push', error: 'HTTP 403' });
  });
});
