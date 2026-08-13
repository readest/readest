import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Book } from '@/types/book';
import type { OPDSCatalog } from '@/types/opds';
import type { SystemSettings } from '@/types/settings';

const saveLibraryBooks = vi.fn<(books: Book[]) => Promise<void>>(async () => {});
const appService = { saveLibraryBooks };

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));
const translate = (key: string) => key;
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => translate,
}));
vi.mock('@/services/transferManager', () => ({
  transferManager: { queueUpload: vi.fn() },
}));
vi.mock('@/services/opds', () => ({
  syncSubscribedCatalogs: vi.fn(),
}));

import { syncSubscribedCatalogs } from '@/services/opds';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useOPDSSubscriptions } from '@/hooks/useOPDSSubscriptions';

const mockedSync = vi.mocked(syncSubscribedCatalogs);

const makeBook = (hash: string, overrides: Partial<Book> = {}): Book =>
  ({
    hash,
    format: 'EPUB',
    title: `Book ${hash}`,
    sourceTitle: `Book ${hash}`,
    author: 'Author',
    createdAt: 1000,
    updatedAt: 1000,
    uploadedAt: null,
    downloadedAt: 1000,
    deletedAt: null,
    ...overrides,
  }) as Book;

const catalog = {
  id: 'cat-1',
  name: 'Feed',
  url: 'https://opds.example.com/feed',
  autoDownload: true,
} as OPDSCatalog;

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  useSettingsStore.setState({
    settings: { opdsCatalogs: [catalog] } as unknown as SystemSettings,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useLibraryStore.setState({ library: [], libraryLoaded: false, visibleLibrary: [] });
});

describe('useOPDSSubscriptions', () => {
  test('persists a genuinely new downloaded book', async () => {
    useLibraryStore.getState().setLibrary([]);
    // Subsequent checks find nothing new (the entry is in knownEntryIds).
    mockedSync.mockResolvedValue({ newBooks: [], totalNewBooks: 0, errors: [] });
    mockedSync.mockImplementationOnce(async (_catalogs, _appService, _books, onBooksImported) => {
      const book = makeBook('new-book', { downloadedAt: Date.now() });
      // The real service persists the imported books (via the callback)
      // before recording their entries in knownEntryIds.
      await onBooksImported?.([book]);
      return { newBooks: [book], totalNewBooks: 1, errors: [] };
    });

    renderHook(() => useOPDSSubscriptions());
    await settle();

    expect(saveLibraryBooks).toHaveBeenCalled();
    const saved = saveLibraryBooks.mock.lastCall![0];
    expect(saved.some((b) => b.hash === 'new-book')).toBe(true);
    expect(useLibraryStore.getState().visibleLibrary.some((b) => b.hash === 'new-book')).toBe(true);
  });

  test('persists the resurrection of a previously deleted book (#5658)', async () => {
    // A tombstoned row for the same file is already in the library — the user
    // deleted the book at some point. importBook resurrects that row IN PLACE
    // (clears deletedAt on the existing object) and returns it, rather than
    // returning a fresh row.
    const tombstoned = makeBook('dead-book', { deletedAt: 123 });
    useLibraryStore.getState().setLibrary([tombstoned]);
    expect(useLibraryStore.getState().visibleLibrary).toHaveLength(0);

    // Subsequent checks find nothing new (the entry is in knownEntryIds).
    mockedSync.mockResolvedValue({ newBooks: [], totalNewBooks: 0, errors: [] });
    mockedSync.mockImplementationOnce(async (_catalogs, _appService, books, onBooksImported) => {
      const row = books.find((b) => b.hash === 'dead-book')!;
      row.deletedAt = null;
      row.updatedAt = Date.now();
      row.downloadedAt = Date.now();
      await onBooksImported?.([row]);
      return { newBooks: [row], totalNewBooks: 1, errors: [] };
    });

    renderHook(() => useOPDSSubscriptions());
    await settle();

    // The resurrection must reach disk: the subscription state has already
    // recorded the feed entry as known, so if the library is not saved the
    // book stays tombstoned on disk and is never downloaded again.
    expect(saveLibraryBooks).toHaveBeenCalled();
    const saved = saveLibraryBooks.mock.lastCall![0];
    const savedRow = saved.find((b) => b.hash === 'dead-book');
    expect(savedRow?.deletedAt).toBeNull();
    // And the book must show up on the shelf without a restart.
    expect(useLibraryStore.getState().visibleLibrary.some((b) => b.hash === 'dead-book')).toBe(
      true,
    );
  });
});
