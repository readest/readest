import type { SystemSettings } from '@/types/settings';
import type { UserPlan } from '@/types/quota';
import { isCloudSyncAllowed } from '@/utils/access';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

/**
 * The cloud sync provider kind for library data (book files, book rows,
 * progress, notes). 'readest' is the native Readest Cloud; the others are
 * the third-party file-sync backends.
 *
 * Providers are INDEPENDENT (#5062): any subset may sync the library at once,
 * including none. Readest Cloud's flag has a derived default so an absent value
 * reproduces the old exclusive behaviour; every third-party backend is a plain
 * per-device `enabled` flag. Account-level data (settings replicas, reading
 * stats, dictionaries/fonts, translations) always syncs via Readest Cloud while
 * signed in, regardless of this selection.
 */
export type CloudSyncProviderKind = 'readest' | FileSyncBackendKind;

/** Settings slice key for a third-party backend kind. */
export const settingsKeyForBackend = (
  kind: FileSyncBackendKind,
): 'webdav' | 'googleDrive' | 's3' | 'onedrive' => (kind === 'gdrive' ? 'googleDrive' : kind);

/** Human-readable provider name (product names — deliberately untranslated). */
export const cloudProviderDisplayName = (kind: CloudSyncProviderKind): string =>
  kind === 'gdrive'
    ? 'Google Drive'
    : kind === 'webdav'
      ? 'WebDAV'
      : kind === 's3'
        ? 'S3'
        : kind === 'onedrive'
          ? 'OneDrive'
          : 'Readest Cloud';

/**
 * The third-party backends the user has switched on, in a STABLE order that
 * every loop, list, and sync pass in the app relies on.
 */
export const getEnabledFileSyncBackends = (
  settings: SystemSettings | null | undefined,
): FileSyncBackendKind[] => {
  const enabled: FileSyncBackendKind[] = [];
  if (settings?.webdav?.enabled) enabled.push('webdav');
  if (settings?.googleDrive?.enabled) enabled.push('gdrive');
  if (settings?.s3?.enabled) enabled.push('s3');
  if (settings?.onedrive?.enabled) enabled.push('onedrive');
  return enabled;
};

/** Any third-party file-sync backend switched on. */
export const hasAnyThirdPartyEnabled = (settings: SystemSettings | null | undefined): boolean =>
  getEnabledFileSyncBackends(settings).length > 0;

/**
 * Whether Readest Cloud syncs the library channels on this device.
 *
 * The `??` is load-bearing: an absent `readestCloud.enabled` reproduces the
 * pre-#5062 exclusive derivation (Readest Cloud owned the library exactly when
 * no third-party provider was enabled), so upgrading users need no migration
 * and disconnecting the last third-party provider still falls back to Readest
 * Cloud. Once the user touches a Cloud Sync checkbox the flag is explicit and
 * wins.
 */
export const isReadestCloudEnabled = (settings: SystemSettings | null | undefined): boolean =>
  settings?.readestCloud?.enabled ?? !hasAnyThirdPartyEnabled(settings);

/** Every provider syncing the library on this device, Readest Cloud first. */
export const getCloudSyncProviders = (
  settings: SystemSettings | null | undefined,
): CloudSyncProviderKind[] => [
  ...(isReadestCloudEnabled(settings) ? (['readest'] as const) : []),
  ...getEnabledFileSyncBackends(settings),
];

/** Comma-joined product names, for the "Synced via {{provider}}" copy. */
export const cloudProvidersDisplayName = (kinds: CloudSyncProviderKind[]): string =>
  kinds.map(cloudProviderDisplayName).join(', ');

/**
 * `isCloudSyncAllowed` needs the UserPlan, which comes from the async
 * auth JWT — non-React modules (transferManager, syncCategories) cannot
 * resolve it synchronously. The plan-resolution flow (auth / quota
 * refresh) writes the latest plan here; gate checks read it back.
 * Defaults to 'free', the most restrictive plan, so a gate evaluated
 * before the first auth resolution can only be too cautious, never too
 * permissive.
 */
let cachedUserPlan: UserPlan = 'free';

export const setCachedUserPlan = (plan: UserPlan | undefined): void => {
  cachedUserPlan = plan ?? 'free';
};

export const getCachedUserPlan = (): UserPlan => cachedUserPlan;

export interface CloudSyncGate {
  /** Readest Cloud syncs the library channels (rows, progress, notes, files). */
  readest: boolean;
  /** Third-party backends the user switched on, in the fixed webdav/gdrive/s3/onedrive order. */
  backends: FileSyncBackendKind[];
  /**
   * True when third-party backends are switched on but the plan does not allow
   * cloud sync. Paused means paused: a paused backend does not sync. Readest
   * Cloud is unaffected — if it is on it keeps running, because the user asked
   * for it, not as a silent fallback (#4959).
   */
  paused: boolean;
}

export const resolveCloudSyncGate = (
  settings: SystemSettings | null | undefined,
  plan: UserPlan = cachedUserPlan,
): CloudSyncGate => {
  const backends = getEnabledFileSyncBackends(settings);
  return {
    readest: isReadestCloudEnabled(settings),
    backends,
    paused: backends.length > 0 && !isCloudSyncAllowed(plan),
  };
};

/** The backends that may actually run right now (empty when paused). */
export const getActiveFileSyncBackends = (
  settings: SystemSettings | null | undefined,
  plan?: UserPlan,
): FileSyncBackendKind[] => {
  const gate = resolveCloudSyncGate(settings, plan);
  return gate.paused ? [] : gate.backends;
};

/**
 * One-time upgrade migration helper (appService migrate20260706): users
 * who already had WebDAV/Drive enabled before provider selection shipped
 * become "third-party selected" on upgrade, which gates native Readest
 * Cloud uploads off — with syncBooks at its old `false` default their
 * books would back up nowhere. Flip syncBooks on for every enabled backend.
 * Mutates `settings` in place (the migration runner saves the same
 * snapshot afterwards) and returns whether anything changed.
 */
export const applySyncBooksAutoEnable = (settings: SystemSettings): boolean => {
  let changed = false;
  for (const kind of getEnabledFileSyncBackends(settings)) {
    // A switch (rather than a generically-keyed write) keeps each branch's
    // settings slice type intact; `settings[key] = { ...slice, syncBooks }`
    // does not typecheck when `key` is a union of literal keys.
    switch (kind) {
      case 'webdav':
        if (settings.webdav && !settings.webdav.syncBooks) {
          settings.webdav = { ...settings.webdav, syncBooks: true };
          changed = true;
        }
        break;
      case 'gdrive':
        if (settings.googleDrive && !settings.googleDrive.syncBooks) {
          settings.googleDrive = { ...settings.googleDrive, syncBooks: true };
          changed = true;
        }
        break;
      case 's3':
        if (settings.s3 && !settings.s3.syncBooks) {
          settings.s3 = { ...settings.s3, syncBooks: true };
          changed = true;
        }
        break;
      case 'onedrive':
        if (settings.onedrive && !settings.onedrive.syncBooks) {
          settings.onedrive = { ...settings.onedrive, syncBooks: true };
          changed = true;
        }
        break;
    }
  }
  return changed;
};

/**
 * Whether Readest Cloud storage may be written to (book file uploads and the
 * native book/progress/note rows). Now simply "is Readest Cloud switched on" —
 * it no longer means "and nothing else is". A user can mirror to Drive AND keep
 * Readest Cloud; whether book *files* also go to Readest is still governed
 * separately by `autoUpload` and the transfer queue.
 */
export const isReadestCloudStorageActive = (
  settings: SystemSettings | null | undefined,
  _plan?: UserPlan,
): boolean => isReadestCloudEnabled(settings);
