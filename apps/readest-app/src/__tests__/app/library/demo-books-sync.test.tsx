import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Issue #5049 — "web.readest.com after signing in retains the example books".
 *
 * The demo books are the sample shelf an anonymous web visitor gets. They are
 * imported as ordinary url-backed Book rows, so once the user signs in they are
 * indistinguishable from the user's own books:
 *
 *   1. they get pushed to the user's cloud library, and
 *   2. deleting them does not stick — the cloud row never learned about the
 *      tombstone (a delete does not bump `updatedAt`, so the row loses LWW on
 *      the server), and the next pull merges it back over the local row,
 *      clearing `deletedAt`. The resurrected books come back coverless because
 *      the delete cleared `coverDownloadedAt` and there is no cloud cover to
 *      refetch.
 *
 * Demo books are never the user's content: they must stay out of the push, and
 * a cloud row must never write back over one.
 */

const DEMO_URL = 'https://cdn.readest.com/books/the-great-gatsby.epub';

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
  getCloudSyncProvider: () => 'readest',
}));

vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runActiveFileLibrarySync: vi.fn(async () => ({ booksSynced: 0 })),
}));

vi.mock('@/services/sync/fleetDetection', () => ({
  checkMixedFleetOnce: vi.fn(),
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

describe('demo books and the cloud book channel (issue #5049)', () => {
  it('never pushes a demo book to the cloud', async () => {
    useLibraryStore
      .getState()
      .setLibrary([
        makeBook({ hash: 'demo-1', url: DEMO_URL, title: 'The Great Gatsby' }),
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

  it('keeps a deleted demo book deleted when a stale cloud row is pulled back', async () => {
    // Local: the user deleted the demo book. Cloud: the row this device pushed
    // before the delete — same updatedAt, no tombstone. The user's own book
    // rides along in the same pull, so the merge really runs.
    useLibraryStore.getState().setLibrary([
      makeBook({
        hash: 'demo-1',
        url: DEMO_URL,
        title: 'The Great Gatsby',
        deletedAt: 2000,
        downloadedAt: null,
        coverDownloadedAt: null,
      }),
      makeBook({ hash: 'mine-1', title: 'My Own Book', uploadedAt: 1000 }),
    ]);
    syncState.syncedBooks = [
      makeBook({
        hash: 'demo-1',
        title: 'The Great Gatsby',
        deletedAt: null,
        uploadedAt: null,
        coverHash: 'cover-hash',
        coverUpdatedAt: 1000,
      }),
      makeBook({ hash: 'mine-1', title: 'My Own Book', uploadedAt: 1000, updatedAt: 3000 }),
    ];

    renderHook(() => useBooksSync());

    await waitFor(() => expect(appService.saveLibraryBooks).toHaveBeenCalled());

    const library = useLibraryStore.getState().library;
    expect(library.find((book) => book.hash === 'demo-1')?.deletedAt).toBe(2000);
    // The demo book's cover was never uploaded: refetching it would only wipe
    // the local one, which is what left the resurrected books coverless.
    const coverRefreshed = appService.downloadBookCovers.mock.calls.flatMap(
      (call) => (call as unknown as [Book[]])[0],
    );
    expect(coverRefreshed.map((book) => book.hash)).not.toContain('demo-1');
    // The user's own book still merges as before.
    expect(library.find((book) => book.hash === 'mine-1')?.updatedAt).toBe(3000);
  });
});
