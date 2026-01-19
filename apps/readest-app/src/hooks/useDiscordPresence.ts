import { useEffect, useRef } from 'react';
import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { updateDiscordPresence, clearDiscordPresence } from '@/utils/discord';

/**
 * Hook to manage Discord Rich Presence for a book
 * @param book - Current book being read (null if no book)
 * @param isPrimary - Whether this is the primary book (for multi-book scenarios)
 */
export const useDiscordPresence = (book: Book | null, isPrimary: boolean, enabled: boolean) => {
  const { appService } = useEnv();

  const sessionStartRef = useRef<number>(Date.now());
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentBookHashRef = useRef<string | null>(null);
  const isUpdatingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isPrimary || !book) return;
    if (!appService?.isDesktopApp) return;

    const stopUpdates = () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
      isUpdatingRef.current = false;
    };

    if (!enabled) {
      stopUpdates();
      clearDiscordPresence(appService);
      currentBookHashRef.current = null;
      return;
    }

    if (currentBookHashRef.current !== book.hash) {
      sessionStartRef.current = Date.now();
      currentBookHashRef.current = book.hash;
    }

    const safeUpdate = async () => {
      if (isUpdatingRef.current) return;

      isUpdatingRef.current = true;
      try {
        await updateDiscordPresence(book, sessionStartRef.current, appService);
      } catch (err) {
        console.error('Discord presence update failed:', err);
      } finally {
        isUpdatingRef.current = false;
      }
    };

    void safeUpdate();

    updateIntervalRef.current = setInterval(() => {
      void safeUpdate();
    }, 15000);

    return () => {
      stopUpdates();
      clearDiscordPresence(appService);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.hash, isPrimary, enabled, appService]);
};
