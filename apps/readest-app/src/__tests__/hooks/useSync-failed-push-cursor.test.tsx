// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';

const h = vi.hoisted(() => ({ settings: {} as SystemSettings }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { id: 'env' } }),
}));

const syncClientMock = vi.hoisted(() => ({ pullChanges: vi.fn(), pushChanges: vi.fn() }));

vi.mock('@/context/SyncContext', () => ({
  useSyncContext: () => ({ syncClient: syncClientMock }),
}));

vi.mock('@/services/sync/syncCategories', () => ({
  isSyncCategoryEnabled: () => true,
}));

vi.mock('@/store/settingsStore', () => {
  const state = {
    get settings() {
      return h.settings;
    },
    setSettings: vi.fn((s: SystemSettings) => {
      h.settings = s;
    }),
    saveSettings: vi.fn(),
  };
  const useSettingsStore = ((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state) as unknown as {
    (): typeof state;
    getState: () => typeof state;
  };
  useSettingsStore.getState = () => state;
  return { useSettingsStore };
});

vi.mock('@/store/bookDataStore', () => {
  const state = { getConfig: () => null, setConfig: vi.fn() };
  return {
    useBookDataStore: (select?: (s: typeof state) => unknown) => (select ? select(state) : state),
  };
});

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setIsSyncing: vi.fn() }),
}));

vi.mock('@/utils/nav', () => ({ navigateToLogin: vi.fn() }));

import { useSync } from '@/hooks/useSync';

const EDITED_AT = 1_800_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

// A book this device synced before, then edited: the push filter sends it only
// while the books cursor is below its change time (getNewBooks).
const editedBook = {
  hash: 'a'.repeat(32),
  format: 'EPUB',
  title: 'Edited',
  author: 'A',
  createdAt: 1,
  updatedAt: EDITED_AT,
  syncedAt: EDITED_AT - 60_000,
} as Book;

beforeEach(() => {
  h.settings = { version: 1, keepLogin: true, lastSyncedAtBooks: 0 } as unknown as SystemSettings;
  syncClientMock.pushChanges.mockReset();
  syncClientMock.pullChanges.mockReset();
  // The pull brings back rows written after the edit, e.g. by another device.
  syncClientMock.pullChanges.mockResolvedValue({
    books: [{ book_hash: 'b'.repeat(32), synced_at: iso(EDITED_AT + 60_000) }],
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
});

const syncBoth = async () => {
  const { result } = renderHook(() => useSync());
  await waitFor(() => expect(result.current.useSyncInited).toBe(true));
  await act(async () => {
    await result.current.syncBooks([editedBook], 'both');
  });
  return result;
};

describe('books cursor after a push', () => {
  test('stays below the changes a failed push left unsent', async () => {
    syncClientMock.pushChanges.mockRejectedValue(new Error('Failed to push changes: 503'));

    const result = await syncBoth();

    expect(result.current.lastSyncedAtBooks).toBeLessThan(EDITED_AT);
    expect(h.settings.lastSyncedAtBooks).toBeLessThan(EDITED_AT);
  });

  test('advances to the pulled rows when the push went through', async () => {
    syncClientMock.pushChanges.mockResolvedValue({ books: [], configs: null, notes: null });

    const result = await syncBoth();

    expect(result.current.lastSyncedAtBooks).toBe(EDITED_AT + 60_000);
  });

  // Pull to refresh, the library opening and the settings sync row pull books
  // without pushing (pullLibrary).
  const pullOnly = async (result: Awaited<ReturnType<typeof syncBoth>>, syncedAt: number) => {
    syncClientMock.pullChanges.mockResolvedValue({
      books: [{ book_hash: 'c'.repeat(32), synced_at: iso(syncedAt) }],
    });
    await act(async () => {
      await result.current.syncBooks([], 'pull', 0);
    });
  };

  test('stays below them through a later pull-only sync', async () => {
    syncClientMock.pushChanges.mockRejectedValue(new Error('Failed to push changes: 503'));
    const result = await syncBoth();

    await pullOnly(result, EDITED_AT + 120_000);

    expect(result.current.lastSyncedAtBooks).toBeLessThan(EDITED_AT);
    expect(h.settings.lastSyncedAtBooks).toBeLessThan(EDITED_AT);
  });

  test('advances again once a later push sends them', async () => {
    syncClientMock.pushChanges.mockRejectedValueOnce(new Error('Failed to push changes: 503'));
    const result = await syncBoth();
    syncClientMock.pushChanges.mockResolvedValue({ books: [], configs: null, notes: null });
    await act(async () => {
      await result.current.syncBooks([editedBook], 'push');
    });

    await pullOnly(result, EDITED_AT + 120_000);

    expect(result.current.lastSyncedAtBooks).toBe(EDITED_AT + 120_000);
  });
});
