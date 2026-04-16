'use client';

import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useStatisticsStore } from '@/store/statisticsStore';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';

interface BookSessionTrackerProps {
  bookKey: string;
}

/**
 * Component that tracks reading sessions for a specific book.
 * This component doesn't render anything visible, it just manages
 * the reading session lifecycle for statistics tracking.
 */
const BookSessionTracker: React.FC<BookSessionTrackerProps> = ({ bookKey }) => {
  const { envConfig } = useEnv();

  // Extract book hash (id) from bookKey - bookDataStore uses id as key, not full bookKey
  const bookId = bookKey.split('-')[0] ?? bookKey;

  // Subscribe to actual data values (not getter functions) so effects re-run when data changes
  const viewState = useReaderStore((state) => state.viewStates[bookKey]);
  const bookData = useBookDataStore((state) => state.booksData[bookId]);
  const progress = useReaderStore((state) => state.viewStates[bookKey]?.progress);

  // Subscribe to specific values to ensure re-renders when they change
  const config = useStatisticsStore((state) => state.config);
  const loaded = useStatisticsStore((state) => state.loaded);
  const { startSession, updateSessionActivity, endSession, saveStatistics } = useStatisticsStore();

  const IDLE_TIMEOUT_MS = (config.idleTimeoutMinutes || 5) * 60 * 1000;

  // Ref to store Tauri unlisten function
  const unlistenOnFocusChangedRef = useRef<Promise<() => void> | null>(null);

  // Start session when the book view is initialized
  useEffect(() => {
    console.log('[BookSessionTracker] Effect check for', bookKey, {
      trackingEnabled: config.trackingEnabled,
      loaded,
      viewStateInited: viewState?.inited,
      hasBookData: !!bookData,
      hasBook: !!bookData?.book,
      bookId,
    });

    if (!config.trackingEnabled || !loaded) {
      console.log('[BookSessionTracker] Early return: tracking disabled or not loaded');
      return;
    }

    // Wait for the view to be initialized
    if (!viewState?.inited || !bookData?.book) {
      console.log('[BookSessionTracker] Early return: view not inited or no book data');
      return;
    }

    // Don't start if session already exists - use getState() to avoid dependency on activeSessions
    const currentActiveSessions = useStatisticsStore.getState().activeSessions;
    if (currentActiveSessions[bookKey]) {
      console.log('[BookSessionTracker] Session already exists for', bookKey);
      return;
    }

    const metaHash = bookData.book.metaHash;
    const pageInfo = progress?.pageinfo;
    const currentPage = pageInfo?.current || 1;
    const totalPages = pageInfo?.total || 1;
    const progressPercent = totalPages > 0 ? currentPage / totalPages : 0;

    startSession(bookKey, bookId, metaHash, progressPercent, currentPage, totalPages);

    console.log('[BookSessionTracker] Started session for', bookKey, 'bookId:', bookId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bookKey,
    bookId,
    config.trackingEnabled,
    loaded,
    viewState?.inited,
    bookData?.book,
    progress?.pageinfo,
    startSession,
  ]);

  // Track progress changes and reset idle timer
  useEffect(() => {
    if (!config.trackingEnabled || !loaded) return;

    // Check for active session using getState() to avoid dependency loops
    const currentActiveSessions = useStatisticsStore.getState().activeSessions;
    if (!currentActiveSessions[bookKey]) return;

    if (!progress?.pageinfo) return;

    const pageInfo = progress.pageinfo;
    const currentPage = pageInfo.current || 1;
    const totalPages = pageInfo.total || 1;
    const progressPercent = totalPages > 0 ? currentPage / totalPages : 0;

    updateSessionActivity(bookKey, progressPercent, currentPage);
  }, [bookKey, config.trackingEnabled, loaded, progress?.pageinfo, updateSessionActivity]);

  // Idle timeout handler - reset timer when progress changes
  useEffect(() => {
    if (!config.trackingEnabled || !loaded) return;

    // Check for active session using getState()
    const currentActiveSessions = useStatisticsStore.getState().activeSessions;
    if (!currentActiveSessions[bookKey]) return;

    const idleTimer = setTimeout(async () => {
      console.log('[BookSessionTracker] Idle timeout for', bookKey);
      const session = endSession(bookKey, 'idle');
      if (session) {
        console.log('[BookSessionTracker] Saving after idle timeout...');
        await saveStatistics(envConfig);
        console.log('[BookSessionTracker] Save completed after idle timeout');
      }
    }, IDLE_TIMEOUT_MS);

    return () => clearTimeout(idleTimer);
  }, [
    bookKey,
    config.trackingEnabled,
    loaded,
    progress?.pageinfo,
    endSession,
    saveStatistics,
    envConfig,
    IDLE_TIMEOUT_MS,
  ]);

  // Handle app losing/gaining focus (visibility change for web, focus change for Tauri)
  useEffect(() => {
    if (!config.trackingEnabled || !loaded) return;

    const handleFocusLost = () => {
      const { activeSessions, loaded: statsLoaded } = useStatisticsStore.getState();
      if (!statsLoaded) return;

      if (activeSessions[bookKey]) {
        console.log('[BookSessionTracker] App lost focus, ending session for', bookKey);
        const session = endSession(bookKey, 'idle');
        if (session) {
          saveStatistics(envConfig);
        }
      }
    };

    const handleFocusGained = () => {
      const { activeSessions, loaded: statsLoaded } = useStatisticsStore.getState();
      if (!statsLoaded) return;

      const currentViewState = useReaderStore.getState().viewStates[bookKey];
      const currentBookData = useBookDataStore.getState().booksData[bookId];
      const currentProgress = currentViewState?.progress;

      if (currentViewState?.inited && currentBookData?.book && !activeSessions[bookKey]) {
        console.log('[BookSessionTracker] App gained focus, restarting session for', bookKey);
        const metaHash = currentBookData.book.metaHash;
        const pageInfo = currentProgress?.pageinfo;
        const currentPage = pageInfo?.current || 1;
        const totalPages = pageInfo?.total || 1;
        const progressPercent = totalPages > 0 ? currentPage / totalPages : 0;

        startSession(bookKey, bookId, metaHash, progressPercent, currentPage, totalPages);
      }
    };

    // Web platform: use visibilitychange (for tab switching, minimizing)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleFocusLost();
      } else if (document.visibilityState === 'visible') {
        handleFocusGained();
      }
    };

    if (isWebAppPlatform()) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // Tauri platform: use window focus change (for alt-tab, clicking other apps)
    if (isTauriAppPlatform()) {
      unlistenOnFocusChangedRef.current = getCurrentWindow().onFocusChanged(
        ({ payload: focused }) => {
          if (focused) {
            handleFocusGained();
          } else {
            handleFocusLost();
          }
        },
      );
    }

    return () => {
      if (isWebAppPlatform()) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (unlistenOnFocusChangedRef.current) {
        unlistenOnFocusChangedRef.current.then((f) => f());
      }
    };
  }, [
    bookKey,
    bookId,
    config.trackingEnabled,
    loaded,
    endSession,
    startSession,
    saveStatistics,
    envConfig,
  ]);

  // End session when component unmounts (book closed)
  useEffect(() => {
    return () => {
      // Use getState() to get fresh state during cleanup
      const currentActiveSessions = useStatisticsStore.getState().activeSessions;
      if (currentActiveSessions[bookKey]) {
        console.log('[BookSessionTracker] Component unmounting, ending session for', bookKey);
        const session = endSession(bookKey, 'closed');
        if (session) {
          saveStatistics(envConfig);
        }
      }
    };
  }, [bookKey, endSession, saveStatistics, envConfig]);

  // This component doesn't render anything visible
  return null;
};

export default BookSessionTracker;
