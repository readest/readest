import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';
import type { CloudSyncProviderKind } from '@/services/sync/cloudSyncProvider';
import { settingsKeyForBackend } from '@/services/sync/cloudSyncProvider';
import { useSettingsStore } from '@/store/settingsStore';
import { broadcastGlobalSettings } from '@/utils/settingsSync';

/**
 * Write Readest Cloud's own switch, including the third state a plain boolean
 * cannot express: `undefined`, which restores the derived fallback
 * (`enabled ?? !hasAnyThirdPartyEnabled`, see `isReadestCloudEnabled`).
 *
 * Clearing rather than pinning `true` matters — a pinned `true` retires the
 * derivation, so enabling WebDAV later would leave Readest Cloud on and the
 * library would upload to both. `disabledAt` is stamped only for an explicit
 * opt-out: it anchors the mixed-fleet probe ("when did this device stop
 * writing native rows"), which a device back on the derived default never did.
 */
export const withReadestCloudChoice = (
  settings: SystemSettings,
  enabled: boolean | undefined,
): SystemSettings => ({
  ...settings,
  readestCloud: {
    ...settings.readestCloud,
    enabled,
    disabledAt: enabled === false ? Date.now() : undefined,
  },
});

/**
 * Turn ONE cloud sync provider on or off, leaving every other provider exactly
 * as it was (#5062). Providers are an independent set: any subset may sync
 * the library at once.
 *
 * Provider config (WebDAV credentials, the Drive/OneDrive account label) is
 * left untouched when switching a provider off, so re-enabling it later needs
 * no re-entry; only an explicit Disconnect tears the config down.
 *
 * Switching a third-party provider ON (off -> on edge only) stamps
 * `providerSelectedAt`, and on the FIRST activation on this device also turns
 * its `syncBooks` on: checking a provider for the first time means "mirror my
 * library here". A LATER reactivation leaves the sub-toggles alone. Disconnect
 * writes only `enabled: false`, and `buildWebDAVConnectSettings` preserves the
 * sub-toggles precisely so a reconnect is not a reset — force-flipping
 * `syncBooks` back on here silently discarded a deliberate Upload Book Files
 * opt-out every time a user reconnected (#6010).
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
    return withReadestCloudChoice(settings, enabled);
  }
  const key = settingsKeyForBackend(kind);
  const slice = settings[key];
  const activating = enabled && !slice?.enabled;
  // Read before the write below re-stamps it: the stamp is what tells a
  // reconnect apart from a first-ever activation on this device.
  const firstActivation = activating && !slice?.providerSelectedAt;
  return {
    ...settings,
    [key]: {
      ...slice,
      enabled,
      ...(activating
        ? { ...(firstActivation ? { syncBooks: true } : {}), providerSelectedAt: Date.now() }
        : {}),
    },
  };
};

/**
 * Load the live settings, apply `apply`, then hydrate the store, persist, and
 * broadcast. Shared by the two writers below so a cloud-sync selection always
 * (a) persists, (b) hydrates the settings store even on routes where it was
 * never loaded (the OAuth callbacks), and (c) broadcasts to other windows — a
 * stale reader window would otherwise clobber the change on its next
 * whole-file save.
 */
const persistCloudSyncSelection = async (
  envConfig: EnvConfigType,
  apply: (settings: SystemSettings) => SystemSettings,
): Promise<SystemSettings> => {
  const store = useSettingsStore.getState();
  const appService = await envConfig.getAppService();
  const current = store.settings?.version ? store.settings : await appService.loadSettings();
  const next = apply(current);
  store.setSettings(next);
  await appService.saveSettings(next);
  void broadcastGlobalSettings(next, { includeCloudSyncProviders: true });
  return next;
};

/**
 * The single write path for switching a cloud sync provider on or off. Every
 * surface (the Cloud Sync checkboxes, each provider's connect/disconnect flow,
 * the Drive and OneDrive OAuth callbacks) routes through here.
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
): Promise<SystemSettings> =>
  persistCloudSyncSelection(envConfig, (current) =>
    withCloudProviderEnabled(mutate(current), kind, enabled),
  );

/**
 * Readest Cloud's switch, for callers that need to clear it back to the
 * derived default as well as set it. The sign-in page's opt-in (#6010) is the
 * one such caller; the Integrations checkbox goes through
 * `persistCloudProviderEnabled` like every other provider.
 */
export const persistReadestCloudChoice = async (
  envConfig: EnvConfigType,
  enabled: boolean | undefined,
): Promise<SystemSettings> =>
  persistCloudSyncSelection(envConfig, (current) => withReadestCloudChoice(current, enabled));
