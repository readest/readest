import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useSync } from '@/hooks/useSync';
import { useLibraryStore } from '@/store/libraryStore';
import { SYNC_BOOKS_INTERVAL_SEC } from '@/services/constants';
import { Book } from '@/types/book';

export const useBooksSync = () => {
  const { user } = useAuth();
  const { appService } = useEnv();
  const { library, setLibrary } = useLibraryStore();
  const { syncedBooks, syncBooks, lastSyncedAtBooks } = useSync();
  const syncBooksPullingRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (syncBooksPullingRef.current) return;
    syncBooksPullingRef.current = true;

    syncBooks([], 'pull');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastSyncTime = useRef<number>(0);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getNewBooks = () => {
    if (!user) return [];
    const newBooks = library.filter(
      (book) => lastSyncedAtBooks < book.updatedAt || lastSyncedAtBooks < (book.deletedAt ?? 0),
    );
    return newBooks;
  };

  useEffect(() => {
    if (!user) return;
    const now = Date.now();
    const timeSinceLastSync = now - lastSyncTime.current;
    if (timeSinceLastSync > SYNC_BOOKS_INTERVAL_SEC * 1000) {
      lastSyncTime.current = now;
      const newBooks = getNewBooks();
      syncBooks(newBooks, 'both');
    } else {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(
        () => {
          lastSyncTime.current = Date.now();
          const newBooks = getNewBooks();
          syncBooks(newBooks, 'both');
          syncTimeoutRef.current = null;
        },
        SYNC_BOOKS_INTERVAL_SEC * 1000 - timeSinceLastSync,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library]);

  const updateLibrary = async () => {
    if (!syncedBooks?.length) return;

    const processOldBook = async (oldBook: Book) => {
      const matchingBook = syncedBooks.find((newBook) => newBook.hash === oldBook.hash);
      if (matchingBook) {
        if (!matchingBook.deletedAt && matchingBook.uploadedAt && !oldBook.downloadedAt) {
          await appService?.downloadBook(oldBook, true);
        }
        const mergedBook =
          matchingBook.updatedAt > oldBook.updatedAt
            ? { ...oldBook, ...matchingBook, updatedAt: oldBook.updatedAt }
            : { ...matchingBook, ...oldBook, updatedAt: oldBook.updatedAt };
        mergedBook.progress = matchingBook.progress ?? oldBook.progress;
        return mergedBook;
      }
      return oldBook;
    };

    const updatedLibrary = await Promise.all(library.map(processOldBook));
    const processNewBook = async (newBook: Book) => {
      if (!updatedLibrary.some((oldBook) => oldBook.hash === newBook.hash)) {
        if (newBook.uploadedAt && !newBook.deletedAt) {
          try {
            updatedLibrary.push(newBook);
            await appService?.downloadBook(newBook, true);
            newBook.coverImageUrl = await appService?.generateCoverImageUrl(newBook);
          } catch {
            console.error('Failed to download book:', newBook);
          }
        }
      }
    };
    await Promise.all(syncedBooks.map(processNewBook));
    setLibrary(updatedLibrary);
    appService?.saveLibraryBooks(updatedLibrary);
  };

  useEffect(() => {
    updateLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedBooks]);
};
