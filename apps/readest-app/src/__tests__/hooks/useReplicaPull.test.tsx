import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const pullSpy = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const getReplicaSyncSpy = vi.fn();
const readyListeners = new Set<() => void>();
const subscribeReplicaSyncReadySpy = vi.fn((listener: () => void) => {
  if (getReplicaSyncSpy()) {
    listener();
    return () => {};
  }
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
});
const fireReplicaSyncReady = () => {
  for (const l of [...readyListeners]) l();
  readyListeners.clear();
};
let envValue: { envConfig: unknown; appService: unknown } = {
  envConfig: { name: 'env' },
  appService: null,
};

let authValue: { user: { id: string } | null } = { user: { id: 'test-user' } };

vi.mock('@/services/sync/replicaPullAndApply', () => ({
  replicaPullAndApply: (...args: unknown[]) => pullSpy(...args),
}));

vi.mock('@/services/sync/adapters/dictionary', () => ({
  dictionaryAdapter: { kind: 'dictionary' },
}));

vi.mock('@/services/sync/replicaSync', () => ({
  getReplicaSync: () => getReplicaSyncSpy(),
  subscribeReplicaSyncReady: (listener: () => void) => subscribeReplicaSyncReadySpy(listener),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => envValue,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authValue,
}));

vi.mock('@/services/transferManager', () => ({
  transferManager: { queueReplicaDownload: vi.fn() },
}));

vi.mock('@/store/customDictionaryStore', () => ({
  useCustomDictionaryStore: {
    getState: () => ({
      applyRemoteDictionary: vi.fn(),
      softDeleteByContentId: vi.fn(),
      loadCustomDictionaries: vi.fn(async () => {}),
    }),
  },
  findDictionaryByContentId: () => undefined,
}));

vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: {
    getState: () => ({
      applyRemoteFont: vi.fn(),
      softDeleteByContentId: vi.fn(),
      loadCustomFonts: vi.fn(async () => {}),
    }),
  },
  findFontByContentId: () => undefined,
  migrateLegacyFonts: vi.fn(async () => {}),
}));

vi.mock('@/store/customTextureStore', () => ({
  useCustomTextureStore: {
    getState: () => ({
      applyRemoteTexture: vi.fn(),
      softDeleteByContentId: vi.fn(),
      loadCustomTextures: vi.fn(async () => {}),
    }),
  },
  findTextureByContentId: () => undefined,
  migrateLegacyTextures: vi.fn(async () => {}),
}));

vi.mock('@/store/customOPDSStore', () => ({
  useCustomOPDSStore: {
    getState: () => ({
      applyRemoteCatalog: vi.fn(),
      softDeleteByContentId: vi.fn(),
      loadCustomOPDSCatalogs: vi.fn(async () => {}),
    }),
  },
  findOPDSCatalogByContentId: () => undefined,
}));

vi.mock('@/utils/access', () => ({
  getAccessToken: async () => 'token',
}));

vi.mock('@/utils/misc', () => ({
  uniqueId: () => 'fresh-bundle',
  stubTranslation: (s: string) => s,
}));

import { useReplicaPull, __resetReplicaPullForTests } from '@/hooks/useReplicaPull';

const fakeService = { createDir: vi.fn(), name: 'fake' };

// Mock manager exposing both per-kind `pull` (used by the boot path) and
// the batched `pullMany` (used by the incremental triggers). Each test
// recreates these so individual call counts don't bleed across cases.
const makeManagerMock = () => ({
  pull: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  pullMany: vi.fn<
    (kinds: string[], opts?: { since?: string | null }) => Promise<Map<string, unknown[]>>
  >(async (kinds) => {
    const out = new Map<string, unknown[]>();
    for (const k of kinds) out.set(k, []);
    return out;
  }),
});

/**
 * Settings is implicitly pulled at boot regardless of which kinds the
 * caller asked for (so other kinds' applyRemote auto-saves don't
 * republish stale local state). For tests that only care about the
 * caller-requested kind, count just those calls.
 */
const dictionaryPullCount = (): number =>
  pullSpy.mock.calls.filter((call) => {
    const deps = call[0] as { adapter?: { kind?: string } } | undefined;
    return deps?.adapter?.kind === 'dictionary';
  }).length;

beforeEach(() => {
  vi.useFakeTimers();
  pullSpy.mockClear();
  pullSpy.mockResolvedValue(undefined);
  getReplicaSyncSpy.mockReset();
  subscribeReplicaSyncReadySpy.mockClear();
  readyListeners.clear();
  __resetReplicaPullForTests();
  envValue = { envConfig: { name: 'env' }, appService: fakeService };
  authValue = { user: { id: 'test-user' } };
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('useReplicaPull', () => {
  test('does not pull before delayMs elapses', () => {
    getReplicaSyncSpy.mockReturnValue({ manager: makeManagerMock() });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 5_000 }));

    vi.advanceTimersByTime(4_999);
    expect(pullSpy).not.toHaveBeenCalled();
  });

  test('fires pull after delayMs', async () => {
    getReplicaSyncSpy.mockReturnValue({ manager: makeManagerMock() });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 1_000 }));

    await act(async () => {
      vi.advanceTimersByTime(1_001);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Settings (implicit) + dictionary (requested).
    expect(pullSpy).toHaveBeenCalledTimes(2);
    expect(dictionaryPullCount()).toBe(1);
  });

  test('boot batches non-settings kinds into one pullMany with since=null', async () => {
    // Boot today: 1 settings call (single-kind, sequential) + 1 batched
    // pullMany call for the rest. Was previously 1 + N parallel
    // calls. The batched call must use `{ since: null }` so each kind
    // does a full refetch — same recovery semantics as the old
    // per-kind boot.
    const managerMock = makeManagerMock();
    getReplicaSyncSpy.mockReturnValue({ manager: managerMock });
    renderHook(() => useReplicaPull({ kinds: ['dictionary', 'font', 'texture'], delayMs: 100 }));
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Settings still gets its own `replicaPullAndApply` call (the
    // `dictionaryPullCount`-style counter approach is what asserts the
    // ordering elsewhere). The pullMany path collapses dictionary +
    // font + texture into a single round-trip with the since=null
    // override applied uniformly.
    expect(managerMock.pullMany).toHaveBeenCalledTimes(1);
    const [batchedKinds, batchedOpts] = managerMock.pullMany.mock.calls[0]!;
    expect([...batchedKinds].sort()).toEqual(['dictionary', 'font', 'texture']);
    expect(batchedOpts).toEqual({ since: null });
    // pullSpy is `replicaPullAndApply`; expect 1 invocation per kind
    // (settings + the three from the batch) all running through the
    // apply path.
    expect(pullSpy).toHaveBeenCalledTimes(4);
  });

  test('skips when appService is null', () => {
    envValue = { envConfig: { name: 'env' }, appService: null };
    getReplicaSyncSpy.mockReturnValue({ manager: makeManagerMock() });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));

    vi.advanceTimersByTime(500);
    expect(pullSpy).not.toHaveBeenCalled();
  });

  test('does not pull yet when replica sync context is uninitialized — subscribes for ready', () => {
    getReplicaSyncSpy.mockReturnValue(null);
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));

    vi.advanceTimersByTime(500);
    expect(pullSpy).not.toHaveBeenCalled();
    expect(subscribeReplicaSyncReadySpy).toHaveBeenCalledOnce();
  });

  test('hard-refresh race: schedules pull once initReplicaSync finishes (deferred subscriber fires)', async () => {
    // Hard refresh: appService landed first, replica-sync singleton
    // arrives after a microtask. The hook must catch up via the
    // ready-signal subscription rather than silently dropping the pull.
    getReplicaSyncSpy.mockReturnValue(null);
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    expect(subscribeReplicaSyncReadySpy).toHaveBeenCalledOnce();
    expect(pullSpy).not.toHaveBeenCalled();

    // initReplicaSync now finishes; getReplicaSync starts returning the
    // singleton, and the ready listener fires.
    getReplicaSyncSpy.mockReturnValue({ manager: makeManagerMock() });
    fireReplicaSyncReady();

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(1);
  });

  test('cleanup unsubscribes from ready listener if hook unmounts before init', () => {
    getReplicaSyncSpy.mockReturnValue(null);
    const view = renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    expect(subscribeReplicaSyncReadySpy).toHaveBeenCalledOnce();
    expect(readyListeners.size).toBe(1);
    view.unmount();
    expect(readyListeners.size).toBe(0);
  });

  test('only pulls once per kind across multiple mounts', async () => {
    getReplicaSyncSpy.mockReturnValue({ manager: makeManagerMock() });
    const first = renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(1);
    first.unmount();

    // Second mount (e.g., navigating to the reader) — same kind should NOT
    // re-pull. The visibility / online / periodic auto-pull handles
    // long-running re-syncs; this hook only does the initial boot pull.
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(1);
  });

  test('failed pull releases the dedup slot so a later navigation can retry', async () => {
    getReplicaSyncSpy.mockReturnValue({ manager: makeManagerMock() });
    // Settings pull resolves; dictionary apply (the second call) rejects.
    pullSpy.mockResolvedValueOnce(undefined);
    pullSpy.mockRejectedValueOnce(new Error('flaky'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const first = renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(1);
    first.unmount();

    // The dictionary slot was released after the rejection — second mount
    // triggers a fresh dict attempt. Settings stays cached from the first
    // mount (its promise is reused), so it does not re-pull.
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(2);
  });

  test('cleanup cancels a pending pull when the component unmounts before delayMs', () => {
    getReplicaSyncSpy.mockReturnValue({ manager: makeManagerMock() });
    const view = renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 5_000 }));
    vi.advanceTimersByTime(2_000);
    view.unmount();
    vi.advanceTimersByTime(10_000);
    expect(pullSpy).not.toHaveBeenCalled();
  });
});

describe('useReplicaPull — incremental auto-pull (visibility / online / interval)', () => {
  const advancePastBootPull = async (delayMs = 100) => {
    await act(async () => {
      vi.advanceTimersByTime(delayMs + 50);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test('window focus fires one batched incremental pull (pullMany, cursor-based)', async () => {
    getReplicaSyncSpy.mockReturnValue({
      manager: makeManagerMock(),
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1);

    // Simulate the window regaining focus (foreground transition).
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(2);

    // pullMany fires twice: once at boot for the non-settings kinds
    // (settings boot stays a single-kind `manager.pull`), and once for
    // the focus-triggered incremental over every registered kind.
    const managerMock = (
      getReplicaSyncSpy.mock.results[0]!.value as {
        manager: ReturnType<typeof makeManagerMock>;
      }
    ).manager;
    expect(managerMock.pullMany).toHaveBeenCalledTimes(2);
    // The first call (boot) gets just the non-settings kinds with
    // since=null override; the focus call gets all registered kinds
    // with cursor-based defaults.
    const bootArgs = managerMock.pullMany.mock.calls[0]!;
    expect(bootArgs[0]).toEqual(['dictionary']);
    expect(bootArgs[1]).toEqual({ since: null });
    const focusArgs = managerMock.pullMany.mock.calls[1]!;
    expect([...focusArgs[0]].sort()).toEqual(['dictionary', 'settings']);
    expect(focusArgs[1]).toBeUndefined();
  });

  test('focus is throttled to collapse iOS focus-fires-twice bursts', async () => {
    getReplicaSyncSpy.mockReturnValue({
      manager: makeManagerMock(),
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1); // boot pull only

    // Burst of focus events within the throttle window — only the first
    // fires an incremental pull. iOS Tauri's two-back-to-back focus
    // events on a single foreground transition are the real-world
    // trigger; rapid alt-tab cycling is the desktop equivalent.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(2_000);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    expect(dictionaryPullCount()).toBe(2); // boot + 1 throttled

    // Cross the throttle boundary; the next focus is allowed through.
    await act(async () => {
      vi.advanceTimersByTime(20_500);
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(3);
  });

  test('visibilitychange to visible fires an incremental pull (browser tab-switch path)', async () => {
    // Browser tab switching (cmd+1 / cmd+2) fires `visibilitychange`
    // but NOT `window.focus`. Without this listener, replica sync
    // wouldn't catch up on tab switch.
    getReplicaSyncSpy.mockReturnValue({
      manager: makeManagerMock(),
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1);

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(2);
  });

  test('visibilitychange to hidden does NOT fire a pull', async () => {
    getReplicaSyncSpy.mockReturnValue({
      manager: makeManagerMock(),
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1);

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(1); // unchanged
  });

  test('focus and visibilitychange share one throttle (no double-pump)', async () => {
    // iOS Tauri WKWebView fires both events on the same foreground
    // transition (focus first, visibilitychange ~400ms later). One
    // throttle gate prevents a double-pull.
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    getReplicaSyncSpy.mockReturnValue({
      manager: makeManagerMock(),
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });
    // Boot + ONE incremental, not two.
    expect(dictionaryPullCount()).toBe(2);
  });

  test('online and periodic triggers are NOT subject to the focus throttle', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    getReplicaSyncSpy.mockReturnValue({
      manager: makeManagerMock(),
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1);

    // Focus fires once, consuming the throttle slot.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(2);

    // Online event within the focus throttle window must STILL fire —
    // it's a different signal (we may have just regained network) and
    // shouldn't be silenced by recent foreground activity.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(3);
  });

  test('online event fires an incremental pull', async () => {
    getReplicaSyncSpy.mockReturnValue({
      manager: makeManagerMock(),
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(2);
  });

  test('5-minute interval fires periodic incremental pulls when document is visible', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    getReplicaSyncSpy.mockReturnValue({
      manager: makeManagerMock(),
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1);

    // Tick three intervals.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(5 * 60 * 1000);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    expect(dictionaryPullCount()).toBe(4);
  });

  test('periodic interval skips when document is hidden', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    getReplicaSyncSpy.mockReturnValue({
      manager: makeManagerMock(),
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1);

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(1); // no incremental fired
  });

  test('back-to-back triggers do not stack while a pull is in flight', async () => {
    let resolvePull: (() => void) | null = null;
    pullSpy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePull = () => resolve();
        }),
    );
    getReplicaSyncSpy.mockReturnValue({
      manager: makeManagerMock(),
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    // Boot pull starts. Settings is dispatched first (in flight, pending);
    // dictionary won't fire until settings resolves.
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });
    expect(pullSpy).toHaveBeenCalledTimes(1); // settings, awaiting

    // Fire several triggers while settings boot pull is still in flight.
    // pullInFlight has 'settings' → incremental settings is gated;
    // dictionary boot hasn't started yet so its incremental is gated by
    // pulledKinds (not yet added).
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
        await Promise.resolve();
      });
    }
    expect(pullSpy).toHaveBeenCalledTimes(1); // still just the settings pull

    // Resolve boot pull. Subsequent triggers can proceed.
    await act(async () => {
      resolvePull?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  test('focus / online / periodic triggers no-op when there is no user', async () => {
    // Logged-out users shouldn't burn /api/sync round-trips. Gate at the
    // dispatch layer so the module-level listeners (which run for the
    // life of the tab) don't fire pulls after sign-out.
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    authValue = { user: { id: 'user-1' } };
    getReplicaSyncSpy.mockReturnValue({
      manager: makeManagerMock(),
    });
    const { rerender } = renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1);

    // Sign out.
    authValue = { user: null };
    rerender();
    await act(async () => {
      await Promise.resolve();
    });

    // None of the auto-sync triggers should fire pulls now. Advance past
    // the focus throttle so it doesn't mask the real gate.
    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      vi.advanceTimersByTime(5 * 60 * 1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(1); // still just the original boot pull
  });

  test('listeners stay installed across mounts so a long-lived tab keeps pulling', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    getReplicaSyncSpy.mockReturnValue({
      manager: makeManagerMock(),
    });
    const first = renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1);
    first.unmount();

    // Even though the hook unmounted, the global listeners + interval
    // remain. A periodic tick should still fire an incremental pull.
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(2);
  });
});

describe('useReplicaPull — settings boot pull sequencing', () => {
  test('settings is pulled FIRST, before other kinds, even when caller did not request it', async () => {
    // Block the settings pull on a manual resolver so we can verify
    // dict pull only fires AFTER settings completes. Real-world
    // motivation: a fresh device's dict pull's auto-save would
    // republish the local default `dictionarySettings.providerOrder`
    // with a fresh HLC and overwrite Device A's reorder; sequencing
    // settings first lets applyRemoteSettings seed lastPublishedFields
    // so the auto-save's diff sees no change.
    let resolveSettings: (() => void) | null = null;
    pullSpy.mockImplementation((deps: unknown) => {
      const kind = (deps as { adapter?: { kind?: string } } | undefined)?.adapter?.kind;
      if (kind === 'settings') {
        return new Promise<void>((resolve) => {
          resolveSettings = () => resolve();
        });
      }
      return Promise.resolve();
    });
    getReplicaSyncSpy.mockReturnValue({ manager: makeManagerMock() });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));

    // Boot delay elapses; settings pull starts and is pending.
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pullSpy).toHaveBeenCalledTimes(1);
    const firstKind = (pullSpy.mock.calls[0]![0] as { adapter: { kind: string } }).adapter.kind;
    expect(firstKind).toBe('settings');
    expect(dictionaryPullCount()).toBe(0); // dict gated until settings resolves

    // Resolve settings; dict should now fire.
    await act(async () => {
      resolveSettings?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(1);
  });

  test('settings pull is shared across mounts (single network round-trip)', async () => {
    getReplicaSyncSpy.mockReturnValue({ manager: makeManagerMock() });
    const a = renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    const b = renderHook(() => useReplicaPull({ kinds: ['font'], delayMs: 100 }));
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    const settingsCalls = pullSpy.mock.calls.filter((c) => {
      const deps = c[0] as { adapter?: { kind?: string } } | undefined;
      return deps?.adapter?.kind === 'settings';
    });
    expect(settingsCalls).toHaveLength(1);
    a.unmount();
    b.unmount();
  });

  test('caller asking for settings explicitly does not double-pull settings', async () => {
    getReplicaSyncSpy.mockReturnValue({ manager: makeManagerMock() });
    renderHook(() => useReplicaPull({ kinds: ['settings', 'dictionary'], delayMs: 100 }));
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    const settingsCalls = pullSpy.mock.calls.filter((c) => {
      const deps = c[0] as { adapter?: { kind?: string } } | undefined;
      return deps?.adapter?.kind === 'settings';
    });
    expect(settingsCalls).toHaveLength(1);
    expect(dictionaryPullCount()).toBe(1);
  });
});
