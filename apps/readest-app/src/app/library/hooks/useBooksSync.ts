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

export const useBooksSync = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  const { appService } = useEnv();
  const { library, isSyncing, libraryLoaded } = useLibraryStore();
  const { setLibrary, setIsSyncing, setSyncProgress } = useLibraryStore();
  const { useSyncInited, syncedBooks, syncBooks, lastSyncedAtBooks } = useSync();
  const isPullingRef = useRef(false);

  const getNewBooks = useCallback(() => {
    if (!user) return {};
    const library = useLibraryStore.getState().library;
    const newBooks = library.filter(
      (book) =>
        !book.syncedAt ||
        lastSyncedAtBooks < book.updatedAt ||
        lastSyncedAtBooks < (book.deletedAt ?? 0),
    );
    return {
      books: newBooks,
      lastSyncedAt: lastSyncedAtBooks,
    };
  }, [user, lastSyncedAtBooks]);

  const pullLibrary = useCallback(
    async (fullRefresh = false, verbose = false) => {
      if (!user) return;
      if (isPullingRef.current) {
        console.log('Pull already in progress, skipping...');
        return;
      }
      try {
        isPullingRef.current = true;
        const library = useLibraryStore.getState().library;
        const syncedBooksCount = await syncBooks(
          [],
          'pull',
          (libraryLoaded && library.length === 0) || fullRefresh ? 0 : undefined,
        );
        if (verbose) {
          eventDispatcher.dispatch('toast', {
            type: 'info',
            message: _('{{count}} book(s) synced', { count: syncedBooksCount }),
          });
        }
      } finally {
        isPullingRef.current = false;
      }
    },
    [_, user, libraryLoaded, syncBooks],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAutoSync = useCallback(
    throttle(
      () => {
        const newBooks = getNewBooks();
        if (newBooks.lastSyncedAt) {
          syncBooks(newBooks.books, 'both');
        }
      },
      SYNC_BOOKS_INTERVAL_SEC * 1000,
      { emitLast: true },
    ),
    [syncBooks],
  );

  useEffect(() => {
    if (!user) return;
    if (isPullingRef.current) {
      return;
    }
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

    // Process old books first so that when we update the library the order is preserved
    syncedBooks.sort((a, b) => a.updatedAt - b.updatedAt);
    const bookHashesInSynced = new Set(syncedBooks.map((book) => book.hash));
    const oldBooks = library.filter((book) => bookHashesInSynced.has(book.hash));
    const oldBooksNeedsDownload = oldBooks.filter((book) => {
      return !book.deletedAt && book.uploadedAt && !book.coverDownloadedAt;
    });

    const processOldBook = async (oldBook: Book) => {
      const matchingBook = syncedBooks.find((newBook) => newBook.hash === oldBook.hash);
      if (matchingBook) {
        if (!matchingBook.deletedAt && matchingBook.uploadedAt && !oldBook.coverDownloadedAt) {
          oldBook.coverImageUrl = await appService?.generateCoverImageUrl(oldBook);
        }
        const mergedBook =
          matchingBook.updatedAt >= oldBook.updatedAt
            ? { ...oldBook, ...matchingBook, syncedAt: Date.now() }
            : { ...matchingBook, ...oldBook, syncedAt: Date.now() };
        return mergedBook;
      }
      return oldBook;
    };

    const oldBooksBatchSize = 100;
    for (let i = 0; i < oldBooksNeedsDownload.length; i += oldBooksBatchSize) {
      const batch = oldBooksNeedsDownload.slice(i, i + oldBooksBatchSize);
      await appService?.downloadBookCovers(batch);
    }

    const updatedLibrary = await Promise.all(library.map(processOldBook));
    setLibrary(updatedLibrary);
    appService?.saveLibraryBooks(updatedLibrary);

    const bookHashesInLibrary = new Set(updatedLibrary.map((book) => book.hash));
    const newBooks = syncedBooks.filter(
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
    if (isSyncing) {
      debouncedUpdateLibrary();
    } else {
      updateLibrary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedBooks, updateLibrary, debouncedUpdateLibrary]);

  return { pullLibrary, pushLibrary };
};
