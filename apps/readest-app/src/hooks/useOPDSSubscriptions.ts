import { useCallback, useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { syncSubscribedCatalogs } from '@/services/opds';
import { eventDispatcher } from '@/utils/event';

export function useOPDSSubscriptions() {
  const _ = useTranslation();
  const { appService } = useEnv();
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

      try {
        isSyncingRef.current = true;
        const librarySnapshot = [...useLibraryStore.getState().library];
        const { newBooks, totalNewBooks } = await syncSubscribedCatalogs(
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
        }

        if (verbose && totalNewBooks > 0) {
          eventDispatcher.dispatch('toast', {
            type: 'info',
            message: _('{{count}} new item(s) downloaded from OPDS', { count: totalNewBooks }),
          });
        }
      } catch (error) {
        console.error('OPDS subscription sync error:', error);
      } finally {
        isSyncingRef.current = false;
      }
    },
    [_, appService, libraryLoaded],
  );

  // Auto-trigger on startup after library is loaded
  useEffect(() => {
    if (!libraryLoaded) return;
    checkOPDSSubscriptions();
  }, [libraryLoaded, checkOPDSSubscriptions]);

  return { checkOPDSSubscriptions };
}
