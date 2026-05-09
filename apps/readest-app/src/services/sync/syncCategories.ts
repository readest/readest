/**
 * Per-account sync category gating.
 *
 * The user toggles each category on/off in the User → Manage Sync
 * (a.k.a. Data Sync) panel. Disabling a category stops the device
 * from sending and receiving rows of that kind, but leaves whatever's
 * already on the server intact — re-enabling resumes from the current
 * cursor without a backfill.
 *
 * The category map is `SystemSettings.syncCategories` and rides along
 * the bundled `settings` replica via the existing whitelist, so the
 * preference syncs across devices for free.
 *
 * Defaults to enabled when unset so users who never visit the panel
 * keep the cross-device behaviour they had before this shipped.
 *
 * Dependencies: some categories are required by others. Disabling the
 * dependency would silently break the dependent feature, so the
 * helper applies a cascade. See `CATEGORY_DEPENDENTS` below.
 */
import { useSettingsStore } from '@/store/settingsStore';
import { SYNC_CATEGORIES, type SyncCategory } from '@/types/settings';

export { SYNC_CATEGORIES };
export type { SyncCategory };

/**
 * "If <key> is enabled, every value in the array must also be enabled."
 *
 * - `dictionary` requires `settings`: dictionary's `providerOrder`,
 *   `providerEnabled`, and `webSearches` live inside the bundled
 *   settings replica. Turning settings off while dictionary is on
 *   would silently break dictionary cross-device sync.
 *
 * Add new edges here as we ship features that span replica kinds.
 */
const CATEGORY_DEPENDENTS: Partial<Record<SyncCategory, readonly SyncCategory[]>> = {
  dictionary: ['settings'],
};

/**
 * Map a callsite identifier (replica kind, legacy SyncType, etc.) to
 * the corresponding category. Returns null for identifiers that aren't
 * gateable.
 */
const toCategory = (id: string): SyncCategory | null => {
  if ((SYNC_CATEGORIES as readonly string[]).includes(id)) return id as SyncCategory;
  // Legacy `useSync` calls into `pullChanges('configs', ...)` for the
  // book reading-progress data; map the plural to our singular
  // category id.
  if (id === 'configs') return 'progress';
  if (id === 'config') return 'progress';
  if (id === 'books') return 'book';
  if (id === 'notes') return 'note';
  return null;
};

const isCategoryRawEnabled = (category: SyncCategory): boolean => {
  const settings = useSettingsStore.getState().settings;
  if (!settings) return true;
  return settings.syncCategories?.[category] !== false;
};

/**
 * True when at least one enabled category depends on `category`. The
 * UI uses this to render the toggle as locked-on with an
 * explanatory hint, since the user-facing checkbox can't disable it
 * without breaking the dependent feature.
 */
export const isSyncCategoryLocked = (category: SyncCategory): boolean => {
  for (const [parent, deps] of Object.entries(CATEGORY_DEPENDENTS) as [
    SyncCategory,
    readonly SyncCategory[],
  ][]) {
    if (!deps.includes(category)) continue;
    if (isCategoryRawEnabled(parent)) return true;
  }
  return false;
};

export const isSyncCategoryEnabled = (id: string): boolean => {
  const category = toCategory(id);
  if (!category) return true; // unknown id → always-on
  if (isSyncCategoryLocked(category)) return true; // forced by a dependent
  return isCategoryRawEnabled(category);
};
