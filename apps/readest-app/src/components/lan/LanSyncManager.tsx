import React, { useEffect } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform } from '@/services/environment';
import { getLanSyncStatus, startLanSync } from '@/services/lanSync/lifecycle';

/**
 * Keeps the embedded LAN sync server alive while the integration is enabled.
 * Mounted once per window next to <LocalSendManager />. The Rust side is
 * idempotent (starting a running server returns its status), so the boot-time
 * start races nothing. Like LocalSend, the server intentionally outlives
 * route changes — only Disconnect in the LAN form stops it.
 */
const LanSyncManager: React.FC = () => {
  const lan = useSettingsStore((s) => s.settings?.lan);

  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    if (!lan?.enabled || !lan.token) return;
    let cancelled = false;
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
    };
  }, [lan]);

  return null;
};

export default LanSyncManager;
