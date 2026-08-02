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
import { isFeedBook } from '@/services/rss/feedBookUrl';
import { ensureFeedBookCover } from '@/services/rss/feedBook';
import { runFileLibrarySyncPass } from '@/services/sync/file/runLibrarySync';
import { checkMixedFleetOnce } from '@/services/sync/fleetDetection';
import { useSyncContext } from '@/context/SyncContext';
import {
  pickFresherReadingStatus,
  needsCoverRefresh,
  pickFresherCover,
  pickFresherMetadata,
} from '@/app/library/utils/libraryUtils';
import { getPrimaryLanguage } from '@/utils/book';

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
      // `altFilePaths` (the other on-disk names that resolve to the same book)
      // is device-local for exactly the same reason.
      .map(({ filePath: _filePath, altFilePaths: _altFilePaths, ...rest }): Book => rest);
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
      const runFilePass = backends.length > 0;
      const runNativePull = readest && !!user;

      if (!runFilePass && !runNativePull) return;
      if (isPullingRef.current) return;

      isPullingRef.current = true;
      try {
        // Both legs run to completion (under the same isPullingRef guard)
        // before anything is reported: a `verbose` pull emits exactly ONE
        // toast for the combined outcome, never one per provider. Reporting
        // from the file leg alone would fire before the native pull even
        // started, and would show its outcome only — a file-pass failure
        // masking a native pull that then succeeds, or a book count that
        // ignores what the native pull actually synced.
        let fileSynced = 0;
        let fileSucceeded = false;
        if (runFilePass) {
          const result = await runFileLibrarySyncPass(envConfig, _);
          fileSucceeded = result !== null;
          fileSynced = result?.booksSynced ?? 0;
        }

        let nativeSynced = 0;
        if (runNativePull) {
          const library = useLibraryStore.getState().library;
          const since = (libraryLoaded && library.length === 0) || fullRefresh ? 0 : undefined;
          nativeSynced = (await syncBooks([], 'pull', since)) ?? 0;
        }

        if (verbose) {
          // The native pull swallows its own errors (returns a count, never
          // throws), so it never contributes a "failed" leg here — matching
          // its pre-existing standalone behaviour. Only report failure when
          // every leg that ran actually failed.
          const succeeded = (runFilePass && fileSucceeded) || runNativePull;
          eventDispatcher.dispatch('toast', {
            type: succeeded ? 'info' : 'error',
            message: succeeded
              ? _('{{count}} book(s) synced', { count: fileSynced + nativeSynced })
              : _('Sync failed'),
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
        // The metadata group merges on its own metadataUpdatedAt clock so a
        // metadata edit survives losing whole-row LWW to page-turn progress
        // (issue #5438). Null means neither side is fresher — the row-level
        // winner already in mergedBook stands.
        const meta = pickFresherMetadata(oldBook, matchingBook);
        if (meta) {
          mergedBook.title = meta.title;
          mergedBook.author = meta.author;
          mergedBook.tags = meta.tags;
          mergedBook.metadata = meta.metadata;
          mergedBook.metadataUpdatedAt = meta.metadataUpdatedAt;
          // TTS reads primaryLanguage (not metadata.language); recompute it the
          // same way the editing device did so the edit is effective here too.
          if (meta.metadata) {
            mergedBook.primaryLanguage = getPrimaryLanguage(meta.metadata.language);
          }
        }
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
    // `uploadedAt` gates adoption so a peer never shelves a book whose file it
    // cannot fetch. A feed book has no file to fetch — it is rebuilt from
    // `metadata.feedUrl` — so it would never pass that gate and the
    // subscription stayed stuck on the device that added it (issue #5307).
    const newBooks = cloudBooks.filter(
      (newBook) =>
        !bookHashesInLibrary.has(newBook.hash) &&
        (newBook.uploadedAt || isFeedBook(newBook)) &&
        !newBook.deletedAt,
    );

    const processNewBook = async (newBook: Book) => {
      // A feed book has no cover in cloud storage; its cover is derived from the
      // feed descriptor, so this device regenerates the same image locally.
      newBook.coverImageUrl =
        appService && isFeedBook(newBook)
          ? await ensureFeedBookCover(appService, newBook)
          : await appService?.generateCoverImageUrl(newBook);
      // primaryLanguage is not a cloud column; without this the reader later
      // guesses it from the parsed document, ignoring a language the user set
      // in the synced metadata — TTS reads primaryLanguage (issue #5438).
      if (newBook.metadata?.language) {
        newBook.primaryLanguage = getPrimaryLanguage(newBook.metadata.language);
      }
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
