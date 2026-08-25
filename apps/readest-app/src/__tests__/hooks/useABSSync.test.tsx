import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { AppService } from '@/types/system';
import type { ABSServer } from '@/types/audiobookshelf';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';

const appService = {} as AppService;
const envConfig = { getAppService: async () => appService } as EnvConfigType;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService, envConfig }),
}));
// absServerStore publishes replica upserts/deletes from its mutators; those
// aren't exercised here (state is seeded directly via setState), but the
// module still imports replicaPublish at load time.
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));
vi.mock('@/services/audiobookshelf/librarySync', () => ({
  syncAllAbsServers: vi.fn(),
  backfillAbsCovers: vi.fn(),
}));

import { backfillAbsCovers, syncAllAbsServers } from '@/services/audiobookshelf/librarySync';
import { useABSServerStore } from '@/store/absServerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { useABSSync } from '@/hooks/useABSSync';

const mockedSync = vi.mocked(syncAllAbsServers);
const mockedBackfill = vi.mocked(backfillAbsCovers);

// contentId/addedAt already set so loadABSServers' backfill is a no-op and
// doesn't fire an unrelated saveSettings call.
const server: ABSServer = {
  id: 's1',
  contentId: 's1',
  addedAt: 1,
  name: 'Home',
  url: 'http://abs.local',
};

const makeSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    absServers: [],
    ...overrides,
  }) as unknown as SystemSettings;

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  useABSServerStore.setState({ servers: [] });
  useSettingsStore.setState({
    settings: makeSettings(),
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
    saveSettings: vi.fn(),
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useABSServerStore.setState({ servers: [] });
});

describe('useABSSync', () => {
  test('syncs once on mount when the store is already hydrated with servers', async () => {
    useABSServerStore.setState({ servers: [server] });
    useSettingsStore.setState({ settings: makeSettings({ absServers: [server] }) });
    mockedSync.mockResolvedValue();

    renderHook(() => useABSSync());
    await settle();

    expect(mockedSync).toHaveBeenCalledTimes(1);
    expect(mockedSync).toHaveBeenCalledWith(appService);
  });

  test('backfills covers before the authenticated sync so a failing login cannot block them', async () => {
    useABSServerStore.setState({ servers: [server] });
    const order: string[] = [];
    mockedBackfill.mockImplementation(async () => {
      order.push('backfill');
    });
    mockedSync.mockImplementation(async () => {
      order.push('sync');
    });

    renderHook(() => useABSSync());
    await settle();

    expect(order).toEqual(['backfill', 'sync']);
    expect(mockedBackfill).toHaveBeenCalledWith(appService);
  });

  test('does not sync when neither the store nor settings have servers', async () => {
    mockedSync.mockResolvedValue();

    renderHook(() => useABSSync());
    await settle();

    expect(mockedSync).not.toHaveBeenCalled();
  });

  test('hydrates the empty store from settings on mount, then syncs', async () => {
    // Reproduces the fresh-boot bug: the store was never populated (no
    // IntegrationsPanel mount, no replica pull), but settings.absServers
    // already has the persisted server. The hook must hydrate before its
    // empty-store no-op check runs.
    useSettingsStore.setState({ settings: makeSettings({ absServers: [server] }) });
    mockedSync.mockResolvedValue();

    renderHook(() => useABSSync());
    await settle();

    expect(useABSServerStore.getState().getAvailableServers()).toEqual([server]);
    expect(mockedSync).toHaveBeenCalledTimes(1);
    expect(mockedSync).toHaveBeenCalledWith(appService);
  });

  // `EnvProvider` publishes `appService` BEFORE `appService.loadSettings()`
  // resolves, so the mount-time hydration can read the `{}` placeholder
  // settings. Caching that empty result stranded ABS sync for the whole
  // session — and left every `saveABSServers` publishing an empty list.
  test('re-hydrates when the first attempt ran before settings loaded', async () => {
    useSettingsStore.setState({ settings: {} as SystemSettings });
    mockedSync.mockResolvedValue();

    renderHook(() => useABSSync());
    await settle();
    expect(mockedSync).not.toHaveBeenCalled();

    // Settings land after that first attempt.
    useSettingsStore.setState({ settings: makeSettings({ absServers: [server] }) });
    await act(async () => {
      await eventDispatcher.dispatch('sync-abs-servers');
    });

    expect(useABSServerStore.getState().getAvailableServers()).toEqual([server]);
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  test('the sync-abs-servers event triggers a run', async () => {
    mockedSync.mockResolvedValue();

    renderHook(() => useABSSync());
    await settle();
    expect(mockedSync).not.toHaveBeenCalled();

    useABSServerStore.setState({ servers: [server] });
    await act(async () => {
      await eventDispatcher.dispatch('sync-abs-servers');
    });

    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  test('unmount clears the interval', async () => {
    vi.useFakeTimers();
    try {
      useABSServerStore.setState({ servers: [server] });
      useSettingsStore.setState({ settings: makeSettings({ absServers: [server] }) });
      mockedSync.mockResolvedValue();

      const { unmount } = renderHook(() => useABSSync());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockedSync).toHaveBeenCalledTimes(1);

      unmount();
      await act(async () => {
        vi.advanceTimersByTime(5 * 60 * 1000);
      });

      expect(mockedSync).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
