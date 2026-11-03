import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * A library change that lands while an auto-sync is already in flight must
 * still reach the cloud once that sync finishes.
 *
 * The real-world shape: importing a book kicks off a push+pull chain that
 * runs for several seconds, and the book's upload completes inside that
 * window. The upload stamps `uploadedAt`, which is the field peers gate
 * adoption on (`updateLibrary` only shelves cloud books with `uploadedAt`).
 * If the change is dropped because a sync was in flight, the cloud row keeps
 * `uploaded_at = null` and the book never appears on other devices until an
 * unrelated library change (opening the book, relaunching) re-pushes it.
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
  // Truthy so the auto-sync 'both' branch runs (it returns early on a 0 cursor).
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
  runFileLibrarySyncPass: vi.fn(async () => null),
}));

// A zero throttle interval makes every auto-sync call a leading edge, so the
// test exercises the in-flight guard rather than the throttle's trailing timer.
vi.mock('@/services/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/constants')>()),
  SYNC_BOOKS_INTERVAL_SEC: 0,
}));

const { useBooksSync } = await import('@/app/library/hooks/useBooksSync');
const { useLibraryStore } = await import('@/store/libraryStore');

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
};

const makeBook = (overrides: Partial<Book> = {}): Book =>
  ({
    hash: 'abc123',
    format: 'EPUB',
    title: 'Book',
    author: 'Author',
    createdAt: 2000,
    updatedAt: 2000,
    uploadedAt: null,
    deletedAt: null,
    ...overrides,
  }) as Book;

beforeEach(() => {
  vi.clearAllMocks();
  syncState.syncedBooks = null;
  useLibraryStore.setState({ library: [], libraryLoaded: true, isSyncing: false });
});

afterEach(() => {
  cleanup();
});

describe('useBooksSync auto-sync with an in-flight sync', () => {
  it('re-pushes a book whose uploadedAt landed while a sync was in flight', async () => {
    // Every 'both' sync stays in flight until the test resolves it; pulls
    // resolve immediately.
    const inFlight: Array<(n: number) => void> = [];
    syncState.syncBooks.mockImplementation((_books, op) =>
      op === 'both' ? new Promise<number>((resolve) => inFlight.push(resolve)) : Promise.resolve(0),
    );

    renderHook(() => useBooksSync());
    await flush();
    // Settle the mount-time sync so the import below starts from idle.
    while (inFlight.length) inFlight.shift()!(0);
    await flush();
    syncState.syncBooks.mockClear();

    // Import: the new book (no syncedAt yet) is pushed, and that sync now
    // stays in flight.
    const imported = makeBook();
    act(() => useLibraryStore.getState().setLibrary([imported]));
    await flush();
    expect(inFlight).toHaveLength(1);
    const firstPush = syncState.syncBooks.mock.calls[0]!;
    expect(firstPush[1]).toBe('both');
    expect(firstPush[0]?.map((b) => b.hash)).toEqual(['abc123']);

    // The upload finishes while that sync is still running: uploadedAt is
    // stamped and the library is replaced (transferManager -> updateBook).
    act(() =>
      useLibraryStore.getState().setLibrary([makeBook({ uploadedAt: 3000, updatedAt: 3000 })]),
    );
    await flush();

    // The in-flight sync completes.
    inFlight.shift()!(0);
    await flush();

    // A follow-up sync must carry the uploaded book to the cloud.
    const followUp = syncState.syncBooks.mock.calls
      .slice(1)
      .find((call) => call[0]?.some((b) => b.hash === 'abc123' && !!b.uploadedAt));
    expect(followUp).toBeDefined();
  });
});
