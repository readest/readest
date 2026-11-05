import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { SyncData } from '@/libs/sync';
import type { SystemSettings } from '@/types/settings';

const h = vi.hoisted(() => {
  const baseSettings = (): SystemSettings =>
    ({
      version: 1,
      keepLogin: true,
      lastSyncedAtBooks: 0,
      lastSyncedAtConfigs: 0,
      lastSyncedAtNotes: 0,
      webdav: {
        enabled: false,
        serverUrl: '',
        username: '',
        password: '',
        rootPath: '/',
      },
    }) as unknown as SystemSettings;

  // The live store object. `settings` is reassigned (new ref) to model a
  // component calling setSettings with a fresh object, exactly like the
  // WebDAV connect handler does.
  const storeState = {
    settings: baseSettings(),
    setSettings: vi.fn((s: SystemSettings) => {
      storeState.settings = s;
    }),
    saveSettings: vi.fn(async (_env: unknown, _settings: SystemSettings) => {}),
  };

  return { baseSettings, storeState };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { id: 'env' } }),
}));

const syncClientMock = vi.hoisted(() => ({
  pullChanges: vi.fn(),
  pushChanges: vi.fn(async () => ({ books: null, configs: null, notes: null })),
}));

vi.mock('@/context/SyncContext', () => ({
  useSyncContext: () => ({ syncClient: syncClientMock }),
}));

vi.mock('@/services/sync/syncCategories', () => ({
  isSyncCategoryEnabled: () => true,
}));

vi.mock('@/store/settingsStore', () => {
  const useSettingsStore = ((selector?: (s: typeof h.storeState) => unknown) =>
    selector ? selector(h.storeState) : h.storeState) as unknown as {
    (): typeof h.storeState;
    getState: () => typeof h.storeState;
  };
  useSettingsStore.getState = () => h.storeState;
  return { useSettingsStore };
});

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getConfig: () => null, setConfig: vi.fn() }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setIsSyncing: vi.fn() }),
}));

vi.mock('@/utils/nav', () => ({ navigateToLogin: vi.fn() }));

vi.mock('@/utils/transform', () => ({
  transformBookFromDB: (x: unknown) => x,
  transformBookNoteFromDB: (x: unknown) => x,
  transformBookConfigFromDB: (x: unknown) => x,
}));

import { useSync } from '@/hooks/useSync';
import { readFlowState } from '@/services/sync/dataFlow/log';

beforeEach(() => {
  h.storeState.settings = h.baseSettings();
  h.storeState.setSettings.mockClear();
  h.storeState.saveSettings.mockClear();
  syncClientMock.pullChanges.mockReset();
  syncClientMock.pushChanges.mockReset();
  syncClientMock.pushChanges.mockResolvedValue({ books: null, configs: null, notes: null });
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
});

describe('useSync data flow', () => {
  const pull = (type: 'books' | 'configs' | 'notes') => {
    const { result } = renderHook(() => useSync());
    return act(async () => {
      await result.current.pullChanges(type, 0, vi.fn(), vi.fn());
    });
  };

  const push = (payload: SyncData) => {
    const { result } = renderHook(() => useSync());
    return act(async () => {
      await result.current.pushChanges(payload);
    });
  };

  test('counts the notes a pull brought in', async () => {
    syncClientMock.pullChanges.mockResolvedValue({
      notes: [{ updated_at: 'x' }, { updated_at: 'y' }, { deleted_at: 'z' }],
    });

    await pull('notes');

    expect(readFlowState().entries[0]).toMatchObject({
      connector: 'readest-cloud',
      direction: 'pull',
      kind: 'notes',
      count: 2,
    });
  });

  test('files configs under reading progress', async () => {
    syncClientMock.pullChanges.mockResolvedValue({ configs: [{ updated_at: 'x' }] });

    await pull('configs');

    expect(readFlowState().entries[0]).toMatchObject({ kind: 'progress', count: 1 });
  });

  test('records a failed pull', async () => {
    syncClientMock.pullChanges.mockRejectedValue(new Error('HTTP 503'));

    await pull('notes');

    expect(readFlowState().entries[0]).toMatchObject({ direction: 'pull', error: 'HTTP 503' });
  });

  test('counts what a push sent, per kind', async () => {
    await push({ notes: [{}, {}], configs: [{}] } as unknown as SyncData);

    const { totals } = readFlowState();
    expect(totals['readest-cloud:push:notes']?.count).toBe(2);
    expect(totals['readest-cloud:push:progress']?.count).toBe(1);
    expect(totals['readest-cloud:push:books']).toBeUndefined();
  });

  test('records a failed push', async () => {
    syncClientMock.pushChanges.mockRejectedValue(new Error('HTTP 500'));

    await push({ notes: [{}] } as unknown as SyncData);

    expect(readFlowState().entries[0]).toMatchObject({ direction: 'push', error: 'HTTP 500' });
  });
});
