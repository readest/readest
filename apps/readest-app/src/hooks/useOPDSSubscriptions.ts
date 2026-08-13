import { useCallback, useEffect, useRef } from 'react';
import type { Book } from '@/types/book';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isReadestCloudStorageActive } from '@/services/sync/cloudSyncProvider';
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

        // Runs per catalog, BEFORE the service records the downloaded entries
        // in knownEntryIds — an entry in there is never downloaded again, so
        // the library rows must reach disk first or a kill between the two
        // writes loses the books for good (#5658).
        const persistImportedBooks = async (imported: Book[]) => {
          const currentLibrary = useLibraryStore.getState().library;
          const existingHashes = new Set(currentLibrary.map((b) => b.hash));
          // Two feed entries can resolve to the same file; importBook returns
          // the same row for both, so dedupe by hash before merging.
          const importedBooks = [...new Map(imported.map((b) => [b.hash, b])).values()];
          const uniqueNewBooks = importedBooks.filter((b) => !existingHashes.has(b.hash));
          // Save even when uniqueNewBooks is empty: a re-downloaded book that
          // was previously deleted is already in currentLibrary as a tombstoned
          // row that importBook resurrected in place (cleared its `deletedAt`).
          // Skipping the save would leave the book tombstoned on disk after a
          // restart and never downloaded again (#5658).
          const merged = [...uniqueNewBooks, ...currentLibrary];
          useLibraryStore.getState().setLibrary(merged);
          await appService.saveLibraryBooks(merged);
        };

        const { newBooks, totalNewBooks, errors } = await syncSubscribedCatalogs(
          catalogs,
          appService,
          librarySnapshot,
          persistImportedBooks,
        );

        if (totalNewBooks > 0) {
          // Mirror the manual OPDS download path: queue cloud upload for each
          // newly imported book when the user is logged in and Readest Cloud
          // storage is active. Delay so the transfer manager has a chance
          // to finish initializing if this fires right after libraryLoaded.
          const { settings: currentSettings } = useSettingsStore.getState();
          if (user && isReadestCloudStorageActive(currentSettings)) {
            const importedBooks = [...new Map(newBooks.map((b) => [b.hash, b])).values()];
            const booksToUpload = importedBooks.filter((b) => !b.uploadedAt);
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
