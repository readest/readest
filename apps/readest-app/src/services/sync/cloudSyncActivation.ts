import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';
import type { CloudSyncProviderKind } from '@/services/sync/cloudSyncProvider';
import { settingsKeyForBackend } from '@/services/sync/cloudSyncProvider';
import { useSettingsStore } from '@/store/settingsStore';
import { broadcastGlobalSettings } from '@/utils/settingsSync';

/**
 * Turn ONE cloud sync provider on or off, leaving every other provider exactly
 * as it was (#5062). Providers are an independent set: any subset may sync
 * the library at once.
 *
 * Provider config (WebDAV credentials, the Drive/OneDrive account label) is
 * left untouched when switching a provider off, so re-enabling it later needs
 * no re-entry; only an explicit Disconnect tears the config down.
 *
 * Switching a third-party provider ON (off -> on edge only) also turns its
 * `syncBooks` on and stamps `providerSelectedAt`: checking a provider means
 * "mirror my library here". An explicit `syncBooks` opt-out while the provider
 * stays on is respected — a redundant re-activation changes nothing.
 *
 * Switching Readest Cloud OFF stamps `readestCloud.disabledAt`, the anchor for
 * mixed-fleet detection ("when did this device stop writing native rows").
 */
export const withCloudProviderEnabled = (
  settings: SystemSettings,
  kind: CloudSyncProviderKind,
  enabled: boolean,
): SystemSettings => {
  if (kind === 'readest') {
    return {
      ...settings,
      readestCloud: {
        ...settings.readestCloud,
        enabled,
        disabledAt: enabled ? undefined : Date.now(),
      },
    };
  }
  const key = settingsKeyForBackend(kind);
  const slice = settings[key];
  const activating = enabled && !slice?.enabled;
  return {
    ...settings,
    [key]: {
      ...slice,
      enabled,
      ...(activating ? { syncBooks: true, providerSelectedAt: Date.now() } : {}),
    },
  };
};

/**
 * The single write path for switching a cloud sync provider on or off. Every
 * surface (the Cloud Sync checkboxes, each provider's connect/disconnect flow,
 * the Drive and OneDrive OAuth callbacks) routes through here so the change
 * always (a) persists, (b) hydrates the settings store even on routes where it
 * was never loaded (the OAuth callbacks), and (c) broadcasts to other windows —
 * a stale reader window would otherwise clobber the change on its next
 * whole-file save.
 *
 * `mutate` runs BEFORE the toggle so connect flows can apply credentials or an
 * account label without pre-setting `enabled` (which would suppress the
 * activation side effects).
 */
export const persistCloudProviderEnabled = async (
  envConfig: EnvConfigType,
  kind: CloudSyncProviderKind,
  enabled: boolean,
  mutate: (settings: SystemSettings) => SystemSettings = (s) => s,
): Promise<SystemSettings> => {
  const store = useSettingsStore.getState();
  const appService = await envConfig.getAppService();
  const current = store.settings?.version ? store.settings : await appService.loadSettings();
  const next = withCloudProviderEnabled(mutate(current), kind, enabled);
  store.setSettings(next);
  await appService.saveSettings(next);
  void broadcastGlobalSettings(next, { includeCloudSyncProviders: true });
  return next;
};
