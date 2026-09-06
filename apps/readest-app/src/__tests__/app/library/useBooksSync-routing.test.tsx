import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Issue #5062 — cloud sync providers are independently selectable, so a user
 * can mirror the library to Readest Cloud AND a file backend (WebDAV, Google
 * Drive, S3, OneDrive) at once. `pullLibrary` in useBooksSync.ts therefore has
 * four routing paths depending on which of {Readest Cloud, a file backend}
 * are enabled:
 *
 *   - both enabled:        the file pass runs, THEN the native pull also runs
 *   - file backend only:   the file pass runs, the native pull does not
 *   - Readest Cloud only:  the native pull runs, the file pass does not
 *   - neither (not covered here; nothing runs)
 *
 * `isReadestCloudEnabled` and `getActiveFileSyncBackends` are settable per
 * test (unlike demo-books-sync.test.tsx, which hardcodes them to the one
 * scenario where none of these branches can be observed) so every path, plus
 * the verbose-toast-fires-once invariant and the handleAutoSync mixed-fleet
 * probe gate, can actually be exercised.
 */

const appService = vi.hoisted(() => ({
  saveLibraryBooks: vi.fn(async () => {}),
  generateCoverImageUrl: vi.fn(async () => 'blob:cover'),
  downloadBookCovers: vi.fn(async (_books: Book[]) => {}),
}));

const syncState = vi.hoisted(() => ({
  useSyncInited: true,
  syncedBooks: null as Book[] | null,
  syncBooks: vi.fn(async (_books?: Book[], _op?: string, _since?: number) => 0),
  // Kept falsy so the auto-sync effect's 'both' branch (which is not what
  // these tests are about) never fires and never contends with pullLibrary
  // over the shared isPullingRef guard. See the module doc comment above.
  lastSyncedAtBooks: 0,
}));

// Per-test-settable routing inputs, read by the mocked cloudSyncProvider
// functions below instead of being hardcoded to one scenario.
const routing = vi.hoisted(() => ({
  readestEnabled: true,
  backends: [] as ('webdav' | 'gdrive' | 's3' | 'onedrive')[],
}));

const runFileLibrarySyncPass = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ booksSynced: number; indexPushFailed?: boolean } | null> => ({
      booksSynced: 1,
    }),
  ),
);

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
  useTranslation:
    () =>
    (text: string, params?: Record<string, string | number>): string => {
      if (!params) return text;
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
        text,
      );
    },
}));

vi.mock('@/hooks/useSync', () => ({
  useSync: () => syncState,
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  isReadestCloudEnabled: () => routing.readestEnabled,
  getActiveFileSyncBackends: () => routing.backends,
}));

vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runFileLibrarySyncPass,
}));

const { useBooksSync } = await import('@/app/library/hooks/useBooksSync');
const { useLibraryStore } = await import('@/store/libraryStore');
const { eventDispatcher } = await import('@/utils/event');

beforeEach(() => {
  vi.clearAllMocks();
  appService.downloadBookCovers.mockReset().mockResolvedValue(undefined);
  syncState.syncedBooks = null;
  syncState.lastSyncedAtBooks = 0;
  routing.readestEnabled = true;
  routing.backends = [];
  useLibraryStore.setState({ library: [], libraryLoaded: true, isSyncing: false });
});

describe('useBooksSync cover download failures', () => {
  const makeBook = (overrides: Partial<Book> = {}): Book =>
    ({
      hash: 'book-1',
      title: 'Book',
      author: 'Author',
      format: 'EPUB',
      createdAt: 100,
      updatedAt: 100,
      uploadedAt: 100,
      ...overrides,
    }) as Book;

  it('merges metadata despite a failed cover refresh and retries the cover on the next sync', async () => {
    useLibraryStore.setState({
      library: [
        makeBook({
          coverHash: 'old-cover',
          coverUpdatedAt: 100,
          coverDownloadedAt: 100,
        }),
      ],
    });
    const cloudBook = makeBook({
      title: 'Updated title',
      updatedAt: 200,
      coverHash: 'new-cover',
      coverUpdatedAt: 200,
    });
    syncState.syncedBooks = [cloudBook];
    appService.downloadBookCovers.mockRejectedValueOnce(new Error('Cover URLs unavailable'));
    const { rerender } = renderHook(() => useBooksSync());

    await waitFor(() => expect(useLibraryStore.getState().library[0]?.title).toBe('Updated title'));
    expect(useLibraryStore.getState().library[0]?.coverDownloadedAt).toBeFalsy();
    expect(appService.saveLibraryBooks).toHaveBeenCalled();

    appService.downloadBookCovers.mockImplementationOnce(async (books) => {
      for (const book of books) book.coverDownloadedAt = 300;
    });
    syncState.syncedBooks = [{ ...cloudBook }];
    rerender();
    await waitFor(() => expect(useLibraryStore.getState().library[0]?.coverDownloadedAt).toBe(300));
    expect(appService.downloadBookCovers).toHaveBeenCalledTimes(2);
  });

  it('adds new books and continues later batches when a cover batch fails', async () => {
    syncState.syncedBooks = Array.from({ length: 11 }, (_, index) =>
      makeBook({ hash: `book-${index + 1}` }),
    );
    appService.downloadBookCovers.mockRejectedValueOnce(new Error('Cover URLs unavailable'));
    renderHook(() => useBooksSync());

    await waitFor(() => expect(useLibraryStore.getState().library).toHaveLength(11));
    expect(useLibraryStore.getState().library[0]?.hash).toBe('book-1');
    expect(useLibraryStore.getState().library[0]?.coverDownloadedAt).toBeFalsy();
    expect(useLibraryStore.getState().isSyncing).toBe(false);
    expect(appService.saveLibraryBooks).toHaveBeenCalled();
    expect(appService.downloadBookCovers).toHaveBeenCalledTimes(2);
  });
});

afterEach(() => {
  // Without this, a hook instance left mounted from a prior test can
  // re-render (its `pullLibrary` callback is unstable across renders because
  // the mocked useEnv returns a fresh `envConfig` object every time) when a
  // later test mutates the shared zustand stores, re-firing its effects with
  // that later test's routing values and polluting its mock call counts.
  cleanup();
});

describe('useBooksSync pullLibrary routing (issue #5062)', () => {
  it('runs both the file pass and the native pull when both providers are enabled', async () => {
    routing.readestEnabled = true;
    routing.backends = ['gdrive'];

    renderHook(() => useBooksSync());

    // The mount effect calls pullLibrary() once automatically; this is the
    // critical assertion — a check that only the file pass ran would not
    // catch a regression that returns before the native pull ever starts.
    await waitFor(() => expect(runFileLibrarySyncPass).toHaveBeenCalled());
    await waitFor(() => expect(syncState.syncBooks).toHaveBeenCalled());

    const pullCalls = syncState.syncBooks.mock.calls.filter((call) => call[1] === 'pull');
    expect(pullCalls.length).toBeGreaterThan(0);
  });

  it('runs only the file pass when Readest Cloud is off and a file backend is on', async () => {
    routing.readestEnabled = false;
    routing.backends = ['webdav'];

    renderHook(() => useBooksSync());

    await waitFor(() => expect(runFileLibrarySyncPass).toHaveBeenCalled());
    // Give any (incorrect) native call a chance to fire before asserting it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(syncState.syncBooks).not.toHaveBeenCalled();
  });

  it('runs only the native pull when Readest Cloud is on and no file backend is on', async () => {
    routing.readestEnabled = true;
    routing.backends = [];

    renderHook(() => useBooksSync());

    await waitFor(() => expect(syncState.syncBooks).toHaveBeenCalled());
    const pullCalls = syncState.syncBooks.mock.calls.filter((call) => call[1] === 'pull');
    expect(pullCalls.length).toBeGreaterThan(0);
    expect(runFileLibrarySyncPass).not.toHaveBeenCalled();
  });

  it('toasts exactly once for a verbose pull when both providers are enabled', async () => {
    routing.readestEnabled = true;
    routing.backends = ['gdrive'];

    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const { result } = renderHook(() => useBooksSync());

    // Let the mount effect's non-verbose pullLibrary() call settle first so it
    // doesn't contend with the explicit call below over isPullingRef.
    await waitFor(() => expect(runFileLibrarySyncPass).toHaveBeenCalled());
    await waitFor(() => expect(syncState.syncBooks).toHaveBeenCalled());

    dispatchSpy.mockClear();
    runFileLibrarySyncPass.mockClear();
    syncState.syncBooks.mockClear();

    await act(async () => {
      await result.current.pullLibrary(false, true);
    });

    const toastCalls = dispatchSpy.mock.calls.filter(([event]) => event === 'toast');
    expect(toastCalls).toHaveLength(1);
  });

  it('sums the books synced across both legs in the single combined toast', async () => {
    routing.readestEnabled = true;
    routing.backends = ['gdrive'];

    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const { result } = renderHook(() => useBooksSync());

    await waitFor(() => expect(runFileLibrarySyncPass).toHaveBeenCalled());
    await waitFor(() => expect(syncState.syncBooks).toHaveBeenCalled());

    dispatchSpy.mockClear();
    runFileLibrarySyncPass.mockClear();
    syncState.syncBooks.mockClear();
    runFileLibrarySyncPass.mockResolvedValueOnce({ booksSynced: 2 });
    syncState.syncBooks.mockResolvedValueOnce(5);

    await act(async () => {
      await result.current.pullLibrary(false, true);
    });

    const toastCalls = dispatchSpy.mock.calls.filter(([event]) => event === 'toast');
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0]?.[1]).toMatchObject({ type: 'info', message: '7 book(s) synced' });
  });

  it('reports a failure when the file pass could not write the shared index (#5900)', async () => {
    // library.json IS the convergence point: peers read membership, tombstones
    // and the uploaded-file record from it. A run that uploaded books but could
    // not write it converged nothing, and must not toast a book count.
    routing.readestEnabled = false;
    routing.backends = ['gdrive'];

    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const { result } = renderHook(() => useBooksSync());

    await waitFor(() => expect(runFileLibrarySyncPass).toHaveBeenCalled());

    dispatchSpy.mockClear();
    runFileLibrarySyncPass.mockClear();
    runFileLibrarySyncPass.mockResolvedValueOnce({ booksSynced: 4, indexPushFailed: true });

    await act(async () => {
      await result.current.pullLibrary(false, true);
    });

    const toastCalls = dispatchSpy.mock.calls.filter(([event]) => event === 'toast');
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0]?.[1]).toMatchObject({ type: 'error', message: 'Sync failed' });
  });

  it('still reports a combined success when the file pass fails but the native pull succeeds', async () => {
    routing.readestEnabled = true;
    routing.backends = ['gdrive'];

    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const { result } = renderHook(() => useBooksSync());

    await waitFor(() => expect(runFileLibrarySyncPass).toHaveBeenCalled());
    await waitFor(() => expect(syncState.syncBooks).toHaveBeenCalled());

    dispatchSpy.mockClear();
    runFileLibrarySyncPass.mockClear();
    syncState.syncBooks.mockClear();
    // An expired Drive token throws inside the pass; the pass itself catches
    // it per-backend and returns null when every backend it ran failed.
    runFileLibrarySyncPass.mockResolvedValueOnce(null);
    syncState.syncBooks.mockResolvedValueOnce(4);

    await act(async () => {
      await result.current.pullLibrary(false, true);
    });

    const toastCalls = dispatchSpy.mock.calls.filter(([event]) => event === 'toast');
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0]?.[1]).toMatchObject({ type: 'info', message: '4 book(s) synced' });
  });
});
