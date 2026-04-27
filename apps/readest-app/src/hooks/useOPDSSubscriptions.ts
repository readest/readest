import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { syncSubscribedCatalogs } from '@/services/opds';
import { AUTO_CHECK_INTERVAL_MS } from '@/services/opds/types';
import { transferManager } from '@/services/transferManager';
import { eventDispatcher } from '@/utils/event';

export function useOPDSSubscriptions() {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { user } = useAuth();
  const { libraryLoaded } = useLibraryStore();
  const isSyncingRef = useRef(false);

  const checkOPDSSubscriptions = useCallback(
    async (verbose = false) => {
      if (!appService || !libraryLoaded) return;
      if (isSyncingRef.current) return;

      const { settings } = useSettingsStore.getState();
      const catalogs = settings.opdsCatalogs ?? [];
      const hasAutoDownload = catalogs.some((c) => c.autoDownload && !c.disabled);
      if (!hasAutoDownload) return;

      console.log(`[OPDS] checking subscriptions`);
      try {
        isSyncingRef.current = true;
        const librarySnapshot = [...useLibraryStore.getState().library];
        const { newBooks, totalNewBooks, errors } = await syncSubscribedCatalogs(
          catalogs,
          appService,
          librarySnapshot,
        );

        if (totalNewBooks > 0) {
          const currentLibrary = useLibraryStore.getState().library;
          const existingHashes = new Set(currentLibrary.map((b) => b.hash));
          const uniqueNewBooks = newBooks.filter((b) => !existingHashes.has(b.hash));
          if (uniqueNewBooks.length > 0) {
            const merged = [...uniqueNewBooks, ...currentLibrary];
            useLibraryStore.getState().setLibrary(merged);
            appService.saveLibraryBooks(merged);
          }

          // Mirror the manual OPDS download path: queue cloud upload for each
          // newly imported book when the user is logged in and has the global
          // autoUpload setting on. Delay so the transfer manager has a chance
          // to finish initializing if this fires right after libraryLoaded.
          const { settings: currentSettings } = useSettingsStore.getState();
          if (user && currentSettings.autoUpload && uniqueNewBooks.length > 0) {
            const booksToUpload = uniqueNewBooks.filter((b) => !b.uploadedAt);
            if (booksToUpload.length > 0) {
              setTimeout(() => {
                for (const book of booksToUpload) {
                  transferManager.queueUpload(book);
                }
              }, 3000);
            }
          }
        }

        if (verbose && totalNewBooks > 0) {
          eventDispatcher.dispatch('toast', {
            type: 'info',
            message: _('{{count}} new item(s) downloaded from OPDS', { count: totalNewBooks }),
          });
        }
        if (verbose && errors.length > 0) {
          eventDispatcher.dispatch('toast', {
            type: 'error',
            timeout: 4000,
            message: _('Failed to sync {{count}} OPDS catalog(s)', { count: errors.length }),
          });
        }
      } catch (error) {
        console.error('OPDS subscription sync error:', error);
      } finally {
        isSyncingRef.current = false;
        // CatalogManager listens for this to refresh the per-catalog status
        // (last-checked time, failed-entries count) without polling.
        eventDispatcher.dispatch('opds-sync-complete');
      }
    },
    [_, appService, libraryLoaded, user],
  );

  // Auto-trigger on startup after library is loaded
  useEffect(() => {
    if (!libraryLoaded) return;
    checkOPDSSubscriptions();
  }, [libraryLoaded, checkOPDSSubscriptions]);

  // Listen for explicit re-check requests (e.g. user enables auto-download
  // on a catalog and we want to sync immediately rather than wait for the
  // next app launch).
  useEffect(() => {
    const handler = () => checkOPDSSubscriptions(true);
    eventDispatcher.on('check-opds-subscriptions', handler);
    return () => eventDispatcher.off('check-opds-subscriptions', handler);
  }, [checkOPDSSubscriptions]);

  // Periodic background check. Silent (no toasts) so it doesn't surprise the
  // user with notifications every 5 minutes; new books just appear in the
  // library when they finish downloading. The function is a no-op when no
  // catalogs have autoDownload enabled, so the timer is cheap.
  useEffect(() => {
    if (!libraryLoaded) return;
    const intervalId = setInterval(() => {
      checkOPDSSubscriptions(false);
    }, AUTO_CHECK_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [libraryLoaded, checkOPDSSubscriptions]);

  return { checkOPDSSubscriptions };
}
