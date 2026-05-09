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
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('useReplicaPull', () => {
  test('does not pull before delayMs elapses', () => {
    getReplicaSyncSpy.mockReturnValue({ manager: {} });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 5_000 }));

    vi.advanceTimersByTime(4_999);
    expect(pullSpy).not.toHaveBeenCalled();
  });

  test('fires pull after delayMs', async () => {
    getReplicaSyncSpy.mockReturnValue({ manager: {} });
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

  test('skips when appService is null', () => {
    envValue = { envConfig: { name: 'env' }, appService: null };
    getReplicaSyncSpy.mockReturnValue({ manager: {} });
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
    getReplicaSyncSpy.mockReturnValue({ manager: {} });
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
    getReplicaSyncSpy.mockReturnValue({ manager: {} });
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
    getReplicaSyncSpy.mockReturnValue({ manager: {} });
    // Settings pull resolves; dictionary pull (the second call) rejects.
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
    getReplicaSyncSpy.mockReturnValue({ manager: {} });
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

  test('visibilitychange to visible fires an incremental pull (cursor-based, not since=null)', async () => {
    getReplicaSyncSpy.mockReturnValue({
      manager: { pull: vi.fn(async () => []) },
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1);

    // Simulate tab going hidden, then visible. The "visible" transition
    // is the trigger.
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

    // The incremental call's pull deps should NOT pin since=null —
    // that's the boot-only behavior. Inspect the LAST dict pull deps.
    const dictCalls = pullSpy.mock.calls.filter((c) => {
      const deps = c[0] as { adapter?: { kind?: string } } | undefined;
      return deps?.adapter?.kind === 'dictionary';
    });
    const incrementalCall = dictCalls.at(-1)![0] as { pull: () => Promise<unknown[]> };
    await incrementalCall.pull();
    const managerPull = (
      getReplicaSyncSpy.mock.results[0]!.value as { manager: { pull: ReturnType<typeof vi.fn> } }
    ).manager.pull;
    // Boot call uses { since: null }; incremental call passes undefined
    // (or no opts) so manager.pull falls back to the cursor.
    expect(managerPull).toHaveBeenCalled();
    const lastArgs = managerPull.mock.calls.at(-1);
    expect(lastArgs?.[1]).toBeUndefined();
  });

  test('visibilitychange is throttled to at most one fire per 30 seconds', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    getReplicaSyncSpy.mockReturnValue({
      manager: { pull: vi.fn(async () => []) },
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1); // boot pull only

    // Burst of visibility changes within the throttle window — only the
    // first should fire an incremental pull. Rapid alt-tab cycling is
    // the real-world trigger. Advance ~10s total (well under 30s).
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(2_000);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    expect(dictionaryPullCount()).toBe(2); // boot + 1 throttled

    // Cross the 30s boundary (we already advanced 10s above; advance
    // the remaining time and a touch more).
    await act(async () => {
      vi.advanceTimersByTime(20_500);
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(3);
  });

  test('online and periodic triggers are NOT subject to the visibility throttle', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    getReplicaSyncSpy.mockReturnValue({
      manager: { pull: vi.fn(async () => []) },
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await advancePastBootPull();
    expect(dictionaryPullCount()).toBe(1);

    // Visibility fires once, consuming the throttle slot.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(2);

    // Online event within the visibility throttle window must STILL
    // fire — it's a different signal (we may have just regained
    // network) and shouldn't be silenced by recent focus activity.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dictionaryPullCount()).toBe(3);
  });

  test('online event fires an incremental pull', async () => {
    getReplicaSyncSpy.mockReturnValue({
      manager: { pull: vi.fn(async () => []) },
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
      manager: { pull: vi.fn(async () => []) },
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
      manager: { pull: vi.fn(async () => []) },
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
      manager: { pull: vi.fn(async () => []) },
    });
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    // Boot pull starts. Settings is dispatched first (in flight, pending);
    // dictionary won't fire until settings resolves.
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });
    expect(pullSpy).toHaveBeenCalledTimes(1); // settings, awaiting

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    // Fire several triggers while settings boot pull is still in flight.
    // pullInFlight has 'settings' → incremental settings is gated;
    // dictionary boot hasn't started yet so its incremental is gated by
    // pulledKinds (not yet added).
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
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

  test('listeners stay installed across mounts so a long-lived tab keeps pulling', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    getReplicaSyncSpy.mockReturnValue({
      manager: { pull: vi.fn(async () => []) },
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
    getReplicaSyncSpy.mockReturnValue({ manager: { pull: vi.fn(async () => []) } });
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
    getReplicaSyncSpy.mockReturnValue({ manager: { pull: vi.fn(async () => []) } });
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
    getReplicaSyncSpy.mockReturnValue({ manager: { pull: vi.fn(async () => []) } });
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
