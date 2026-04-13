import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('@/i18n/i18n', () => ({
  default: {
    changeLanguage: vi.fn(),
  },
}));

vi.mock('@/utils/time', () => ({
  initDayjs: vi.fn(),
}));

import i18n from '@/i18n/i18n';
import { initDayjs } from '@/utils/time';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

const mockChangeLanguage = vi.mocked(i18n.changeLanguage);
const mockInitDayjs = vi.mocked(initDayjs);

function makeSettings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  return {
    version: 1,
    localBooksDir: '/books',
    keepLogin: false,
    autoUpload: false,
    alwaysOnTop: false,
    openBookInNewWindow: false,
    autoCheckUpdates: true,
    screenWakeLock: false,
    screenBrightness: 1,
    autoScreenBrightness: true,
    alwaysShowStatusBar: false,
    alwaysInForeground: false,
    openLastBooks: false,
    lastOpenBooks: [],
    autoImportBooksOnOpen: false,
    savedBookCoverForLockScreen: '',
    savedBookCoverForLockScreenPath: '',
    telemetryEnabled: false,
    discordRichPresenceEnabled: false,
    libraryViewMode: 'grid',
    librarySortBy: 'updated',
    librarySortAscending: false,
    libraryGroupBy: 'none',
    libraryCoverFit: 'crop',
    libraryAutoColumns: true,
    libraryColumns: 4,
    customFonts: [],
    customTextures: [],
    opdsCatalogs: [],
    metadataSeriesCollapsed: false,
    metadataOthersCollapsed: false,
    metadataDescriptionCollapsed: false,
    lastSyncedAtBooks: 0,
    lastSyncedAtConfigs: 0,
    lastSyncedAtNotes: 0,
    migrationVersion: 0,
    ...overrides,
  } as SystemSettings;
}

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: {} as SystemSettings,
      settingsDialogBookKey: '',
      isSettingsDialogOpen: false,
      fontPanelView: 'main-fonts',
      activeSettingsItemId: null,
    });
    vi.clearAllMocks();
  });

  describe('setSettings', () => {
    test('sets the settings object', () => {
      const settings = makeSettings({ version: 42 });
      useSettingsStore.getState().setSettings(settings);

      expect(useSettingsStore.getState().settings.version).toBe(42);
    });

    test('replaces previous settings entirely', () => {
      const settings1 = makeSettings({ localBooksDir: '/old' });
      const settings2 = makeSettings({ localBooksDir: '/new' });

      useSettingsStore.getState().setSettings(settings1);
      useSettingsStore.getState().setSettings(settings2);

      expect(useSettingsStore.getState().settings.localBooksDir).toBe('/new');
    });
  });

  describe('setSettingsDialogBookKey', () => {
    test('sets the dialog book key', () => {
      useSettingsStore.getState().setSettingsDialogBookKey('book-key-123');
      expect(useSettingsStore.getState().settingsDialogBookKey).toBe('book-key-123');
    });

    test('can set to empty string', () => {
      useSettingsStore.getState().setSettingsDialogBookKey('some-key');
      useSettingsStore.getState().setSettingsDialogBookKey('');
      expect(useSettingsStore.getState().settingsDialogBookKey).toBe('');
    });
  });

  describe('setSettingsDialogOpen', () => {
    test('opens the settings dialog', () => {
      useSettingsStore.getState().setSettingsDialogOpen(true);
      expect(useSettingsStore.getState().isSettingsDialogOpen).toBe(true);
    });

    test('closes the settings dialog', () => {
      useSettingsStore.getState().setSettingsDialogOpen(true);
      useSettingsStore.getState().setSettingsDialogOpen(false);
      expect(useSettingsStore.getState().isSettingsDialogOpen).toBe(false);
    });
  });

  describe('setFontPanelView', () => {
    test('sets to main-fonts', () => {
      useSettingsStore.getState().setFontPanelView('main-fonts');
      expect(useSettingsStore.getState().fontPanelView).toBe('main-fonts');
    });

    test('sets to custom-fonts', () => {
      useSettingsStore.getState().setFontPanelView('custom-fonts');
      expect(useSettingsStore.getState().fontPanelView).toBe('custom-fonts');
    });

    test('switches between views', () => {
      useSettingsStore.getState().setFontPanelView('custom-fonts');
      expect(useSettingsStore.getState().fontPanelView).toBe('custom-fonts');

      useSettingsStore.getState().setFontPanelView('main-fonts');
      expect(useSettingsStore.getState().fontPanelView).toBe('main-fonts');
    });
  });

  describe('setActiveSettingsItemId', () => {
    test('sets the active item id', () => {
      useSettingsStore.getState().setActiveSettingsItemId('item-1');
      expect(useSettingsStore.getState().activeSettingsItemId).toBe('item-1');
    });

    test('sets to null to clear', () => {
      useSettingsStore.getState().setActiveSettingsItemId('item-1');
      useSettingsStore.getState().setActiveSettingsItemId(null);
      expect(useSettingsStore.getState().activeSettingsItemId).toBeNull();
    });
  });

  describe('applyUILanguage', () => {
    test('applies specified language', () => {
      useSettingsStore.getState().applyUILanguage('fr');

      expect(mockChangeLanguage).toHaveBeenCalledWith('fr');
      expect(mockInitDayjs).toHaveBeenCalledWith('fr');
    });

    test('falls back to navigator.language when no language provided', () => {
      const expectedLocale = navigator.language;
      useSettingsStore.getState().applyUILanguage();

      expect(mockChangeLanguage).toHaveBeenCalledWith(expectedLocale);
      expect(mockInitDayjs).toHaveBeenCalledWith(expectedLocale);
    });

    test('falls back to navigator.language when undefined is passed', () => {
      const expectedLocale = navigator.language;
      useSettingsStore.getState().applyUILanguage(undefined);

      expect(mockChangeLanguage).toHaveBeenCalledWith(expectedLocale);
      expect(mockInitDayjs).toHaveBeenCalledWith(expectedLocale);
    });

    test('applies empty string language by falling back to navigator.language', () => {
      // Empty string is falsy, so it should fall back to navigator.language
      const expectedLocale = navigator.language;
      useSettingsStore.getState().applyUILanguage('');

      expect(mockChangeLanguage).toHaveBeenCalledWith(expectedLocale);
      expect(mockInitDayjs).toHaveBeenCalledWith(expectedLocale);
    });

    test('applies various locale codes', () => {
      for (const locale of ['en-US', 'zh-CN', 'ja', 'de-DE']) {
        vi.clearAllMocks();
        useSettingsStore.getState().applyUILanguage(locale);
        expect(mockChangeLanguage).toHaveBeenCalledWith(locale);
        expect(mockInitDayjs).toHaveBeenCalledWith(locale);
      }
    });
  });
});
