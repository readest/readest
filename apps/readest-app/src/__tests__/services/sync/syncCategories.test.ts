import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  SYNC_CATEGORIES,
  isSyncCategoryEnabled,
  isSyncCategoryLocked,
} from '@/services/sync/syncCategories';
import { useSettingsStore } from '@/store/settingsStore';
import type { SyncCategory, SystemSettings } from '@/types/settings';

const setSettings = (patch: Partial<SystemSettings>): void => {
  useSettingsStore.setState({
    settings: { ...patch } as SystemSettings,
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
  } as ReturnType<typeof useSettingsStore.getState>);
};

const clearSettings = (): void => {
  useSettingsStore.setState({
    settings: undefined,
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
};

beforeEach(() => clearSettings());
afterEach(() => clearSettings());

describe('isSyncCategoryEnabled', () => {
  test('defaults to true when settings are not loaded yet', () => {
    expect(isSyncCategoryEnabled('book')).toBe(true);
    expect(isSyncCategoryEnabled('dictionary')).toBe(true);
  });

  test('defaults to true when syncCategories map is missing', () => {
    setSettings({});
    expect(isSyncCategoryEnabled('book')).toBe(true);
    expect(isSyncCategoryEnabled('opds_catalog')).toBe(true);
  });

  test('returns true when category is explicitly true', () => {
    setSettings({ syncCategories: { dictionary: true } });
    expect(isSyncCategoryEnabled('dictionary')).toBe(true);
  });

  test('returns false only when category is explicitly false', () => {
    setSettings({ syncCategories: { dictionary: false } });
    expect(isSyncCategoryEnabled('dictionary')).toBe(false);
    // Other unset categories still default to true.
    expect(isSyncCategoryEnabled('font')).toBe(true);
  });

  test('settings is togglable on its own', () => {
    setSettings({
      syncCategories: { settings: false, dictionary: false } as Partial<
        Record<SyncCategory, boolean>
      >,
    });
    // With dictionary off, the user's settings:false stands.
    expect(isSyncCategoryEnabled('settings')).toBe(false);
  });

  test('settings is FORCED on when dictionary is enabled (dependency cascade)', () => {
    setSettings({
      syncCategories: { settings: false, dictionary: true } as Partial<
        Record<SyncCategory, boolean>
      >,
    });
    // Dictionary's providerOrder / providerEnabled / webSearches live
    // inside the settings replica, so disabling settings while
    // dictionary is on would silently break dictionary cross-device
    // sync. The cascade prevents that footgun.
    expect(isSyncCategoryEnabled('settings')).toBe(true);
  });

  test('infrastructure kinds outside SYNC_CATEGORIES are always enabled', () => {
    setSettings({
      syncCategories: { progress: false } as Partial<Record<SyncCategory, boolean>>,
    });
    expect(isSyncCategoryEnabled('font_metadata')).toBe(true); // unknown id
  });

  describe('isSyncCategoryLocked', () => {
    test('returns false for categories with no dependents', () => {
      expect(isSyncCategoryLocked('book')).toBe(false);
      expect(isSyncCategoryLocked('font')).toBe(false);
    });

    test('returns false for `settings` when dictionary is disabled', () => {
      setSettings({
        syncCategories: { dictionary: false } as Partial<Record<SyncCategory, boolean>>,
      });
      expect(isSyncCategoryLocked('settings')).toBe(false);
    });

    test('returns true for `settings` when dictionary is enabled', () => {
      setSettings({
        syncCategories: { dictionary: true } as Partial<Record<SyncCategory, boolean>>,
      });
      expect(isSyncCategoryLocked('settings')).toBe(true);
    });

    test('returns true for `settings` when dictionary defaults to enabled (no map)', () => {
      setSettings({});
      expect(isSyncCategoryLocked('settings')).toBe(true);
    });
  });

  test('legacy SyncType ids map to categories (configs → progress, books → book, notes → note)', () => {
    setSettings({ syncCategories: { progress: false, book: false, note: false } });
    expect(isSyncCategoryEnabled('configs')).toBe(false);
    expect(isSyncCategoryEnabled('config')).toBe(false);
    expect(isSyncCategoryEnabled('books')).toBe(false);
    expect(isSyncCategoryEnabled('notes')).toBe(false);
  });
});

describe('SYNC_CATEGORIES', () => {
  test('covers all eight user-facing categories (incl. settings)', () => {
    expect([...SYNC_CATEGORIES].sort()).toEqual(
      [
        'book',
        'dictionary',
        'font',
        'note',
        'opds_catalog',
        'progress',
        'settings',
        'texture',
      ].sort(),
    );
  });
});
