import { useCallback, useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useABSServerStore } from '@/store/absServerStore';
import { syncAllAbsServers } from '@/services/audiobookshelf/librarySync';
import { eventDispatcher } from '@/utils/event';

const AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function useABSSync() {
  const { appService, envConfig } = useEnv();
  const isSyncingRef = useRef(false);
  const hydratePromiseRef = useRef<Promise<void> | null>(null);

  const ensureHydrated = useCallback(() => {
    if (!hydratePromiseRef.current) {
      hydratePromiseRef.current = useABSServerStore.getState().loadABSServers(envConfig);
    }
    return hydratePromiseRef.current;
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
