import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import type { Book } from '@/types/book';
import { buildAbsBookMetadata, makeAbsFilePath } from '@/utils/audiobook';

/**
 * ABS books are stubs for streams on an Audiobookshelf server. Their whole
 * identity is `filePath` (`abs://<serverId>/<itemId>`) — and the cloud push
 * strips `filePath` from every row, because for ordinary books it is a
 * device-local absolute path.
 *
 * So the identity rides across inside the synced `metadata` column instead
 * (`metadata.absSource`, mirroring how a feed book carries `metadata.feedUrl`),
 * and `transformBookFromDB` rebuilds `filePath` from it on the way in. That
 * makes an ABS row shareable across devices: peers shelve it, and a peer that
 * has the same server configured adopts it by hash instead of duplicating it.
 *
 * A row that still has no resolvable identity — one pushed before the mirror
 * existed — is dead on arrival and must still be dropped.
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

/** An ABS row as reconcileAbsBooks produces it: filePath plus the mirror. */
const makeAbsBook = (over: Partial<Book> & Pick<Book, 'hash'>): Book => {
  const book = makeBook({
    format: 'ABS',
    filePath: ABS_FILE_PATH,
    title: 'An Audiobook',
    duration: 3600,
    ...over,
  });
  book.metadata = buildAbsBookMetadata(book);
  return book;
};

beforeEach(() => {
  vi.clearAllMocks();
  syncState.syncedBooks = null;
  useLibraryStore.setState({ library: [], libraryLoaded: false, isSyncing: false });
});

describe('ABS audiobooks and the Readest Cloud book channel', () => {
  it('pushes an ABS book, carrying its identity in metadata instead of filePath', async () => {
    useLibraryStore
      .getState()
      .setLibrary([makeAbsBook({ hash: 'abs-1' }), makeBook({ hash: 'mine-1' })]);

    const { result } = renderHook(() => useBooksSync());
    await result.current.pushLibrary();

    // Both the explicit push and the auto-sync effect push, so assert on the
    // set of rows that ever reached the cloud channel, not the call count.
    const pushed = new Map(
      syncState.syncBooks.mock.calls
        .flatMap((call) => (call[0] ?? []) as Book[])
        .map((book) => [book.hash, book]),
    );

    expect([...pushed.keys()].sort()).toEqual(['abs-1', 'mine-1']);
    const abs = pushed.get('abs-1')!;
    expect(abs.filePath).toBeUndefined();
    expect(abs.metadata?.absSource).toBe(ABS_FILE_PATH);
  });

  it('shelves a pulled ABS row even though it has no uploadedAt', async () => {
    useLibraryStore.setState({ libraryLoaded: true });
    // What transformBookFromDB hands the hook: filePath rebuilt from the
    // mirror, and no uploadedAt (an ABS stub has no file in cloud storage).
    syncState.syncedBooks = [makeAbsBook({ hash: 'abs-1', uploadedAt: null, updatedAt: 3000 })];

    renderHook(() => useBooksSync());

    await waitFor(() => {
      const shelved = useLibraryStore.getState().library.find((book) => book.hash === 'abs-1');
      expect(shelved?.filePath).toBe(ABS_FILE_PATH);
      expect(shelved?.duration).toBe(3600);
    });
  });

  it('drops a filePath-less ABS row instead of stranding the local book', async () => {
    // Local: this device materialized the audiobook itself from the ABS
    // server, so it has a real filePath and a fresh position. Cloud: a row
    // pushed before the metadata mirror existed — same hash, nothing to
    // resolve a server or item from, and a newer updatedAt so it wins LWW.
    useLibraryStore.getState().setLibrary([
      makeAbsBook({
        hash: 'abs-1',
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
      // A never-seen ABS row with no identity either: nothing here could ever
      // resolve to a stream.
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
