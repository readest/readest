import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { useLibraryStore } from '@/store/libraryStore';
import { SYNC_BOOKS_INTERVAL_SEC } from '@/services/constants';
import { useEnv } from '@/context/EnvContext';

export const useBooksSync = () => {
  const { user } = useAuth();
  const { appService } = useEnv();
  const { library, setLibrary } = useLibraryStore();
  const { syncedBooks, syncBooks, lastSyncedAtBooks } = useSync();

  useEffect(() => {
    if (!user) return;
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

  useEffect(() => {
    const updateLibrary = async () => {
      if (syncedBooks?.length) {
        const updatedLibrary = library.map((oldBook) => {
          const matchingBook = syncedBooks.find((newBook) => newBook.hash === oldBook.hash);
          if (matchingBook) {
            return {
              ...oldBook,
              ...matchingBook,
              updatedAt: oldBook.updatedAt,
              deletedAt: oldBook.deletedAt,
              progress: oldBook.progress,
            };
          }
          return oldBook;
        });
        await Promise.all(
          syncedBooks.map(async (newBook) => {
            if (!updatedLibrary.some((oldBook) => oldBook.hash === newBook.hash)) {
              if (newBook.uploadedAt) {
                try {
                  await appService?.downloadBook(newBook, true);
                  newBook.coverImageUrl = await appService?.generateCoverImageUrl(newBook);
                  updatedLibrary.push(newBook);
                } catch {
                  console.error('Failed to download book:', newBook);
                }
              }
            }
          }),
        );
        setLibrary(updatedLibrary);
        appService?.saveLibraryBooks(updatedLibrary);
      }
    };
    updateLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedBooks]);
};
