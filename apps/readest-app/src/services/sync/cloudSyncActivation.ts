import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';
import type { CloudSyncProviderKind } from '@/services/sync/cloudSyncProvider';
import { useSettingsStore } from '@/store/settingsStore';
import { broadcastGlobalSettings } from '@/utils/settingsSync';

/**
 * The provider argument for activation: a third-party backend, or
 * 'readest' / null (both mean "no third-party provider active" — Readest
 * Cloud is the derived default, never a stored flag).
 */
export type CloudSyncActivationKind = CloudSyncProviderKind | null;

const isThirdParty = (active: CloudSyncActivationKind): active is FileSyncBackendKind =>
  active === 'webdav' || active === 'gdrive' || active === 's3';

/**
 * Return settings with exactly one third-party cloud-sync provider active (or
 * none — passing 'readest' or null). WebDAV and Google Drive are mutually
 * exclusive — only one syncs the library at a time — so enabling one always
 * disables the other. Provider config (WebDAV creds, the Drive keychain
 * token) is left untouched, so switching back to a previously-configured
 * provider needs no re-entry; only an explicit Disconnect tears a provider's
 * config down.
 *
 * Activating a provider (disabled -> enabled) also turns its `syncBooks` on
 * and stamps `providerSelectedAt`: the selected provider owns the book-file
 * channel — native Readest Cloud uploads gate off — so leaving syncBooks at
 * its `false` default would back books up nowhere, and the timestamp anchors
 * the mixed-fleet detection probe. An explicit syncBooks opt-out while the
 * provider stays active is respected (re-activation changes nothing).
 */
export const withActiveCloudProvider = (
  settings: SystemSettings,
  active: CloudSyncActivationKind,
): SystemSettings => ({
  ...settings,
  webdav: {
    ...settings.webdav,
    enabled: active === 'webdav',
    ...(active === 'webdav' && !settings.webdav?.enabled
      ? { syncBooks: true, providerSelectedAt: Date.now() }
      : {}),
  },
  googleDrive: {
    ...settings.googleDrive,
    enabled: active === 'gdrive',
    ...(active === 'gdrive' && !settings.googleDrive?.enabled
      ? { syncBooks: true, providerSelectedAt: Date.now() }
      : {}),
  },
  s3: {
    ...settings.s3,
    enabled: active === 's3',
    ...(active === 's3' && !settings.s3?.enabled
      ? { syncBooks: true, providerSelectedAt: Date.now() }
      : {}),
  },
});

/**
 * The single write path for changing the selected cloud sync provider.
 * Every activation/deactivation surface (the Cloud Sync chooser, the
 * WebDAV/Drive connect and disconnect flows, the Drive OAuth callback)
 * routes through here so the change always (a) persists, (b) hydrates the
 * settings store even on routes where it wasn't loaded yet (the OAuth
 * callback), and (c) broadcasts the provider flags to other windows —
 * a stale reader window would otherwise clobber the switch on its next
 * whole-file save, silently resuming Readest Cloud uploads.
 *
 * `mutate` runs BEFORE activation so connect flows can apply credentials
 * or account labels without pre-setting `enabled` (which would suppress
 * the activation side effects).
 */
export const persistActiveCloudProvider = async (
  envConfig: EnvConfigType,
  active: CloudSyncActivationKind,
  mutate: (settings: SystemSettings) => SystemSettings = (s) => s,
): Promise<SystemSettings> => {
  const store = useSettingsStore.getState();
  const appService = await envConfig.getAppService();
  const current = store.settings?.version ? store.settings : await appService.loadSettings();
  const next = withActiveCloudProvider(mutate(current), isThirdParty(active) ? active : null);
  store.setSettings(next);
  await appService.saveSettings(next);
  void broadcastGlobalSettings(next, { includeCloudSyncProviders: true });
  return next;
};
