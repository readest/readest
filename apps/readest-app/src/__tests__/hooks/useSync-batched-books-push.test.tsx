// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { SyncData } from '@/libs/sync';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';

const h = vi.hoisted(() => ({
  settings: { version: 1, keepLogin: true, lastSyncedAtBooks: 0 } as unknown as SystemSettings,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { id: 'env' } }),
}));

const syncClientMock = vi.hoisted(() => ({
  pullChanges: vi.fn(),
  pushChanges: vi.fn(),
}));

vi.mock('@/context/SyncContext', () => ({
  useSyncContext: () => ({ syncClient: syncClientMock }),
}));

vi.mock('@/services/sync/syncCategories', () => ({
  isSyncCategoryEnabled: () => true,
}));

vi.mock('@/store/settingsStore', () => {
  const state = { settings: h.settings, setSettings: vi.fn(), saveSettings: vi.fn() };
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

/** Next's default Pages Router body limit ('1mb'), which /api/sync keeps. */
const API_BODY_LIMIT_BYTES = 1024 * 1024;

// A library bulk-imported from a local folder of Russian FB2 files: about
// 1.3 KB per book once the parsed metadata rides along, so a thousand of them
// make a 1.6 MB push.
const makeBook = (i: number): Book =>
  ({
    hash: i.toString(16).padStart(32, '0'),
    format: 'FB2',
    title: `Варкрафт: Хроники. Энциклопедия. Том ${i}`,
    author: 'Крис Метцен, Мэтт Бернс, Роберт Брукс',
    primaryLanguage: 'ru',
    coverImageUrl: 'blob:https://web.readest.com/00000000-0000-0000-0000-000000000000',
    createdAt: 1_700_000_000_000 + i,
    updatedAt: 1_700_000_000_000 + i,
    metadata: {
      title: `Варкрафт: Хроники. Энциклопедия. Том ${i}`,
      author: 'Крис Метцен, Мэтт Бернс, Роберт Брукс',
      language: 'ru',
      description: 'Впервые за всю историю Warcraft: летопись Азерота. '.repeat(10),
      subject: ['sf_fantasy', 'Фэнтези'],
    },
  }) as Book;

const bodyBytes = (payload: SyncData) =>
  new TextEncoder().encode(JSON.stringify(payload)).byteLength;

beforeEach(() => {
  syncClientMock.pullChanges.mockReset();
  syncClientMock.pushChanges.mockReset();
  syncClientMock.pushChanges.mockResolvedValue({ books: [], configs: null, notes: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
});

const renderSync = async () => {
  const hook = renderHook(() => useSync());
  // syncBooks waits for the cursors to be read from settings.
  await waitFor(() => expect(hook.result.current.useSyncInited).toBe(true));
  return hook;
};

describe('books push', () => {
  test('sends a bulk-imported library in requests the API accepts', async () => {
    const books = Array.from({ length: 1027 }, (_, i) => makeBook(i));
    expect(bodyBytes({ books })).toBeGreaterThan(API_BODY_LIMIT_BYTES);

    const { result } = await renderSync();
    await act(async () => {
      await result.current.syncBooks(books, 'push');
    });

    const payloads = syncClientMock.pushChanges.mock.calls.map(([p]) => p as SyncData);
    for (const payload of payloads) {
      expect(bodyBytes(payload)).toBeLessThanOrEqual(API_BODY_LIMIT_BYTES);
    }
    expect(payloads.flatMap((p) => p.books!.map((b) => b.hash))).toEqual(books.map((b) => b.hash));
  });

  test('stops at the first failed request and leaves the rest for the next sync', async () => {
    syncClientMock.pushChanges
      .mockResolvedValueOnce({ books: [], configs: null, notes: null })
      .mockRejectedValueOnce(new Error('Failed to push changes: Not authenticated'));
    const books = Array.from({ length: 1027 }, (_, i) => makeBook(i));

    const { result } = await renderSync();
    await act(async () => {
      await result.current.syncBooks(books, 'push');
    });

    expect(syncClientMock.pushChanges).toHaveBeenCalledTimes(2);
  });

  test('sends a small change in one request', async () => {
    const { result } = await renderSync();
    await act(async () => {
      await result.current.syncBooks([makeBook(1), makeBook(2)], 'push');
    });

    expect(syncClientMock.pushChanges).toHaveBeenCalledTimes(1);
  });
});
