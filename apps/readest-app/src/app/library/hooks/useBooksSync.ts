import { useCallback, useEffect, useRef } from 'react';
import { Book } from '@/types/book';
import { useSync } from '@/hooks/useSync';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useLibraryStore } from '@/store/libraryStore';
import { SYNC_BOOKS_INTERVAL_SEC } from '@/services/constants';
import { throttle } from '@/utils/throttle';

export const useBooksSync = () => {
  const { user } = useAuth();
  const { appService } = useEnv();
  const { library, isSyncing, setLibrary, setIsSyncing, setSyncProgress } = useLibraryStore();
  const { syncedBooks, syncBooks, lastSyncedAtBooks } = useSync();
  const isPullingRef = useRef(false);

  const getNewBooks = useCallback(() => {
    if (!user) return {};
    const library = useLibraryStore.getState().library;
    const newBooks = library.filter(
      (book) => lastSyncedAtBooks < book.updatedAt || lastSyncedAtBooks < (book.deletedAt ?? 0),
    );
    return {
      books: newBooks,
      lastSyncedAt: lastSyncedAtBooks,
    };
  }, [user, lastSyncedAtBooks]);

  const pullLibrary = useCallback(async () => {
    if (!user) return;
    if (isPullingRef.current) {
      console.log('Pull already in progress, skipping...');
      return;
    }
    try {
      isPullingRef.current = true;
      await syncBooks([], 'pull');
    } finally {
      isPullingRef.current = false;
    }
  }, [user, syncBooks]);

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
      { emitLast: false },
    ),
    [syncBooks],
  );

  useEffect(() => {
    if (!user) return;
    if (isPullingRef.current) {
      return;
    }
    handleAutoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, handleAutoSync]);

  const pushLibrary = useCallback(async () => {
    if (!user) return;
    const newBooks = getNewBooks();
    await syncBooks(newBooks?.books, 'push');
  }, [user, syncBooks, getNewBooks]);

  useEffect(() => {
    if (!user) return;
    pullLibrary();
  }, [user, pullLibrary]);

  const updateLibrary = async () => {
    if (isSyncing) return;
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
          matchingBook.updatedAt > oldBook.updatedAt
            ? { ...oldBook, ...matchingBook }
            : { ...matchingBook, ...oldBook };
        return mergedBook;
      }
      return oldBook;
    };

    const oldBooksBatchSize = 20;
    for (let i = 0; i < oldBooksNeedsDownload.length; i += oldBooksBatchSize) {
      const batch = oldBooksNeedsDownload.slice(i, i + oldBooksBatchSize);
      await appService?.downloadBookCovers(batch);
    }

    const updatedLibrary = await Promise.all(library.map(processOldBook));
    const bookHashesInLibrary = new Set(updatedLibrary.map((book) => book.hash));
    const newBooks = syncedBooks.filter(
      (newBook) =>
        !bookHashesInLibrary.has(newBook.hash) && newBook.uploadedAt && !newBook.deletedAt,
    );

    const processNewBook = async (newBook: Book) => {
      newBook.coverImageUrl = await appService?.generateCoverImageUrl(newBook);
      updatedLibrary.push(newBook);
    };

    if (newBooks.length > 0) {
      setIsSyncing(true);
    }

    const batchSize = 10;
    for (let i = 0; i < newBooks.length; i += batchSize) {
      const batch = newBooks.slice(i, i + batchSize);
      await appService?.downloadBookCovers(batch);
      await Promise.all(batch.map(processNewBook));
      const progress = Math.min((i + batchSize) / newBooks.length, 1);
      setLibrary([...updatedLibrary]);
      setSyncProgress(progress);
    }

    setLibrary(updatedLibrary);
    appService?.saveLibraryBooks(updatedLibrary);

    if (newBooks.length > 0) {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    updateLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedBooks]);

  return { pullLibrary, pushLibrary };
};
