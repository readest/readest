import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Issue #5307 — "RSS feeds are only showing in the original web browser where
 * they were added".
 *
 * A feed subscription is a fileless Book row: `url` is a `feed://` descriptor
 * and the content is rebuilt from `metadata.feedUrl` on whatever device opens
 * it. There is no blob to put in cloud storage, so `uploadedAt` stays null
 * forever. The row's metadata does reach the cloud, but the peer's
 * `updateLibrary` only adopts a cloud row once it is `uploadedAt` — a guard
 * that exists so peers never shelve a book whose file they cannot fetch.
 * A feed book needs no file, so that guard must not apply to it.
 */

const appService = vi.hoisted(() => ({
  saveLibraryBooks: vi.fn(async () => {}),
  generateCoverImageUrl: vi.fn(async () => 'blob:cover'),
  downloadBookCovers: vi.fn(async () => {}),
}));

// Rasterizing the generated SVG needs a real canvas, so the cover writer itself
// is covered by its own unit test; here we only assert the routing.
const ensureFeedBookCover = vi.hoisted(() =>
  vi.fn(async (_appService: unknown, _book: Book) => 'blob:feed-cover'),
);

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

vi.mock('@/services/sync/fleetDetection', () => ({
  checkMixedFleetOnce: vi.fn(),
}));

vi.mock('@/services/rss/feedBook', () => ({ ensureFeedBookCover }));

const { useBooksSync } = await import('@/app/library/hooks/useBooksSync');
const { useLibraryStore } = await import('@/store/libraryStore');
const { buildFeedBookUrl } = await import('@/services/rss/feedBookUrl');

const FEED_URL = 'https://www.saastr.com/feed/';

const makeBook = (over: Partial<Book> & Pick<Book, 'hash'>): Book => ({
  format: 'EPUB',
  title: 'Title',
  author: 'Author',
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

const makeFeedBook = (over: Partial<Book> = {}): Book =>
  makeBook({
    hash: 'feed-1',
    title: 'SaaStr',
    url: buildFeedBookUrl(FEED_URL),
    metadata: { title: 'SaaStr', author: '', language: '', feedUrl: FEED_URL },
    uploadedAt: null,
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  syncState.syncedBooks = null;
  useLibraryStore.setState({ library: [], libraryLoaded: false, isSyncing: false });
});

describe('feed books and the cloud book channel (issue #5307)', () => {
  it('shelves a synced feed book even though it has no uploadedAt', async () => {
    useLibraryStore.getState().setLibrary([]);
    useLibraryStore.setState({ libraryLoaded: true });
    syncState.syncedBooks = [makeFeedBook()];

    renderHook(() => useBooksSync());

    await waitFor(() => {
      const hashes = useLibraryStore.getState().library.map((book) => book.hash);
      expect(hashes).toContain('feed-1');
    });
  });

  it('regenerates the feed cover locally instead of expecting one in the cloud', async () => {
    // The origin device's cover.png was never uploaded — a feed book has no
    // cloud files at all — so the peer rebuilds it from the feed descriptor.
    useLibraryStore.getState().setLibrary([]);
    useLibraryStore.setState({ libraryLoaded: true });
    syncState.syncedBooks = [makeFeedBook()];

    renderHook(() => useBooksSync());

    await waitFor(() => expect(ensureFeedBookCover).toHaveBeenCalled());
    expect(ensureFeedBookCover.mock.calls[0]?.[1]?.hash).toBe('feed-1');
    expect(useLibraryStore.getState().library[0]?.coverImageUrl).toBe('blob:feed-cover');
  });

  it('leaves ordinary books on the cloud cover path', async () => {
    useLibraryStore.getState().setLibrary([]);
    useLibraryStore.setState({ libraryLoaded: true });
    syncState.syncedBooks = [makeBook({ hash: 'plain-1', uploadedAt: 2000 })];

    renderHook(() => useBooksSync());

    await waitFor(() => expect(appService.generateCoverImageUrl).toHaveBeenCalled());
    expect(ensureFeedBookCover).not.toHaveBeenCalled();
  });

  it('still skips an ordinary cloud row whose file was never uploaded', async () => {
    useLibraryStore.getState().setLibrary([]);
    useLibraryStore.setState({ libraryLoaded: true });
    syncState.syncedBooks = [makeBook({ hash: 'plain-1', uploadedAt: null })];

    renderHook(() => useBooksSync());

    await waitFor(() => expect(appService.saveLibraryBooks).toHaveBeenCalled());
    expect(useLibraryStore.getState().library.map((book) => book.hash)).toEqual([]);
  });

  it('pushes the feed book to the cloud so peers can see it at all', async () => {
    useLibraryStore.getState().setLibrary([makeFeedBook()]);
    useLibraryStore.setState({ libraryLoaded: true });

    const { result } = renderHook(() => useBooksSync());
    await result.current.pushLibrary();

    const pushed = new Set(
      syncState.syncBooks.mock.calls
        .flatMap((call) => (call[0] ?? []) as Book[])
        .map((book) => book.hash),
    );
    expect(pushed.has('feed-1')).toBe(true);
  });
});
