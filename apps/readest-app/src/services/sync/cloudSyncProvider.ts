import type { SystemSettings } from '@/types/settings';
import type { UserPlan } from '@/types/quota';
import { isCloudSyncAllowed } from '@/utils/access';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

/**
 * The user's selected cloud sync provider for library data (book files,
 * book rows, progress, notes). 'readest' is the native Readest Cloud;
 * the others are the third-party file-sync backends. Account-level data
 * (settings replicas, reading stats, dictionaries/fonts, translations)
 * always syncs via Readest Cloud regardless of this selection.
 *
 * The selection is DERIVED from the existing per-device enabled flags —
 * there is no separate persisted field, so it inherits the device-local
 * semantics of `webdav.enabled` / `googleDrive.enabled` and needs no
 * migration. `withActiveCloudProvider` keeps the flags mutually
 * exclusive; if both are ever enabled (hand-edited or restored
 * settings), WebDAV wins deterministically.
 */
export type CloudSyncProviderKind = 'readest' | FileSyncBackendKind;

export interface CloudSyncGate {
  provider: CloudSyncProviderKind;
  /**
   * True when a third-party provider is selected but cloud sync is not
   * allowed for the user's plan. Paused means paused: Readest Cloud
   * uploads do NOT silently resume (that would push a possibly-private
   * library to Readest servers without consent and reintroduce the
   * #4959 quota path); the UI surfaces the paused state instead.
   */
  paused: boolean;
}

export const getCloudSyncProvider = (
  settings: SystemSettings | null | undefined,
): CloudSyncProviderKind =>
  settings?.webdav?.enabled ? 'webdav' : settings?.googleDrive?.enabled ? 'gdrive' : 'readest';

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

export const resolveCloudSyncGate = (
  settings: SystemSettings | null | undefined,
  plan: UserPlan = cachedUserPlan,
): CloudSyncGate => {
  const provider = getCloudSyncProvider(settings);
  if (provider !== 'readest' && !isCloudSyncAllowed(plan)) {
    return { provider, paused: true };
  }
  return { provider, paused: false };
};

/**
 * One-time upgrade migration helper (appService migrate20260706): users
 * who already had WebDAV/Drive enabled before provider selection shipped
 * become "third-party selected" on upgrade, which gates native Readest
 * Cloud uploads off — with syncBooks at its old `false` default their
 * books would back up nowhere. Flip syncBooks on for the SELECTED
 * provider only. Mutates `settings` in place (the migration runner saves
 * the same snapshot afterwards) and returns whether anything changed.
 */
export const applySyncBooksAutoEnable = (settings: SystemSettings): boolean => {
  const provider = getCloudSyncProvider(settings);
  if (provider === 'webdav' && settings.webdav && !settings.webdav.syncBooks) {
    settings.webdav = { ...settings.webdav, syncBooks: true };
    return true;
  }
  if (provider === 'gdrive' && settings.googleDrive && !settings.googleDrive.syncBooks) {
    settings.googleDrive = { ...settings.googleDrive, syncBooks: true };
    return true;
  }
  return false;
};

/**
 * Whether Readest Cloud storage may be written to (book file uploads).
 * Strictly: only when Readest Cloud is the selected provider. A selected
 * third-party provider — active or paused — means no Readest Cloud
 * uploads.
 */
export const isReadestCloudStorageActive = (
  settings: SystemSettings | null | undefined,
  plan?: UserPlan,
): boolean => resolveCloudSyncGate(settings, plan).provider === 'readest';
