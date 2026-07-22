import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

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

  const book = { hash: 'h1', format: 'EPUB', updatedAt: 1 };
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
    config: { updatedAt: 1, xpointer: '' as string | undefined },
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
    updateProgressMock: vi.fn(async (..._args: unknown[]) => {}),
    eventListeners: new Map<string, Set<(e: CustomEvent) => void>>(),
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isDesktopApp: false } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('./useWindowActiveChanged', () => ({
  useWindowActiveChanged: () => {},
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
    getBookData: () => ({ book: h.book, bookDoc: h.bookDoc, config: h.config }),
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

vi.mock('@/services/sync/KOSyncClient', () => ({
  KOSyncClient: class {
    getProgress() {
      return h.getProgressMock();
    }
    updateProgress(...args: unknown[]) {
      return h.updateProgressMock(...args);
    }
  },
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
    dispatch: () => {},
  },
}));

import { useKOSync } from '@/app/reader/hooks/useKOSync';

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
    deviceId: 'this-device',
  };
  h.localProgress = {
    location: 'epubcfi(/6/4!/4/2/2)',
    sectionLabel: 'Chapter 9',
    pageinfo: { current: 13, total: 100 },
    section: { current: 0, total: 0 },
  };
  h.config = { updatedAt: 1, xpointer: '' };
  h.remote = {
    progress: h.XPOINTER,
    percentage: 0.14,
    timestamp: Math.floor(Date.now() / 1000) + 10_000,
    device_id: 'other-device',
  };
  h.cfiResolves = true;
  h.getProgressMock.mockReset();
  h.getProgressMock.mockResolvedValue(h.remote);
  h.updateProgressMock.mockClear();
  h.goTo.mockClear();
  h.goToFraction.mockClear();
  h.eventListeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
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
