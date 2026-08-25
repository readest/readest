import { useCallback, useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useABSServerStore } from '@/store/absServerStore';
import { backfillAbsCovers, syncAllAbsServers } from '@/services/audiobookshelf/librarySync';
import { eventDispatcher } from '@/utils/event';

const AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function useABSSync() {
  const { appService, envConfig } = useEnv();
  const isSyncingRef = useRef(false);

  // Retry hydration while the store is empty instead of caching the first
  // attempt: `EnvProvider` publishes `appService` BEFORE
  // `appService.loadSettings()` resolves, so this hook's mount-time
  // hydration can read the `{}` placeholder settings and come back with
  // nothing. An empty store is no information, not "the user has no
  // servers" — caching it stranded ABS sync (and left every later
  // `saveABSServers` writing an empty list) for the whole session.
  // `loadABSServers` is a cheap in-memory read, so re-running it is fine.
  const ensureHydrated = useCallback(async () => {
    if (useABSServerStore.getState().servers.length > 0) return;
    await useABSServerStore.getState().loadABSServers(envConfig);
  }, [envConfig]);

  const checkABSServers = useCallback(async () => {
    if (!appService) return;
    if (isSyncingRef.current) return;
    // On a fresh boot nothing has hydrated useABSServerStore yet (no
    // IntegrationsPanel mount, no replica pull), so the empty-store no-op
    // below must only fire after hydration has actually run at least once.
    await ensureHydrated();
    if (useABSServerStore.getState().getAvailableServers().length === 0) return;

    try {
      isSyncingRef.current = true;
      // Covers first, unauthenticated: books adopted via the cloud channel
      // must not stay coverless behind a failing (or absent) login.
      await backfillAbsCovers(appService);
      await syncAllAbsServers(appService);
    } catch (error) {
      console.error('ABS sync error:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [appService, ensureHydrated]);

  // Auto-trigger on startup once the app service is ready.
  useEffect(() => {
    checkABSServers();
  }, [checkABSServers]);

  // Listen for explicit sync requests (settings form "Sync now" and after connect).
  useEffect(() => {
    const handler = () => checkABSServers();
    eventDispatcher.on('sync-abs-servers', handler);
    return () => eventDispatcher.off('sync-abs-servers', handler);
  }, [checkABSServers]);

  // Periodic background sync.
  useEffect(() => {
    if (!appService) return;
    const intervalId = setInterval(() => {
      checkABSServers();
    }, AUTO_CHECK_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [appService, checkABSServers]);

  return { checkABSServers };
}
