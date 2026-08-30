import React, { useEffect } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import {
  getLanSyncGeneration,
  getLanSyncStatus,
  startLanSync,
  stopLanSyncIfCurrent,
} from '@/services/lanSync/lifecycle';
import { setMulticastLock } from '@/utils/bridge';

/**
 * Keeps the embedded LAN sync server alive while the integration is enabled.
 * Mounted once per window next to <LocalSendManager />. The Rust side is
 * idempotent (starting a running server returns its status), so the boot-time
 * start races nothing. Like LocalSend, the server intentionally outlives
 * route changes — only Disconnect in the LAN form stops it.
 */
const LanSyncManager: React.FC = () => {
  const lan = useSettingsStore((s) => s.settings?.lan);
  const { appService } = useEnv();
  const isTauri = isTauriAppPlatform();
  const isLanEnabled = !!lan?.enabled && !!lan?.token;
  const isAndroidApp = appService?.isAndroidApp === true;

  useEffect(() => {
    if (!isTauri || !isLanEnabled || !lan?.token) return;
    const expectedIntentGeneration = getLanSyncGeneration();
    let cancelled = false;
    let lockHeld = false;
    const lockAcquisition = isAndroidApp
      ? setMulticastLock(true, 'lan-sync')
          .then(() => {
            lockHeld = true;
          })
          .catch((e) => {
            // Manual TCP sync remains usable if Android denies the multicast
            // lease; discovery simply becomes best-effort.
            console.warn('lan_sync multicast lock failed:', e);
          })
      : Promise.resolve();
    let lockReleasePromise: Promise<void> | null = null;
    const releaseLock = async () => {
      if (lockReleasePromise) return lockReleasePromise;
      lockReleasePromise = (async () => {
        await lockAcquisition;
        if (!lockHeld) return;
        lockHeld = false;
        await setMulticastLock(false, 'lan-sync').catch(() => {});
      })();
      return lockReleasePromise;
    };

    (async () => {
      try {
        await lockAcquisition;
        if (cancelled) {
          await releaseLock();
          return;
        }
        const status = await getLanSyncStatus();
        if (cancelled || getLanSyncGeneration() !== expectedIntentGeneration) {
          await releaseLock();
          return;
        }
        const nextStatus = await startLanSync(lan.token, undefined, '', status.generation);
        const currentLan = useSettingsStore.getState().settings?.lan;
        if (
          cancelled ||
          getLanSyncGeneration() !== expectedIntentGeneration ||
          !currentLan?.enabled ||
          currentLan.token !== lan.token
        ) {
          if (nextStatus.started) {
            try {
              await stopLanSyncIfCurrent(nextStatus.generation);
            } catch {
              /* disconnect cleanup may already have stopped it */
            }
          }
          await releaseLock();
        }
      } catch (e) {
        await releaseLock();
        if (!cancelled) console.warn('lan_sync boot start failed:', e);
      }
    })();
    return () => {
      cancelled = true;
      void releaseLock();
    };
  }, [isAndroidApp, isLanEnabled, isTauri, lan?.token]);

  return null;
};

export default LanSyncManager;
