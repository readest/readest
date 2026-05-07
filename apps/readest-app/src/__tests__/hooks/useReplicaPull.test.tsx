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

vi.mock('@/utils/access', () => ({
  getAccessToken: async () => 'token',
}));

vi.mock('@/utils/misc', () => ({
  uniqueId: () => 'fresh-bundle',
}));

import { useReplicaPull, __resetReplicaPullForTests } from '@/hooks/useReplicaPull';

const fakeService = { createDir: vi.fn(), name: 'fake' };

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
    });
    expect(pullSpy).toHaveBeenCalledOnce();
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
    });
    expect(pullSpy).toHaveBeenCalledOnce();
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
    });
    expect(pullSpy).toHaveBeenCalledOnce();
    first.unmount();

    // Second mount (e.g., navigating to the reader) — same kind should NOT
    // re-pull. ReplicaSyncManager.startAutoSync handles visibility / online
    // resync; this hook is for the once-per-session initial pull only.
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(pullSpy).toHaveBeenCalledOnce();
  });

  test('failed pull releases the dedup slot so a later navigation can retry', async () => {
    getReplicaSyncSpy.mockReturnValue({ manager: {} });
    pullSpy.mockRejectedValueOnce(new Error('flaky'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const first = renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pullSpy).toHaveBeenCalledTimes(1);
    first.unmount();

    // The slot was released after the rejection — second mount triggers
    // a fresh attempt.
    renderHook(() => useReplicaPull({ kinds: ['dictionary'], delayMs: 100 }));
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(pullSpy).toHaveBeenCalledTimes(2);
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
