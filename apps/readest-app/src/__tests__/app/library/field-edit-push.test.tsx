import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Issue #6414 — grouping, tagging and metadata / cover edits stamp only their
 * own field clock and leave `updatedAt` (the Date Read sort key) alone. The
 * cloud push must still pick those books up as changed.
 */

const appService = vi.hoisted(() => ({
  saveLibraryBooks: vi.fn(async () => {}),
  generateCoverImageUrl: vi.fn(async () => 'blob:cover'),
  downloadBookCovers: vi.fn(async () => {}),
}));

const syncState = vi.hoisted(() => ({
  useSyncInited: true,
  syncedBooks: null as Book[] | null,
  syncBooks: vi.fn(async (_books?: Book[], _op?: string, _since?: number) => 0),
  lastSyncedAtBooks: 1000,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService }),
}));

vi.mock('@/context/SyncContext', () => ({
  useSyncContext: () => ({ syncClient: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string) => text,
}));

vi.mock('@/hooks/useSync', () => ({
  useSync: () => syncState,
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  isReadestCloudEnabled: () => true,
  getActiveFileSyncBackends: () => [],
}));

vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runFileLibrarySyncPass: vi.fn(async () => ({ booksSynced: 0 })),
}));

const { useBooksSync } = await import('@/app/library/hooks/useBooksSync');
const { useLibraryStore } = await import('@/store/libraryStore');

const makeBook = (over: Partial<Book> & Pick<Book, 'hash'>): Book => ({
  format: 'EPUB',
  title: 'Title',
  author: 'Author',
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  syncState.syncedBooks = null;
  useLibraryStore.setState({ library: [], libraryLoaded: false, isSyncing: false });
});

describe('pushing field-only edits (issue #6414)', () => {
  it('pushes books whose only change is on a field clock', async () => {
    // Every book was last synced at 1000 and last read before that.
    const synced = { updatedAt: 900, syncedAt: 1000 };
    useLibraryStore.getState().setLibrary([
      makeBook({ hash: 'unchanged', ...synced }),
      makeBook({
        hash: 'grouped',
        ...synced,
        groupId: 'g1',
        groupName: 'G',
        groupUpdatedAt: 2000,
      }),
      makeBook({ hash: 'tagged', ...synced, tags: ['t'], metadataUpdatedAt: 2000 }),
      makeBook({ hash: 'cover', ...synced, coverHash: 'c', coverUpdatedAt: 2000 }),
    ]);

    const { result } = renderHook(() => useBooksSync());
    await result.current.pushLibrary();

    const pushed = new Set(
      syncState.syncBooks.mock.calls
        .flatMap((call) => (call[0] ?? []) as Book[])
        .map((book) => book.hash),
    );
    expect([...pushed].sort()).toEqual(['cover', 'grouped', 'tagged']);
  });
});
