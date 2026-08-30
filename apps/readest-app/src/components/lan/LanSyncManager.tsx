import React, { useEffect } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import { getLanSyncStatus, startLanSync } from '@/services/lanSync/lifecycle';
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

  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    if (!lan?.enabled || !lan.token) return;
    let cancelled = false;
    const needsMulticastLock = appService?.isAndroidApp === true;
    // Android drops Wi-Fi multicast while the app is idle unless a
    // MulticastLock is held. LocalSend already owns the same bridge; acquire
    // it for LAN discovery and release it when this integration is disabled.
    if (needsMulticastLock) void setMulticastLock(true).catch(() => {});
    (async () => {
      try {
        const status = await getLanSyncStatus();
        if (!status.running && !cancelled) {
          await startLanSync(lan.token);
        }
      } catch (e) {
        console.warn('lan_sync boot start failed:', e);
      }
    })();
    return () => {
      cancelled = true;
      if (needsMulticastLock) void setMulticastLock(false).catch(() => {});
    };
  }, [appService, lan]);

  return null;
};

export default LanSyncManager;
