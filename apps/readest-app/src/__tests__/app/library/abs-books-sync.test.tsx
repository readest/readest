import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import type { Book } from '@/types/book';
import { makeAbsFilePath } from '@/utils/audiobook';

/**
 * ABS books are stubs for streams on an Audiobookshelf server. Their whole
 * identity is `filePath` (`abs://<serverId>/<itemId>`) — and the cloud push
 * strips `filePath` from every row, because for ordinary books it is a
 * device-local absolute path.
 *
 * So an ABS book that reaches the Readest Cloud book channel arrives on peers
 * as a `format: 'ABS'` row with nothing to resolve: unopenable, stuck at 0:00,
 * and permanently stranded — `reconcileAbsBooks` only touches books it can
 * parse a server id out of, so it neither heals nor tombstones them. Worse, on
 * a peer that HAS the same server configured, that row merges over the good
 * local one and takes its filePath away.
 *
 * ABS books must stay out of the push, and a filePath-less ABS row must be
 * dropped on the way back in.
 */

const ABS_FILE_PATH = makeAbsFilePath('srv-content-id', 'item-1');

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

describe('ABS audiobooks and the Readest Cloud book channel', () => {
  it('never pushes an ABS book to the cloud', async () => {
    useLibraryStore.getState().setLibrary([
      makeBook({
        hash: 'abs-1',
        format: 'ABS',
        filePath: ABS_FILE_PATH,
        title: 'An Audiobook',
      }),
      makeBook({ hash: 'mine-1', title: 'My Own Book' }),
    ]);

    const { result } = renderHook(() => useBooksSync());
    await result.current.pushLibrary();

    // Both the explicit push and the auto-sync effect push, so assert on the
    // set of hashes that ever reached the cloud channel, not the call count.
    const pushed = new Set(
      syncState.syncBooks.mock.calls
        .flatMap((call) => (call[0] ?? []) as Book[])
        .map((book) => book.hash),
    );

    expect([...pushed]).toEqual(['mine-1']);
  });

  it('drops a filePath-less ABS row on pull instead of stranding the local book', async () => {
    // Local: this device materialized the audiobook itself from the ABS
    // server, so it has a real filePath and a fresh position. Cloud: the row a
    // peer pushed before ABS books were excluded — same hash, no filePath, and
    // a newer updatedAt, so it wins whole-row LWW.
    useLibraryStore.getState().setLibrary([
      makeBook({
        hash: 'abs-1',
        format: 'ABS',
        filePath: ABS_FILE_PATH,
        title: 'An Audiobook',
        progress: [900, 3600],
        updatedAt: 1000,
      }),
      makeBook({ hash: 'mine-1', title: 'My Own Book', uploadedAt: 1000 }),
    ]);
    syncState.syncedBooks = [
      makeBook({
        hash: 'abs-1',
        format: 'ABS',
        title: 'An Audiobook',
        progress: [0, 3600],
        updatedAt: 3000,
      }),
      // A never-seen ABS row from a server this device has not configured:
      // there is nothing here that could ever resolve to a stream.
      makeBook({
        hash: 'abs-2',
        format: 'ABS',
        title: 'Someone Else Audiobook',
        uploadedAt: 2000,
        updatedAt: 3000,
      }),
      makeBook({ hash: 'mine-1', title: 'My Own Book', uploadedAt: 1000, updatedAt: 3000 }),
    ];

    renderHook(() => useBooksSync());

    await waitFor(() => expect(appService.saveLibraryBooks).toHaveBeenCalled());

    const library = useLibraryStore.getState().library;
    const local = library.find((book) => book.hash === 'abs-1');
    expect(local?.filePath).toBe(ABS_FILE_PATH);
    expect(local?.progress).toEqual([900, 3600]);
    expect(library.find((book) => book.hash === 'abs-2')).toBeUndefined();
    // Ordinary books still merge as before.
    expect(library.find((book) => book.hash === 'mine-1')?.updatedAt).toBe(3000);
  });
});
