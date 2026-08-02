import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Issue #5438 — metadata edited on one device never reaches the others.
 *
 * The books row's updatedAt is dominated by page-turn progress, so a device
 * that read the book after the edit holds a newer row and whole-row LWW keeps
 * its stale metadata forever. The metadata group (title, author, tags,
 * metadata) must merge on its own metadataUpdatedAt clock — the same
 * field-level LWW that already protects readingStatus (#4634) and the cover
 * (#4544). RSS feed books are read daily on every device, which made this
 * near-deterministic for them.
 */

const appService = vi.hoisted(() => ({
  saveLibraryBooks: vi.fn(async () => {}),
  generateCoverImageUrl: vi.fn(async () => 'blob:cover'),
  downloadBookCovers: vi.fn(async () => {}),
}));

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

const FEED_URL = 'https://8sidor.se/feed/';

const makeFeedBook = (over: Partial<Book> = {}): Book => ({
  hash: 'feed-1',
  format: 'EPUB',
  title: '8 Sidor',
  author: '',
  url: buildFeedBookUrl(FEED_URL),
  metadata: { title: '8 Sidor', author: '', language: '', feedUrl: FEED_URL },
  uploadedAt: null,
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  syncState.syncedBooks = null;
  useLibraryStore.setState({ library: [], libraryLoaded: false, isSyncing: false });
});

describe('metadata edits merge on their own clock (issue #5438)', () => {
  it('adopts a fresher synced metadata edit even when the local row is newer', async () => {
    // This device read the feed after the edit (page turns bump updatedAt),
    // so it wins whole-row LWW — but the cloud row carries a fresher
    // metadataUpdatedAt from the editing device.
    useLibraryStore.getState().setLibrary([makeFeedBook({ updatedAt: 5000 })]);
    useLibraryStore.setState({ libraryLoaded: true });
    syncState.syncedBooks = [
      makeFeedBook({
        title: '8 Sidor (SV)',
        updatedAt: 3000,
        metadataUpdatedAt: 4000,
        metadata: { title: '8 Sidor (SV)', author: '', language: 'sv', feedUrl: FEED_URL },
      }),
    ];

    renderHook(() => useBooksSync());

    await waitFor(() => {
      const merged = useLibraryStore.getState().library.find((b) => b.hash === 'feed-1');
      expect(merged?.title).toBe('8 Sidor (SV)');
      expect(merged?.metadata?.language).toBe('sv');
      expect(merged?.metadataUpdatedAt).toBe(4000);
      // TTS reads primaryLanguage; it must follow the adopted metadata.
      expect(merged?.primaryLanguage).toBe('sv');
    });
  });

  it('keeps a fresher local metadata edit when the synced row is newer', async () => {
    // Reverse race: this device just edited; a peer's page turn won the row.
    useLibraryStore.getState().setLibrary([
      makeFeedBook({
        title: 'Edited here',
        updatedAt: 4000,
        metadataUpdatedAt: 4000,
        metadata: { title: 'Edited here', author: '', language: 'sv', feedUrl: FEED_URL },
      }),
    ]);
    useLibraryStore.setState({ libraryLoaded: true });
    syncState.syncedBooks = [makeFeedBook({ updatedAt: 5000 })];

    renderHook(() => useBooksSync());

    await waitFor(() => {
      const merged = useLibraryStore.getState().library.find((b) => b.hash === 'feed-1');
      expect(merged?.updatedAt).toBe(5000);
      expect(merged?.title).toBe('Edited here');
      expect(merged?.metadata?.language).toBe('sv');
      expect(merged?.metadataUpdatedAt).toBe(4000);
    });
  });

  it('computes primaryLanguage from synced metadata when adopting a new book', async () => {
    // A device adopting the book fresh (e.g. Android after the #5307 fix
    // ships) has no local primaryLanguage; TTS must speak the language the
    // user set, not the reader's later guess from the parsed document.
    useLibraryStore.getState().setLibrary([]);
    useLibraryStore.setState({ libraryLoaded: true });
    syncState.syncedBooks = [
      makeFeedBook({
        metadataUpdatedAt: 4000,
        metadata: { title: '8 Sidor', author: '', language: 'sv', feedUrl: FEED_URL },
      }),
    ];

    renderHook(() => useBooksSync());

    await waitFor(() => {
      const adopted = useLibraryStore.getState().library.find((b) => b.hash === 'feed-1');
      expect(adopted?.primaryLanguage).toBe('sv');
    });
  });
});
