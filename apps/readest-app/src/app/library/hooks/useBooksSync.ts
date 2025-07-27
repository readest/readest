import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useSync } from '@/hooks/useSync';
import { useLibraryStore } from '@/store/libraryStore';
import { Book } from '@/types/book';
import { SYNC_BOOKS_INTERVAL_SEC } from '@/services/constants';
import { debounce } from '@/utils/debounce';

export interface UseBooksSyncProps {
  onSyncStart?: () => void;
  onSyncEnd?: () => void;
}

export const useBooksSync = ({ onSyncStart, onSyncEnd }: UseBooksSyncProps) => {
  const { user } = useAuth();
  const { appService } = useEnv();
  const { library, setLibrary } = useLibraryStore();
  const { syncedBooks, syncBooks, lastSyncedAtBooks } = useSync();
  const syncBooksPullingRef = useRef(false);

  const pullLibrary = async () => {
    if (!user) return;
    syncBooks([], 'pull');
  };

  const pushLibrary = async () => {
    if (!user) return;
    const newBooks = getNewBooks();
    syncBooks(newBooks, 'push');
  };

  useEffect(() => {
    if (!user) return;
    if (syncBooksPullingRef.current) return;
    syncBooksPullingRef.current = true;

    pullLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getNewBooks = () => {
    if (!user) return [];
    const newBooks = library.filter(
      (book) => lastSyncedAtBooks < book.updatedAt || lastSyncedAtBooks < (book.deletedAt ?? 0),
    );
    return newBooks;
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAutoSync = useCallback(
    debounce(() => {
      const newBooks = getNewBooks();
      syncBooks(newBooks, 'both');
    }, SYNC_BOOKS_INTERVAL_SEC * 1000),
    [library, lastSyncedAtBooks],
  );

  useEffect(() => {
    if (!user) return;
    handleAutoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library]);

  const updateLibrary = async () => {
    if (!syncedBooks?.length) return;
    // Process old books first so that when we update the library the order is preserved
    syncedBooks.sort((a, b) => a.updatedAt - b.updatedAt);

    const processOldBook = async (oldBook: Book) => {
      const matchingBook = syncedBooks.find((newBook) => newBook.hash === oldBook.hash);
      if (matchingBook) {
        if (!matchingBook.deletedAt && matchingBook.uploadedAt && !oldBook.coverDownloadedAt) {
          await appService?.downloadBook(oldBook, true);
        }
        const mergedBook =
          matchingBook.updatedAt > oldBook.updatedAt
            ? { ...oldBook, ...matchingBook }
            : { ...matchingBook, ...oldBook };
        return mergedBook;
      }
      return oldBook;
    };

    const updatedLibrary = await Promise.all(library.map(processOldBook));
    const processNewBook = async (newBook: Book) => {
      if (!updatedLibrary.some((oldBook) => oldBook.hash === newBook.hash)) {
        if (newBook.uploadedAt && !newBook.deletedAt) {
          try {
            await appService?.downloadBook(newBook, true);
          } catch {
            console.error('Failed to download book:', newBook);
          } finally {
            newBook.coverImageUrl = await appService?.generateCoverImageUrl(newBook);
            newBook.coverImageUrl += '?timestamp=' + Date.now();
            updatedLibrary.push(newBook);
            setLibrary(updatedLibrary);
          }
        }
      }
    };
    onSyncStart?.();
    const batchSize = 3;
    for (let i = 0; i < syncedBooks.length; i += batchSize) {
      const batch = syncedBooks.slice(i, i + batchSize);
      await Promise.all(batch.map(processNewBook));
    }
    onSyncEnd?.();
    setLibrary(updatedLibrary);
    appService?.saveLibraryBooks(updatedLibrary);
  };

  useEffect(() => {
    updateLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedBooks]);

  return { pullLibrary, pushLibrary };
};
