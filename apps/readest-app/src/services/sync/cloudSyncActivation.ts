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
  active === 'webdav' || active === 'gdrive' || active === 's3' || active === 'onedrive';

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
  onedrive: {
    ...settings.onedrive,
    enabled: active === 'onedrive',
    ...(active === 'onedrive' && !settings.onedrive?.enabled
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

/**
 * Turn ONE cloud sync provider on or off, leaving every other provider exactly
 * as it was (#5062). Providers used to be mutually exclusive; they are now an
 * independent set, so this replaces `withActiveCloudProvider`.
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
  // A switch (rather than a generically-keyed write) keeps each branch's
  // settings slice type intact; `settings[key] = { ...slice, enabled }`
  // does not typecheck when `key` is a union of literal keys (see
  // `applySyncBooksAutoEnable` above for the same constraint).
  switch (kind) {
    case 'webdav': {
      const activating = enabled && !settings.webdav?.enabled;
      return {
        ...settings,
        webdav: {
          ...settings.webdav,
          enabled,
          ...(activating ? { syncBooks: true, providerSelectedAt: Date.now() } : {}),
        },
      };
    }
    case 'gdrive': {
      const activating = enabled && !settings.googleDrive?.enabled;
      return {
        ...settings,
        googleDrive: {
          ...settings.googleDrive,
          enabled,
          ...(activating ? { syncBooks: true, providerSelectedAt: Date.now() } : {}),
        },
      };
    }
    case 's3': {
      const activating = enabled && !settings.s3?.enabled;
      return {
        ...settings,
        s3: {
          ...settings.s3,
          enabled,
          ...(activating ? { syncBooks: true, providerSelectedAt: Date.now() } : {}),
        },
      };
    }
    case 'onedrive': {
      const activating = enabled && !settings.onedrive?.enabled;
      return {
        ...settings,
        onedrive: {
          ...settings.onedrive,
          enabled,
          ...(activating ? { syncBooks: true, providerSelectedAt: Date.now() } : {}),
        },
      };
    }
  }
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
