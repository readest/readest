import { useCallback, useEffect, useRef } from 'react';
import { Book } from '@/types/book';
import { useSync } from '@/hooks/useSync';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/hooks/useTranslation';
import { SYNC_BOOKS_INTERVAL_SEC } from '@/services/constants';
import { throttle } from '@/utils/throttle';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { useSettingsStore } from '@/store/settingsStore';
import {
  isReadestCloudEnabled,
  getActiveFileSyncBackends,
} from '@/services/sync/cloudSyncProvider';
import { isDemoBook } from '@/services/demoBooks';
import { runActiveFileLibrarySync } from '@/services/sync/file/runLibrarySync';
import { checkMixedFleetOnce } from '@/services/sync/fleetDetection';
import { useSyncContext } from '@/context/SyncContext';
import {
  pickFresherReadingStatus,
  needsCoverRefresh,
  pickFresherCover,
} from '@/app/library/utils/libraryUtils';

export const useBooksSync = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  const { envConfig, appService } = useEnv();
  const { library, isSyncing, libraryLoaded } = useLibraryStore();
  const { setLibrary, setIsSyncing, setSyncProgress } = useLibraryStore();
  const { useSyncInited, syncedBooks, syncBooks, lastSyncedAtBooks } = useSync();
  const { syncClient } = useSyncContext();
  const isPullingRef = useRef(false);

  const getNewBooks = useCallback(() => {
    if (!user) return {};
    const library = useLibraryStore.getState().library;
    const newBooks = library
      // Demo books are the sample shelf we hand anonymous web visitors, not the
      // user's content — they never go to the cloud (issue #5049).
      .filter((book) => !isDemoBook(book))
      .filter(
        (book) =>
          !book.syncedAt ||
          lastSyncedAtBooks < book.updatedAt ||
          lastSyncedAtBooks < (book.deletedAt ?? 0),
      )
      // book.filePath is a device-local absolute path used by the in-place
      // import flow to point at a file outside Books/<hash>/. It is
      // meaningless on any other device, so strip it before pushing to the
      // cloud — peers always rehydrate via the hash-keyed copy that
      // cloudService.downloadBook lands under Books/<hash>/. Keeping the
      // source device's path in the cloud record would be dead data at
      // best, and would become an active footgun if isBookAvailable ever
      // got its branch order swapped (it currently checks Books/<hash>
      // before falling back to filePath; flipping that order would make
      // peers chase a non-existent path instead of downloading).
      .map(({ filePath: _filePath, ...rest }): Book => rest);
    return {
      books: newBooks,
      lastSyncedAt: lastSyncedAtBooks,
    };
  }, [user, lastSyncedAtBooks]);

  const pullLibrary = useCallback(
    async (fullRefresh = false, verbose = false) => {
      // Providers are independently selectable (#5062): an enabled file
      // backend and Readest Cloud both run their own pass here, every
      // library-refresh surface — pull to refresh, the SettingsMenu sync
      // row, BackupWindow — routes through here. The file pass works
      // logged out (file sync has no Readest account dependency); the
      // native pull below still requires `user`.
      const settingsNow = useSettingsStore.getState().settings;
      const backends = getActiveFileSyncBackends(settingsNow);
      const readest = isReadestCloudEnabled(settingsNow);

      if (backends.length > 0) {
        if (isPullingRef.current) return;
        try {
          isPullingRef.current = true;
          // Task 7 renames this to `runFileLibrarySyncPass` and makes it loop
          // every backend; keep the current name here so this task compiles.
          const result = await runActiveFileLibrarySync(envConfig, _);
          if (verbose) {
            // Same message as the native Readest Cloud sync below, so every
            // provider reports its work the same way.
            eventDispatcher.dispatch('toast', {
              type: result ? 'info' : 'error',
              message: result
                ? _('{{count}} book(s) synced', { count: result.booksSynced })
                : _('Sync failed'),
            });
          }
        } finally {
          isPullingRef.current = false;
        }
        // Readest Cloud, when also enabled, still runs its native pull below.
        if (!readest) return;
      }
      if (!readest || !user) return;
      if (isPullingRef.current) return;
      try {
        isPullingRef.current = true;
        const library = useLibraryStore.getState().library;
        const since = (libraryLoaded && library.length === 0) || fullRefresh ? 0 : undefined;
        const syncedBooksCount = await syncBooks([], 'pull', since);
        // Only toast here when the file pass above didn't already report —
        // otherwise a dual-provider pull would double-toast.
        if (verbose && backends.length === 0) {
          eventDispatcher.dispatch('toast', {
            type: 'info',
            message: _('{{count}} book(s) synced', { count: syncedBooksCount }),
          });
        }
      } finally {
        isPullingRef.current = false;
      }
    },
    [_, user, libraryLoaded, syncBooks, envConfig],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAutoSync = useCallback(
    throttle(
      async () => {
        if (isPullingRef.current) return;
        // Readest Cloud unchecked: the native book channel is gated, so the
        // interval runs the read-only mixed-fleet probe instead — a device
        // still writing natively would otherwise fork progress silently
        // (the auto library sync itself is useLibraryFileSync's).
        const settingsNow = useSettingsStore.getState().settings;
        if (!isReadestCloudEnabled(settingsNow)) {
          void checkMixedFleetOnce(syncClient, settingsNow, _);
          return;
        }
        const newBooks = getNewBooks();
        if (!newBooks.lastSyncedAt) return;
        isPullingRef.current = true;
        try {
          await syncBooks(newBooks.books, 'both');
        } finally {
          isPullingRef.current = false;
        }
      },
      SYNC_BOOKS_INTERVAL_SEC * 1000,
      { emitLast: true },
    ),
    [syncBooks],
  );

  useEffect(() => {
    if (!user) return;
    if (isPullingRef.current) return;
    handleAutoSync();
  }, [user, library, handleAutoSync]);

  const pushLibrary = useCallback(async () => {
    if (!user) return;
    const newBooks = getNewBooks();
    if (newBooks.lastSyncedAt) {
      await syncBooks(newBooks?.books, 'push');
    }
  }, [user, syncBooks, getNewBooks]);

  useEffect(() => {
    if (!user || !useSyncInited || !libraryLoaded) return;
    pullLibrary();
  }, [user, useSyncInited, libraryLoaded, pullLibrary]);

  const updateLibrary = useCallback(async () => {
    if (!syncedBooks?.length) return;

    // A cloud row for a demo book can only be a stale one pushed before #5049.
    // Merging it back would write over the local demo row — and, because a
    // delete doesn't bump `updatedAt`, the not-deleted cloud row wins the LWW
    // tie and clears `deletedAt`, resurrecting a book the user just deleted
    // (coverless, since its cover was never uploaded either).
    const demoHashes = new Set(
      useLibraryStore
        .getState()
        .library.filter(isDemoBook)
        .map((book) => book.hash),
    );
    const cloudBooks = syncedBooks.filter((book) => !demoHashes.has(book.hash));
    if (!cloudBooks.length) return;

    // Process old books first so that when we update the library the order is preserved
    cloudBooks.sort((a, b) => a.updatedAt - b.updatedAt);
    const bookHashesInSynced = new Set(cloudBooks.map((book) => book.hash));
    const syncedByHash = new Map(cloudBooks.map((book) => [book.hash, book]));
    const liveLibrary = useLibraryStore.getState().library;
    const oldBooks = liveLibrary.filter((book) => bookHashesInSynced.has(book.hash));
    // Books whose cover must be (re)fetched: never-downloaded, or a newer cover
    // edit arrived from another device (issue #4544). Captured before the
    // download loop so the post-download merge can still tell which covers were
    // refreshed (the loop mutates coverDownloadedAt).
    const oldBooksNeedsDownload = oldBooks.filter((book) => {
      const matchingBook = syncedByHash.get(book.hash);
      return !!matchingBook && needsCoverRefresh(book, matchingBook);
    });
    const coverRefreshHashes = new Set(oldBooksNeedsDownload.map((book) => book.hash));

    const processOldBook = async (oldBook: Book) => {
      const matchingBook = syncedByHash.get(oldBook.hash);
      if (matchingBook) {
        if (coverRefreshHashes.has(oldBook.hash)) {
          oldBook.coverImageUrl = await appService?.generateCoverImageUrl(oldBook);
        }
        const mergedBook =
          matchingBook.updatedAt >= oldBook.updatedAt
            ? { ...oldBook, ...matchingBook, syncedAt: Date.now() }
            : { ...matchingBook, ...oldBook, syncedAt: Date.now() };
        // Status is resolved by its own timestamp, independent of the row's
        // updatedAt (which page-turn progress dominates) — see #4634.
        const status = pickFresherReadingStatus(oldBook, matchingBook);
        mergedBook.readingStatus = status.readingStatus;
        mergedBook.readingStatusUpdatedAt = status.readingStatusUpdatedAt;
        // Cover is likewise resolved by its own coverUpdatedAt, independent of
        // the row's updatedAt — issue #4544.
        const cover = pickFresherCover(oldBook, matchingBook);
        mergedBook.coverHash = cover.coverHash;
        mergedBook.coverUpdatedAt = cover.coverUpdatedAt;
        return mergedBook;
      }
      return oldBook;
    };

    const oldBooksBatchSize = 100;
    for (let i = 0; i < oldBooksNeedsDownload.length; i += oldBooksBatchSize) {
      const batch = oldBooksNeedsDownload.slice(i, i + oldBooksBatchSize);
      await appService?.downloadBookCovers(batch);
    }

    const updatedLibrary = await Promise.all(liveLibrary.map(processOldBook));
    setLibrary(updatedLibrary);
    appService?.saveLibraryBooks(updatedLibrary);

    const bookHashesInLibrary = new Set(updatedLibrary.map((book) => book.hash));
    const newBooks = cloudBooks.filter(
      (newBook) =>
        !bookHashesInLibrary.has(newBook.hash) && newBook.uploadedAt && !newBook.deletedAt,
    );

    const processNewBook = async (newBook: Book) => {
      newBook.coverImageUrl = await appService?.generateCoverImageUrl(newBook);
      newBook.syncedAt = Date.now();
      updatedLibrary.push(newBook);
    };

    if (newBooks.length > 0) {
      setIsSyncing(true);
    }
    try {
      const batchSize = 10;
      for (let i = 0; i < newBooks.length; i += batchSize) {
        const batch = newBooks.slice(i, i + batchSize);
        await appService?.downloadBookCovers(batch);
        await Promise.all(batch.map(processNewBook));
        const progress = Math.min((i + batchSize) / newBooks.length, 1);
        setSyncProgress(progress);
        setLibrary([...updatedLibrary]);
        appService?.saveLibraryBooks(updatedLibrary);
      }
    } catch (err) {
      console.error('Error updating new books:', err);
    } finally {
      if (newBooks.length > 0) {
        setIsSyncing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedBooks]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedUpdateLibrary = useCallback(
    debounce(() => updateLibrary(), 10000),
    [updateLibrary],
  );

  useEffect(() => {
    // Defer processing synced books until the library has been loaded from
    // disk. Otherwise updateLibrary runs against an empty `library`
    // closure, treats every synced book as new, and the resulting
    // `setLibrary([only sync books])` can race with initLibrary's
    // `setLibrary([disk books])` — the empty-merged save can land on disk
    // afterwards and overwrite the loaded snapshot. The synced books stay
    // queued in `syncedBooks` state; this effect re-fires when
    // libraryLoaded flips to true and processes them then.
    if (!libraryLoaded) return;
    if (isSyncing) {
      debouncedUpdateLibrary();
    } else {
      updateLibrary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedBooks, updateLibrary, debouncedUpdateLibrary, libraryLoaded]);

  return { pullLibrary, pushLibrary };
};
