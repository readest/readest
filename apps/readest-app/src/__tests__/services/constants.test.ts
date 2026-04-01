import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/config', () => ({
  getDefaultMaxBlockSize: vi.fn(() => 1600),
  getDefaultMaxInlineSize: vi.fn(() => 720),
}));
vi.mock('@/utils/misc', () => ({
  stubTranslation: vi.fn((key: string) => key),
  getOSPlatform: vi.fn(() => 'macos'),
}));

import {
  DATA_SUBDIR,
  LOCAL_BOOKS_SUBDIR,
  CLOUD_BOOKS_SUBDIR,
  LOCAL_FONTS_SUBDIR,
  LOCAL_IMAGES_SUBDIR,
  SETTINGS_FILENAME,
  SUPPORTED_BOOK_EXTS,
  BOOK_ACCEPT_FORMATS,
  BOOK_UNGROUPED_NAME,
  BOOK_UNGROUPED_ID,
  SUPPORTED_IMAGE_EXTS,
  IMAGE_ACCEPT_FORMATS,
  DEFAULT_KOSYNC_SETTINGS,
  READWISE_API_BASE_URL,
  DEFAULT_READWISE_SETTINGS,
  DEFAULT_SYSTEM_SETTINGS,
  DEFAULT_MOBILE_SYSTEM_SETTINGS,
  HIGHLIGHT_COLOR_HEX,
  READING_RULER_COLORS,
  DEFAULT_READSETTINGS,
  DEFAULT_MOBILE_READSETTINGS,
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_BOOK_STYLE,
  DEFAULT_MOBILE_VIEW_SETTINGS,
  DEFAULT_CJK_VIEW_SETTINGS,
  DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS,
  DEFAULT_EINK_VIEW_SETTINGS,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_NOTE_EXPORT_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
  DEFAULT_PARAGRAPH_MODE_CONFIG,
  DEFAULT_BOOK_SEARCH_CONFIG,
  SYSTEM_SETTINGS_VERSION,
  SERIF_FONTS,
  NON_FREE_FONTS,
  CJK_SERIF_FONTS,
  CJK_SANS_SERIF_FONTS,
  SANS_SERIF_FONTS,
  MONOSPACE_FONTS,
  FALLBACK_FONTS,
  WINDOWS_FONTS,
  MACOS_FONTS,
  LINUX_FONTS,
  IOS_FONTS,
  ANDROID_FONTS,
  CJK_EXCLUDE_PATTENS,
  CJK_FONTS_PATTENS,
  BOOK_IDS_SEPARATOR,
  DOWNLOAD_READEST_URL,
  READEST_WEB_BASE_URL,
  READEST_NODE_BASE_URL,
  READEST_UPDATER_FILE,
  READEST_CHANGELOG_FILE,
  READEST_PUBLIC_STORAGE_BASE_URL,
  READEST_OPDS_USER_AGENT,
  SYNC_PROGRESS_INTERVAL_SEC,
  SYNC_NOTES_INTERVAL_SEC,
  SYNC_BOOKS_INTERVAL_SEC,
  CHECK_UPDATE_INTERVAL_SEC,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  ZOOM_STEP,
  SHOW_UNREAD_STATUS_BADGE,
  DEFAULT_STORAGE_QUOTA,
  DEFAULT_DAILY_TRANSLATION_QUOTA,
  DOUBLE_CLICK_INTERVAL_THRESHOLD_MS,
  DISABLE_DOUBLE_CLICK_ON_MOBILE,
  LONG_HOLD_THRESHOLD,
  SIZE_PER_LOC,
  SIZE_PER_TIME_UNIT,
  CUSTOM_THEME_TEMPLATES,
  MIGHT_BE_RTL_LANGS,
  TRANSLATED_LANGS,
  TRANSLATOR_LANGS,
  SUPPORTED_LANGS,
  SUPPORTED_LANGNAMES,
} from '@/services/constants';

describe('services/constants', () => {
  // ---------------------------------------------------------------------------
  // Directory & filename constants
  // ---------------------------------------------------------------------------
  describe('directory and filename constants', () => {
    it('DATA_SUBDIR is a non-empty string', () => {
      expect(typeof DATA_SUBDIR).toBe('string');
      expect(DATA_SUBDIR.length).toBeGreaterThan(0);
    });

    it('LOCAL_BOOKS_SUBDIR contains DATA_SUBDIR', () => {
      expect(LOCAL_BOOKS_SUBDIR).toContain(DATA_SUBDIR);
    });

    it('CLOUD_BOOKS_SUBDIR contains DATA_SUBDIR', () => {
      expect(CLOUD_BOOKS_SUBDIR).toContain(DATA_SUBDIR);
    });

    it('LOCAL_FONTS_SUBDIR contains DATA_SUBDIR', () => {
      expect(LOCAL_FONTS_SUBDIR).toContain(DATA_SUBDIR);
    });

    it('LOCAL_IMAGES_SUBDIR contains DATA_SUBDIR', () => {
      expect(LOCAL_IMAGES_SUBDIR).toContain(DATA_SUBDIR);
    });

    it('SETTINGS_FILENAME ends with .json', () => {
      expect(SETTINGS_FILENAME).toMatch(/\.json$/);
    });
  });

  // ---------------------------------------------------------------------------
  // Book formats
  // ---------------------------------------------------------------------------
  describe('book format constants', () => {
    it('SUPPORTED_BOOK_EXTS is a non-empty array of strings', () => {
      expect(Array.isArray(SUPPORTED_BOOK_EXTS)).toBe(true);
      expect(SUPPORTED_BOOK_EXTS.length).toBeGreaterThan(0);
      for (const ext of SUPPORTED_BOOK_EXTS) {
        expect(typeof ext).toBe('string');
      }
    });

    it('SUPPORTED_BOOK_EXTS includes common formats', () => {
      expect(SUPPORTED_BOOK_EXTS).toContain('epub');
      expect(SUPPORTED_BOOK_EXTS).toContain('pdf');
      expect(SUPPORTED_BOOK_EXTS).toContain('mobi');
      expect(SUPPORTED_BOOK_EXTS).toContain('txt');
    });

    it('BOOK_ACCEPT_FORMATS is a comma-separated string of dotted extensions', () => {
      expect(typeof BOOK_ACCEPT_FORMATS).toBe('string');
      expect(BOOK_ACCEPT_FORMATS).toContain('.epub');
      expect(BOOK_ACCEPT_FORMATS).toContain('.pdf');
      expect(BOOK_ACCEPT_FORMATS.split(', ').length).toBe(SUPPORTED_BOOK_EXTS.length);
    });

    it('BOOK_UNGROUPED_NAME and BOOK_UNGROUPED_ID are empty strings', () => {
      expect(BOOK_UNGROUPED_NAME).toBe('');
      expect(BOOK_UNGROUPED_ID).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // Image formats
  // ---------------------------------------------------------------------------
  describe('image format constants', () => {
    it('SUPPORTED_IMAGE_EXTS is a non-empty array', () => {
      expect(Array.isArray(SUPPORTED_IMAGE_EXTS)).toBe(true);
      expect(SUPPORTED_IMAGE_EXTS.length).toBeGreaterThan(0);
      expect(SUPPORTED_IMAGE_EXTS).toContain('png');
      expect(SUPPORTED_IMAGE_EXTS).toContain('jpg');
    });

    it('IMAGE_ACCEPT_FORMATS corresponds to SUPPORTED_IMAGE_EXTS', () => {
      expect(typeof IMAGE_ACCEPT_FORMATS).toBe('string');
      expect(IMAGE_ACCEPT_FORMATS.split(', ').length).toBe(SUPPORTED_IMAGE_EXTS.length);
    });
  });

  // ---------------------------------------------------------------------------
  // KOSync settings
  // ---------------------------------------------------------------------------
  describe('DEFAULT_KOSYNC_SETTINGS', () => {
    it('is an object with required properties', () => {
      expect(typeof DEFAULT_KOSYNC_SETTINGS).toBe('object');
      expect(DEFAULT_KOSYNC_SETTINGS).not.toBeNull();
    });

    it('has expected keys with correct types', () => {
      expect(typeof DEFAULT_KOSYNC_SETTINGS.serverUrl).toBe('string');
      expect(DEFAULT_KOSYNC_SETTINGS.serverUrl).toMatch(/^https?:\/\//);
      expect(typeof DEFAULT_KOSYNC_SETTINGS.username).toBe('string');
      expect(typeof DEFAULT_KOSYNC_SETTINGS.userkey).toBe('string');
      expect(typeof DEFAULT_KOSYNC_SETTINGS.deviceId).toBe('string');
      expect(typeof DEFAULT_KOSYNC_SETTINGS.deviceName).toBe('string');
      expect(typeof DEFAULT_KOSYNC_SETTINGS.checksumMethod).toBe('string');
      expect(typeof DEFAULT_KOSYNC_SETTINGS.strategy).toBe('string');
      expect(typeof DEFAULT_KOSYNC_SETTINGS.enabled).toBe('boolean');
      expect(DEFAULT_KOSYNC_SETTINGS.enabled).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Readwise settings
  // ---------------------------------------------------------------------------
  describe('Readwise constants', () => {
    it('READWISE_API_BASE_URL is a valid URL string', () => {
      expect(typeof READWISE_API_BASE_URL).toBe('string');
      expect(READWISE_API_BASE_URL).toMatch(/^https:\/\//);
    });

    it('DEFAULT_READWISE_SETTINGS has expected structure', () => {
      expect(typeof DEFAULT_READWISE_SETTINGS).toBe('object');
      expect(DEFAULT_READWISE_SETTINGS.enabled).toBe(false);
      expect(typeof DEFAULT_READWISE_SETTINGS.accessToken).toBe('string');
      expect(typeof DEFAULT_READWISE_SETTINGS.lastSyncedAt).toBe('number');
    });
  });

  // ---------------------------------------------------------------------------
  // System settings
  // ---------------------------------------------------------------------------
  describe('DEFAULT_SYSTEM_SETTINGS', () => {
    it('is a non-null object', () => {
      expect(typeof DEFAULT_SYSTEM_SETTINGS).toBe('object');
      expect(DEFAULT_SYSTEM_SETTINGS).not.toBeNull();
    });

    it('has boolean flags', () => {
      expect(typeof DEFAULT_SYSTEM_SETTINGS.keepLogin).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.autoUpload).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.alwaysOnTop).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.openBookInNewWindow).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.alwaysShowStatusBar).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.alwaysInForeground).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.autoCheckUpdates).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.screenWakeLock).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.openLastBooks).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.autoImportBooksOnOpen).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.telemetryEnabled).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.discordRichPresenceEnabled).toBe('boolean');
    });

    it('has screen brightness in valid range', () => {
      expect(typeof DEFAULT_SYSTEM_SETTINGS.screenBrightness).toBe('number');
      expect(DEFAULT_SYSTEM_SETTINGS.screenBrightness!).toBeGreaterThanOrEqual(-1);
      expect(DEFAULT_SYSTEM_SETTINGS.screenBrightness!).toBeLessThanOrEqual(100);
    });

    it('has library settings', () => {
      expect(DEFAULT_SYSTEM_SETTINGS.libraryViewMode).toBe('grid');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.librarySortBy).toBe('string');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.librarySortAscending).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.libraryGroupBy).toBe('string');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.libraryCoverFit).toBe('string');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.libraryAutoColumns).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.libraryColumns).toBe('number');
    });

    it('has metadata collapse settings', () => {
      expect(typeof DEFAULT_SYSTEM_SETTINGS.metadataSeriesCollapsed).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.metadataOthersCollapsed).toBe('boolean');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.metadataDescriptionCollapsed).toBe('boolean');
    });

    it('has nested settings objects', () => {
      expect(DEFAULT_SYSTEM_SETTINGS.kosync).toBeDefined();
      expect(DEFAULT_SYSTEM_SETTINGS.readwise).toBeDefined();
      expect(DEFAULT_SYSTEM_SETTINGS.aiSettings).toBeDefined();
    });

    it('has sync timestamps', () => {
      expect(typeof DEFAULT_SYSTEM_SETTINGS.lastSyncedAtBooks).toBe('number');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.lastSyncedAtConfigs).toBe('number');
      expect(typeof DEFAULT_SYSTEM_SETTINGS.lastSyncedAtNotes).toBe('number');
    });

    it('lastOpenBooks is an empty array', () => {
      expect(Array.isArray(DEFAULT_SYSTEM_SETTINGS.lastOpenBooks)).toBe(true);
      expect(DEFAULT_SYSTEM_SETTINGS.lastOpenBooks!.length).toBe(0);
    });
  });

  describe('DEFAULT_MOBILE_SYSTEM_SETTINGS', () => {
    it('is an object with libraryColumns', () => {
      expect(typeof DEFAULT_MOBILE_SYSTEM_SETTINGS).toBe('object');
      expect(typeof DEFAULT_MOBILE_SYSTEM_SETTINGS.libraryColumns).toBe('number');
      expect(DEFAULT_MOBILE_SYSTEM_SETTINGS.libraryColumns).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Highlight colors
  // ---------------------------------------------------------------------------
  describe('HIGHLIGHT_COLOR_HEX', () => {
    it('is a record with expected color keys', () => {
      expect(typeof HIGHLIGHT_COLOR_HEX).toBe('object');
      const keys = Object.keys(HIGHLIGHT_COLOR_HEX);
      expect(keys).toContain('red');
      expect(keys).toContain('yellow');
      expect(keys).toContain('green');
      expect(keys).toContain('blue');
      expect(keys).toContain('violet');
    });

    it('all values are hex color strings', () => {
      for (const value of Object.values(HIGHLIGHT_COLOR_HEX)) {
        expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });
  });

  describe('READING_RULER_COLORS', () => {
    it('has expected keys', () => {
      const keys = Object.keys(READING_RULER_COLORS);
      expect(keys).toContain('transparent');
      expect(keys).toContain('yellow');
      expect(keys).toContain('green');
      expect(keys).toContain('blue');
      expect(keys).toContain('rose');
    });

    it('all values are hex color strings', () => {
      for (const value of Object.values(READING_RULER_COLORS)) {
        expect(value).toMatch(/^#[0-9a-fA-F]{6,8}$/);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Read settings
  // ---------------------------------------------------------------------------
  describe('DEFAULT_READSETTINGS', () => {
    it('is a non-null object', () => {
      expect(typeof DEFAULT_READSETTINGS).toBe('object');
      expect(DEFAULT_READSETTINGS).not.toBeNull();
    });

    it('has sidebar and notebook settings', () => {
      expect(typeof DEFAULT_READSETTINGS.sideBarWidth).toBe('string');
      expect(typeof DEFAULT_READSETTINGS.isSideBarPinned).toBe('boolean');
      expect(typeof DEFAULT_READSETTINGS.notebookWidth).toBe('string');
      expect(typeof DEFAULT_READSETTINGS.isNotebookPinned).toBe('boolean');
      expect(typeof DEFAULT_READSETTINGS.notebookActiveTab).toBe('string');
    });

    it('has cursor and translation settings', () => {
      expect(typeof DEFAULT_READSETTINGS.autohideCursor).toBe('boolean');
      expect(typeof DEFAULT_READSETTINGS.translationProvider).toBe('string');
      expect(typeof DEFAULT_READSETTINGS.translateTargetLang).toBe('string');
    });

    it('has highlight settings', () => {
      expect(typeof DEFAULT_READSETTINGS.highlightStyle).toBe('string');
      expect(typeof DEFAULT_READSETTINGS.highlightStyles).toBe('object');
      expect(typeof DEFAULT_READSETTINGS.customHighlightColors).toBe('object');
      expect(Array.isArray(DEFAULT_READSETTINGS.userHighlightColors)).toBe(true);
      expect(Array.isArray(DEFAULT_READSETTINGS.customTtsHighlightColors)).toBe(true);
    });

    it('has custom themes as an array', () => {
      expect(Array.isArray(DEFAULT_READSETTINGS.customThemes)).toBe(true);
    });
  });

  describe('DEFAULT_MOBILE_READSETTINGS', () => {
    it('is a partial object with expected overrides', () => {
      expect(typeof DEFAULT_MOBILE_READSETTINGS).toBe('object');
      expect(typeof DEFAULT_MOBILE_READSETTINGS.sideBarWidth).toBe('string');
      expect(DEFAULT_MOBILE_READSETTINGS.isSideBarPinned).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Book font
  // ---------------------------------------------------------------------------
  describe('DEFAULT_BOOK_FONT', () => {
    it('has all font properties', () => {
      expect(typeof DEFAULT_BOOK_FONT.serifFont).toBe('string');
      expect(typeof DEFAULT_BOOK_FONT.sansSerifFont).toBe('string');
      expect(typeof DEFAULT_BOOK_FONT.monospaceFont).toBe('string');
      expect(typeof DEFAULT_BOOK_FONT.defaultFont).toBe('string');
      expect(typeof DEFAULT_BOOK_FONT.defaultCJKFont).toBe('string');
    });

    it('has reasonable font size defaults', () => {
      expect(DEFAULT_BOOK_FONT.defaultFontSize).toBeGreaterThanOrEqual(8);
      expect(DEFAULT_BOOK_FONT.defaultFontSize).toBeLessThanOrEqual(72);
      expect(DEFAULT_BOOK_FONT.minimumFontSize).toBeGreaterThanOrEqual(1);
      expect(DEFAULT_BOOK_FONT.minimumFontSize).toBeLessThanOrEqual(
        DEFAULT_BOOK_FONT.defaultFontSize,
      );
    });

    it('has a valid font weight', () => {
      expect(DEFAULT_BOOK_FONT.fontWeight).toBeGreaterThanOrEqual(100);
      expect(DEFAULT_BOOK_FONT.fontWeight).toBeLessThanOrEqual(900);
    });
  });

  // ---------------------------------------------------------------------------
  // Book layout
  // ---------------------------------------------------------------------------
  describe('DEFAULT_BOOK_LAYOUT', () => {
    it('has margin properties as positive numbers', () => {
      expect(DEFAULT_BOOK_LAYOUT.marginTopPx).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_BOOK_LAYOUT.marginBottomPx).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_BOOK_LAYOUT.marginLeftPx).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_BOOK_LAYOUT.marginRightPx).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_BOOK_LAYOUT.compactMarginTopPx).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_BOOK_LAYOUT.compactMarginBottomPx).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_BOOK_LAYOUT.compactMarginLeftPx).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_BOOK_LAYOUT.compactMarginRightPx).toBeGreaterThanOrEqual(0);
    });

    it('has gap percent in a reasonable range', () => {
      expect(DEFAULT_BOOK_LAYOUT.gapPercent).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_BOOK_LAYOUT.gapPercent).toBeLessThanOrEqual(100);
    });

    it('has boolean layout flags', () => {
      expect(typeof DEFAULT_BOOK_LAYOUT.scrolled).toBe('boolean');
      expect(typeof DEFAULT_BOOK_LAYOUT.noContinuousScroll).toBe('boolean');
      expect(typeof DEFAULT_BOOK_LAYOUT.disableClick).toBe('boolean');
      expect(typeof DEFAULT_BOOK_LAYOUT.fullscreenClickArea).toBe('boolean');
      expect(typeof DEFAULT_BOOK_LAYOUT.swapClickArea).toBe('boolean');
      expect(typeof DEFAULT_BOOK_LAYOUT.disableDoubleClick).toBe('boolean');
      expect(typeof DEFAULT_BOOK_LAYOUT.volumeKeysToFlip).toBe('boolean');
      expect(typeof DEFAULT_BOOK_LAYOUT.vertical).toBe('boolean');
      expect(typeof DEFAULT_BOOK_LAYOUT.rtl).toBe('boolean');
      expect(typeof DEFAULT_BOOK_LAYOUT.allowScript).toBe('boolean');
      expect(typeof DEFAULT_BOOK_LAYOUT.hideScrollbar).toBe('boolean');
    });

    it('has maxColumnCount as a positive number', () => {
      expect(DEFAULT_BOOK_LAYOUT.maxColumnCount).toBeGreaterThanOrEqual(1);
    });

    it('has maxInlineSize and maxBlockSize from mocked config', () => {
      expect(DEFAULT_BOOK_LAYOUT.maxInlineSize).toBe(720);
      expect(DEFAULT_BOOK_LAYOUT.maxBlockSize).toBe(1600);
    });

    it('has writingMode as a string', () => {
      expect(typeof DEFAULT_BOOK_LAYOUT.writingMode).toBe('string');
    });

    it('has scrollingOverlap as a number', () => {
      expect(typeof DEFAULT_BOOK_LAYOUT.scrollingOverlap).toBe('number');
    });
  });

  // ---------------------------------------------------------------------------
  // Book language
  // ---------------------------------------------------------------------------
  describe('DEFAULT_BOOK_LANGUAGE', () => {
    it('has expected properties', () => {
      expect(typeof DEFAULT_BOOK_LANGUAGE.replaceQuotationMarks).toBe('boolean');
      expect(typeof DEFAULT_BOOK_LANGUAGE.convertChineseVariant).toBe('string');
    });
  });

  // ---------------------------------------------------------------------------
  // Book style
  // ---------------------------------------------------------------------------
  describe('DEFAULT_BOOK_STYLE', () => {
    it('is a non-null object', () => {
      expect(typeof DEFAULT_BOOK_STYLE).toBe('object');
      expect(DEFAULT_BOOK_STYLE).not.toBeNull();
    });

    it('has zoom level in valid range', () => {
      expect(DEFAULT_BOOK_STYLE.zoomLevel).toBeGreaterThanOrEqual(MIN_ZOOM_LEVEL);
      expect(DEFAULT_BOOK_STYLE.zoomLevel).toBeLessThanOrEqual(MAX_ZOOM_LEVEL);
    });

    it('has typography settings', () => {
      expect(typeof DEFAULT_BOOK_STYLE.paragraphMargin).toBe('number');
      expect(DEFAULT_BOOK_STYLE.lineHeight).toBeGreaterThan(0);
      expect(typeof DEFAULT_BOOK_STYLE.wordSpacing).toBe('number');
      expect(typeof DEFAULT_BOOK_STYLE.letterSpacing).toBe('number');
      expect(typeof DEFAULT_BOOK_STYLE.textIndent).toBe('number');
    });

    it('has boolean style flags', () => {
      expect(typeof DEFAULT_BOOK_STYLE.fullJustification).toBe('boolean');
      expect(typeof DEFAULT_BOOK_STYLE.hyphenation).toBe('boolean');
      expect(typeof DEFAULT_BOOK_STYLE.invertImgColorInDark).toBe('boolean');
      expect(typeof DEFAULT_BOOK_STYLE.overrideFont).toBe('boolean');
      expect(typeof DEFAULT_BOOK_STYLE.overrideLayout).toBe('boolean');
      expect(typeof DEFAULT_BOOK_STYLE.overrideColor).toBe('boolean');
      expect(typeof DEFAULT_BOOK_STYLE.codeHighlighting).toBe('boolean');
      expect(typeof DEFAULT_BOOK_STYLE.keepCoverSpread).toBe('boolean');
    });

    it('has theme and appearance settings', () => {
      expect(typeof DEFAULT_BOOK_STYLE.theme).toBe('string');
      expect(typeof DEFAULT_BOOK_STYLE.backgroundTextureId).toBe('string');
      expect(typeof DEFAULT_BOOK_STYLE.backgroundOpacity).toBe('number');
      expect(DEFAULT_BOOK_STYLE.backgroundOpacity).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_BOOK_STYLE.backgroundOpacity).toBeLessThanOrEqual(1);
      expect(typeof DEFAULT_BOOK_STYLE.backgroundSize).toBe('string');
      expect(typeof DEFAULT_BOOK_STYLE.highlightOpacity).toBe('number');
      expect(DEFAULT_BOOK_STYLE.highlightOpacity).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_BOOK_STYLE.highlightOpacity).toBeLessThanOrEqual(1);
    });

    it('has code language setting', () => {
      expect(typeof DEFAULT_BOOK_STYLE.codeLanguage).toBe('string');
    });

    it('has user stylesheet strings', () => {
      expect(typeof DEFAULT_BOOK_STYLE.userStylesheet).toBe('string');
      expect(typeof DEFAULT_BOOK_STYLE.userUIStylesheet).toBe('string');
    });

    it('has PDF-specific settings', () => {
      expect(typeof DEFAULT_BOOK_STYLE.zoomMode).toBe('string');
      expect(typeof DEFAULT_BOOK_STYLE.spreadMode).toBe('string');
    });
  });

  // ---------------------------------------------------------------------------
  // View settings overrides (mobile, CJK, fixed layout, eink)
  // ---------------------------------------------------------------------------
  describe('view settings overrides', () => {
    it('DEFAULT_MOBILE_VIEW_SETTINGS has expected overrides', () => {
      expect(typeof DEFAULT_MOBILE_VIEW_SETTINGS).toBe('object');
      expect(DEFAULT_MOBILE_VIEW_SETTINGS.fullJustification).toBe(false);
      expect(DEFAULT_MOBILE_VIEW_SETTINGS.animated).toBe(true);
      expect(typeof DEFAULT_MOBILE_VIEW_SETTINGS.defaultFont).toBe('string');
      expect(typeof DEFAULT_MOBILE_VIEW_SETTINGS.marginBottomPx).toBe('number');
      expect(DEFAULT_MOBILE_VIEW_SETTINGS.disableDoubleClick).toBe(true);
      expect(typeof DEFAULT_MOBILE_VIEW_SETTINGS.spreadMode).toBe('string');
    });

    it('DEFAULT_CJK_VIEW_SETTINGS has CJK typography overrides', () => {
      expect(typeof DEFAULT_CJK_VIEW_SETTINGS).toBe('object');
      expect(DEFAULT_CJK_VIEW_SETTINGS.fullJustification).toBe(true);
      expect(typeof DEFAULT_CJK_VIEW_SETTINGS.textIndent).toBe('number');
      expect(typeof DEFAULT_CJK_VIEW_SETTINGS.paragraphMargin).toBe('number');
      expect(typeof DEFAULT_CJK_VIEW_SETTINGS.lineHeight).toBe('number');
      expect(DEFAULT_CJK_VIEW_SETTINGS.lineHeight!).toBeGreaterThan(0);
    });

    it('DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS has overrideColor set', () => {
      expect(typeof DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS).toBe('object');
      expect(DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS.overrideColor).toBe(false);
    });

    it('DEFAULT_EINK_VIEW_SETTINGS has eink properties', () => {
      expect(typeof DEFAULT_EINK_VIEW_SETTINGS).toBe('object');
      expect(DEFAULT_EINK_VIEW_SETTINGS.isEink).toBe(true);
      expect(DEFAULT_EINK_VIEW_SETTINGS.animated).toBe(false);
      expect(DEFAULT_EINK_VIEW_SETTINGS.volumeKeysToFlip).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // View config
  // ---------------------------------------------------------------------------
  describe('DEFAULT_VIEW_CONFIG', () => {
    it('is a non-null object', () => {
      expect(typeof DEFAULT_VIEW_CONFIG).toBe('object');
      expect(DEFAULT_VIEW_CONFIG).not.toBeNull();
    });

    it('has sidebar tab as a string', () => {
      expect(typeof DEFAULT_VIEW_CONFIG.sideBarTab).toBe('string');
    });

    it('has boolean display flags', () => {
      expect(typeof DEFAULT_VIEW_CONFIG.showHeader).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.showFooter).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.showBarsOnScroll).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.showRemainingTime).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.showRemainingPages).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.showProgressInfo).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.showCurrentTime).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.showCurrentBatteryStatus).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.showBatteryPercentage).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.use24HourClock).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.tapToToggleFooter).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.showMarginsOnScroll).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.showPaginationButtons).toBe('boolean');
    });

    it('has progress style settings', () => {
      expect(typeof DEFAULT_VIEW_CONFIG.progressStyle).toBe('string');
      expect(typeof DEFAULT_VIEW_CONFIG.progressInfoMode).toBe('string');
    });

    it('has animation and eink flags', () => {
      expect(typeof DEFAULT_VIEW_CONFIG.animated).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.isEink).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.isColorEink).toBe('boolean');
    });

    it('has reading ruler settings', () => {
      expect(typeof DEFAULT_VIEW_CONFIG.readingRulerEnabled).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.readingRulerLines).toBe('number');
      expect(DEFAULT_VIEW_CONFIG.readingRulerLines).toBeGreaterThan(0);
      expect(typeof DEFAULT_VIEW_CONFIG.readingRulerPosition).toBe('number');
      expect(typeof DEFAULT_VIEW_CONFIG.readingRulerOpacity).toBe('number');
      expect(DEFAULT_VIEW_CONFIG.readingRulerOpacity).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_VIEW_CONFIG.readingRulerOpacity).toBeLessThanOrEqual(1);
      expect(typeof DEFAULT_VIEW_CONFIG.readingRulerColor).toBe('string');
    });

    it('has border settings', () => {
      expect(typeof DEFAULT_VIEW_CONFIG.doubleBorder).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.borderColor).toBe('string');
    });

    it('has sorted TOC and UI language', () => {
      expect(typeof DEFAULT_VIEW_CONFIG.sortedTOC).toBe('boolean');
      expect(typeof DEFAULT_VIEW_CONFIG.uiLanguage).toBe('string');
    });
  });

  // ---------------------------------------------------------------------------
  // TTS config
  // ---------------------------------------------------------------------------
  describe('DEFAULT_TTS_CONFIG', () => {
    it('has expected properties', () => {
      expect(typeof DEFAULT_TTS_CONFIG).toBe('object');
      expect(typeof DEFAULT_TTS_CONFIG.ttsRate).toBe('number');
      expect(DEFAULT_TTS_CONFIG.ttsRate).toBeGreaterThan(0);
      expect(typeof DEFAULT_TTS_CONFIG.ttsVoice).toBe('string');
      expect(typeof DEFAULT_TTS_CONFIG.ttsLocation).toBe('string');
      expect(typeof DEFAULT_TTS_CONFIG.showTTSBar).toBe('boolean');
      expect(typeof DEFAULT_TTS_CONFIG.ttsMediaMetadata).toBe('string');
    });

    it('has ttsHighlightOptions with style and color', () => {
      expect(typeof DEFAULT_TTS_CONFIG.ttsHighlightOptions).toBe('object');
      expect(typeof DEFAULT_TTS_CONFIG.ttsHighlightOptions.style).toBe('string');
      expect(typeof DEFAULT_TTS_CONFIG.ttsHighlightOptions.color).toBe('string');
    });
  });

  // ---------------------------------------------------------------------------
  // Translator config
  // ---------------------------------------------------------------------------
  describe('DEFAULT_TRANSLATOR_CONFIG', () => {
    it('has expected properties', () => {
      expect(typeof DEFAULT_TRANSLATOR_CONFIG).toBe('object');
      expect(typeof DEFAULT_TRANSLATOR_CONFIG.translationEnabled).toBe('boolean');
      expect(typeof DEFAULT_TRANSLATOR_CONFIG.translationProvider).toBe('string');
      expect(typeof DEFAULT_TRANSLATOR_CONFIG.translateTargetLang).toBe('string');
      expect(typeof DEFAULT_TRANSLATOR_CONFIG.showTranslateSource).toBe('boolean');
      expect(typeof DEFAULT_TRANSLATOR_CONFIG.ttsReadAloudText).toBe('string');
    });
  });

  // ---------------------------------------------------------------------------
  // Note export config
  // ---------------------------------------------------------------------------
  describe('DEFAULT_NOTE_EXPORT_CONFIG', () => {
    it('has all boolean include flags', () => {
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.includeTitle).toBe('boolean');
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.includeAuthor).toBe('boolean');
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.includeDate).toBe('boolean');
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.includeChapterTitles).toBe('boolean');
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.includeQuotes).toBe('boolean');
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.includeNotes).toBe('boolean');
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.includePageNumber).toBe('boolean');
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.includeTimestamp).toBe('boolean');
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.includeChapterSeparator).toBe('boolean');
    });

    it('has separator and template settings', () => {
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.noteSeparator).toBe('string');
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.useCustomTemplate).toBe('boolean');
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.customTemplate).toBe('string');
      expect(typeof DEFAULT_NOTE_EXPORT_CONFIG.exportAsPlainText).toBe('boolean');
    });
  });

  // ---------------------------------------------------------------------------
  // Annotator config
  // ---------------------------------------------------------------------------
  describe('DEFAULT_ANNOTATOR_CONFIG', () => {
    it('has expected structure', () => {
      expect(typeof DEFAULT_ANNOTATOR_CONFIG).toBe('object');
      expect(typeof DEFAULT_ANNOTATOR_CONFIG.enableAnnotationQuickActions).toBe('boolean');
      expect(DEFAULT_ANNOTATOR_CONFIG.annotationQuickAction).toBeNull();
      expect(typeof DEFAULT_ANNOTATOR_CONFIG.copyToNotebook).toBe('boolean');
      expect(DEFAULT_ANNOTATOR_CONFIG.noteExportConfig).toBeDefined();
      expect(DEFAULT_ANNOTATOR_CONFIG.noteExportConfig).toBe(DEFAULT_NOTE_EXPORT_CONFIG);
    });
  });

  // ---------------------------------------------------------------------------
  // Screen config
  // ---------------------------------------------------------------------------
  describe('DEFAULT_SCREEN_CONFIG', () => {
    it('has screen orientation', () => {
      expect(typeof DEFAULT_SCREEN_CONFIG).toBe('object');
      expect(typeof DEFAULT_SCREEN_CONFIG.screenOrientation).toBe('string');
    });
  });

  // ---------------------------------------------------------------------------
  // Paragraph mode config
  // ---------------------------------------------------------------------------
  describe('DEFAULT_PARAGRAPH_MODE_CONFIG', () => {
    it('has enabled flag set to false', () => {
      expect(typeof DEFAULT_PARAGRAPH_MODE_CONFIG).toBe('object');
      expect(DEFAULT_PARAGRAPH_MODE_CONFIG.enabled).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Book search config
  // ---------------------------------------------------------------------------
  describe('DEFAULT_BOOK_SEARCH_CONFIG', () => {
    it('has expected search options', () => {
      expect(typeof DEFAULT_BOOK_SEARCH_CONFIG).toBe('object');
      expect(typeof DEFAULT_BOOK_SEARCH_CONFIG.scope).toBe('string');
      expect(typeof DEFAULT_BOOK_SEARCH_CONFIG.matchCase).toBe('boolean');
      expect(typeof DEFAULT_BOOK_SEARCH_CONFIG.matchWholeWords).toBe('boolean');
      expect(typeof DEFAULT_BOOK_SEARCH_CONFIG.matchDiacritics).toBe('boolean');
    });
  });

  // ---------------------------------------------------------------------------
  // System settings version
  // ---------------------------------------------------------------------------
  describe('SYSTEM_SETTINGS_VERSION', () => {
    it('is a positive integer', () => {
      expect(typeof SYSTEM_SETTINGS_VERSION).toBe('number');
      expect(Number.isInteger(SYSTEM_SETTINGS_VERSION)).toBe(true);
      expect(SYSTEM_SETTINGS_VERSION).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Font arrays
  // ---------------------------------------------------------------------------
  describe('font arrays', () => {
    const fontArrays = [
      { name: 'SERIF_FONTS', value: SERIF_FONTS },
      { name: 'SANS_SERIF_FONTS', value: SANS_SERIF_FONTS },
      { name: 'MONOSPACE_FONTS', value: MONOSPACE_FONTS },
      { name: 'CJK_SERIF_FONTS', value: CJK_SERIF_FONTS },
      { name: 'CJK_SANS_SERIF_FONTS', value: CJK_SANS_SERIF_FONTS },
      { name: 'FALLBACK_FONTS', value: FALLBACK_FONTS },
      { name: 'NON_FREE_FONTS', value: NON_FREE_FONTS },
    ];

    for (const { name, value } of fontArrays) {
      it(`${name} is a non-empty array of strings`, () => {
        expect(Array.isArray(value)).toBe(true);
        expect(value.length).toBeGreaterThan(0);
        for (const font of value) {
          expect(typeof font).toBe('string');
          expect(font.length).toBeGreaterThan(0);
        }
      });
    }

    it('NON_FREE_FONTS is a subset of SERIF_FONTS', () => {
      for (const font of NON_FREE_FONTS) {
        expect(SERIF_FONTS).toContain(font);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Platform font arrays
  // ---------------------------------------------------------------------------
  describe('platform font arrays', () => {
    const platformFontArrays = [
      { name: 'WINDOWS_FONTS', value: WINDOWS_FONTS },
      { name: 'MACOS_FONTS', value: MACOS_FONTS },
      { name: 'LINUX_FONTS', value: LINUX_FONTS },
      { name: 'IOS_FONTS', value: IOS_FONTS },
      { name: 'ANDROID_FONTS', value: ANDROID_FONTS },
    ];

    for (const { name, value } of platformFontArrays) {
      it(`${name} is a non-empty array of strings`, () => {
        expect(Array.isArray(value)).toBe(true);
        expect(value.length).toBeGreaterThan(0);
        for (const font of value) {
          expect(typeof font).toBe('string');
          expect(font.length).toBeGreaterThan(0);
        }
      });
    }

    it('WINDOWS_FONTS has many entries', () => {
      expect(WINDOWS_FONTS.length).toBeGreaterThan(30);
    });

    it('MACOS_FONTS has many entries', () => {
      expect(MACOS_FONTS.length).toBeGreaterThan(30);
    });

    it('LINUX_FONTS has many entries', () => {
      expect(LINUX_FONTS.length).toBeGreaterThan(20);
    });
  });

  // ---------------------------------------------------------------------------
  // CJK regex patterns
  // ---------------------------------------------------------------------------
  describe('CJK regex patterns', () => {
    it('CJK_EXCLUDE_PATTENS is a RegExp', () => {
      expect(CJK_EXCLUDE_PATTENS).toBeInstanceOf(RegExp);
    });

    it('CJK_EXCLUDE_PATTENS matches known exclude terms', () => {
      expect(CJK_EXCLUDE_PATTENS.test('AlBayan')).toBe(true);
      expect(CJK_EXCLUDE_PATTENS.test('STIX')).toBe(true);
      expect(CJK_EXCLUDE_PATTENS.test('Myanmar')).toBe(true);
    });

    it('CJK_EXCLUDE_PATTENS is case-insensitive', () => {
      expect(CJK_EXCLUDE_PATTENS.flags).toContain('i');
    });

    it('CJK_FONTS_PATTENS is a RegExp', () => {
      expect(CJK_FONTS_PATTENS).toBeInstanceOf(RegExp);
    });

    it('CJK_FONTS_PATTENS matches CJK font names', () => {
      expect(CJK_FONTS_PATTENS.test('Noto Sans CJK SC')).toBe(true);
      expect(CJK_FONTS_PATTENS.test('PingFang SC')).toBe(true);
      expect(CJK_FONTS_PATTENS.test('Hiragino Sans')).toBe(true);
      expect(CJK_FONTS_PATTENS.test('Source Han Sans')).toBe(true);
    });

    it('CJK_FONTS_PATTENS is case-insensitive', () => {
      expect(CJK_FONTS_PATTENS.flags).toContain('i');
    });
  });

  // ---------------------------------------------------------------------------
  // URL constants
  // ---------------------------------------------------------------------------
  describe('URL constants', () => {
    it('BOOK_IDS_SEPARATOR is a single character', () => {
      expect(typeof BOOK_IDS_SEPARATOR).toBe('string');
      expect(BOOK_IDS_SEPARATOR.length).toBe(1);
    });

    it('DOWNLOAD_READEST_URL is a valid URL', () => {
      expect(DOWNLOAD_READEST_URL).toMatch(/^https:\/\//);
    });

    it('READEST_WEB_BASE_URL is a valid URL', () => {
      expect(READEST_WEB_BASE_URL).toMatch(/^https:\/\//);
    });

    it('READEST_NODE_BASE_URL is a valid URL', () => {
      expect(READEST_NODE_BASE_URL).toMatch(/^https:\/\//);
    });

    it('READEST_UPDATER_FILE is a URL ending with .json', () => {
      expect(READEST_UPDATER_FILE).toMatch(/^https:\/\//);
      expect(READEST_UPDATER_FILE).toMatch(/\.json$/);
    });

    it('READEST_CHANGELOG_FILE is a URL ending with .json', () => {
      expect(READEST_CHANGELOG_FILE).toMatch(/^https:\/\//);
      expect(READEST_CHANGELOG_FILE).toMatch(/\.json$/);
    });

    it('READEST_PUBLIC_STORAGE_BASE_URL is a valid URL', () => {
      expect(READEST_PUBLIC_STORAGE_BASE_URL).toMatch(/^https:\/\//);
    });

    it('READEST_OPDS_USER_AGENT is a non-empty string', () => {
      expect(typeof READEST_OPDS_USER_AGENT).toBe('string');
      expect(READEST_OPDS_USER_AGENT.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Sync interval constants
  // ---------------------------------------------------------------------------
  describe('sync interval constants', () => {
    it('SYNC_PROGRESS_INTERVAL_SEC is a positive number', () => {
      expect(typeof SYNC_PROGRESS_INTERVAL_SEC).toBe('number');
      expect(SYNC_PROGRESS_INTERVAL_SEC).toBeGreaterThan(0);
    });

    it('SYNC_NOTES_INTERVAL_SEC is a positive number', () => {
      expect(typeof SYNC_NOTES_INTERVAL_SEC).toBe('number');
      expect(SYNC_NOTES_INTERVAL_SEC).toBeGreaterThan(0);
    });

    it('SYNC_BOOKS_INTERVAL_SEC is a positive number', () => {
      expect(typeof SYNC_BOOKS_INTERVAL_SEC).toBe('number');
      expect(SYNC_BOOKS_INTERVAL_SEC).toBeGreaterThan(0);
    });

    it('CHECK_UPDATE_INTERVAL_SEC is at least one hour', () => {
      expect(typeof CHECK_UPDATE_INTERVAL_SEC).toBe('number');
      expect(CHECK_UPDATE_INTERVAL_SEC).toBeGreaterThanOrEqual(3600);
    });
  });

  // ---------------------------------------------------------------------------
  // Zoom constants
  // ---------------------------------------------------------------------------
  describe('zoom constants', () => {
    it('MAX_ZOOM_LEVEL is greater than MIN_ZOOM_LEVEL', () => {
      expect(MAX_ZOOM_LEVEL).toBeGreaterThan(MIN_ZOOM_LEVEL);
    });

    it('MIN_ZOOM_LEVEL is a positive number', () => {
      expect(MIN_ZOOM_LEVEL).toBeGreaterThan(0);
    });

    it('ZOOM_STEP is a positive number less than the zoom range', () => {
      expect(ZOOM_STEP).toBeGreaterThan(0);
      expect(ZOOM_STEP).toBeLessThan(MAX_ZOOM_LEVEL - MIN_ZOOM_LEVEL);
    });
  });

  // ---------------------------------------------------------------------------
  // Misc boolean/number constants
  // ---------------------------------------------------------------------------
  describe('miscellaneous constants', () => {
    it('SHOW_UNREAD_STATUS_BADGE is a boolean', () => {
      expect(typeof SHOW_UNREAD_STATUS_BADGE).toBe('boolean');
    });

    it('DOUBLE_CLICK_INTERVAL_THRESHOLD_MS is a positive number', () => {
      expect(typeof DOUBLE_CLICK_INTERVAL_THRESHOLD_MS).toBe('number');
      expect(DOUBLE_CLICK_INTERVAL_THRESHOLD_MS).toBeGreaterThan(0);
      expect(DOUBLE_CLICK_INTERVAL_THRESHOLD_MS).toBeLessThanOrEqual(1000);
    });

    it('DISABLE_DOUBLE_CLICK_ON_MOBILE is a boolean', () => {
      expect(typeof DISABLE_DOUBLE_CLICK_ON_MOBILE).toBe('boolean');
    });

    it('LONG_HOLD_THRESHOLD is a positive number', () => {
      expect(typeof LONG_HOLD_THRESHOLD).toBe('number');
      expect(LONG_HOLD_THRESHOLD).toBeGreaterThan(0);
      expect(LONG_HOLD_THRESHOLD).toBeLessThanOrEqual(5000);
    });

    it('SIZE_PER_LOC is a positive number', () => {
      expect(typeof SIZE_PER_LOC).toBe('number');
      expect(SIZE_PER_LOC).toBeGreaterThan(0);
    });

    it('SIZE_PER_TIME_UNIT is a positive number', () => {
      expect(typeof SIZE_PER_TIME_UNIT).toBe('number');
      expect(SIZE_PER_TIME_UNIT).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Quota constants
  // ---------------------------------------------------------------------------
  describe('quota constants', () => {
    it('DEFAULT_STORAGE_QUOTA has all plan tiers', () => {
      expect(typeof DEFAULT_STORAGE_QUOTA).toBe('object');
      expect(typeof DEFAULT_STORAGE_QUOTA.free).toBe('number');
      expect(typeof DEFAULT_STORAGE_QUOTA.plus).toBe('number');
      expect(typeof DEFAULT_STORAGE_QUOTA.pro).toBe('number');
      expect(typeof DEFAULT_STORAGE_QUOTA.purchase).toBe('number');
    });

    it('DEFAULT_STORAGE_QUOTA tiers are in ascending order (except purchase)', () => {
      expect(DEFAULT_STORAGE_QUOTA.free).toBeGreaterThan(0);
      expect(DEFAULT_STORAGE_QUOTA.plus).toBeGreaterThan(DEFAULT_STORAGE_QUOTA.free);
      expect(DEFAULT_STORAGE_QUOTA.pro).toBeGreaterThan(DEFAULT_STORAGE_QUOTA.plus);
    });

    it('DEFAULT_DAILY_TRANSLATION_QUOTA has all plan tiers', () => {
      expect(typeof DEFAULT_DAILY_TRANSLATION_QUOTA).toBe('object');
      expect(typeof DEFAULT_DAILY_TRANSLATION_QUOTA.free).toBe('number');
      expect(typeof DEFAULT_DAILY_TRANSLATION_QUOTA.plus).toBe('number');
      expect(typeof DEFAULT_DAILY_TRANSLATION_QUOTA.pro).toBe('number');
      expect(typeof DEFAULT_DAILY_TRANSLATION_QUOTA.purchase).toBe('number');
    });

    it('DEFAULT_DAILY_TRANSLATION_QUOTA tiers are in ascending order (except purchase)', () => {
      expect(DEFAULT_DAILY_TRANSLATION_QUOTA.free).toBeGreaterThan(0);
      expect(DEFAULT_DAILY_TRANSLATION_QUOTA.plus).toBeGreaterThan(
        DEFAULT_DAILY_TRANSLATION_QUOTA.free,
      );
      expect(DEFAULT_DAILY_TRANSLATION_QUOTA.pro).toBeGreaterThan(
        DEFAULT_DAILY_TRANSLATION_QUOTA.plus,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Custom theme templates
  // ---------------------------------------------------------------------------
  describe('CUSTOM_THEME_TEMPLATES', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(CUSTOM_THEME_TEMPLATES)).toBe(true);
      expect(CUSTOM_THEME_TEMPLATES.length).toBeGreaterThan(0);
    });

    it('each template has light and dark variants with fg, bg, and primary', () => {
      for (const template of CUSTOM_THEME_TEMPLATES) {
        expect(typeof template.light).toBe('object');
        expect(typeof template.dark).toBe('object');

        for (const variant of [template.light, template.dark]) {
          expect(typeof variant.fg).toBe('string');
          expect(variant.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
          expect(typeof variant.bg).toBe('string');
          expect(variant.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
          expect(typeof variant.primary).toBe('string');
          expect(variant.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // RTL languages
  // ---------------------------------------------------------------------------
  describe('MIGHT_BE_RTL_LANGS', () => {
    it('is a non-empty array of strings', () => {
      expect(Array.isArray(MIGHT_BE_RTL_LANGS)).toBe(true);
      expect(MIGHT_BE_RTL_LANGS.length).toBeGreaterThan(0);
      for (const lang of MIGHT_BE_RTL_LANGS) {
        expect(typeof lang).toBe('string');
      }
    });

    it('includes common RTL language codes', () => {
      expect(MIGHT_BE_RTL_LANGS).toContain('ar');
      expect(MIGHT_BE_RTL_LANGS).toContain('he');
      expect(MIGHT_BE_RTL_LANGS).toContain('fa');
    });
  });

  // ---------------------------------------------------------------------------
  // Language maps
  // ---------------------------------------------------------------------------
  describe('language maps', () => {
    it('TRANSLATED_LANGS is a record of language codes to names', () => {
      expect(typeof TRANSLATED_LANGS).toBe('object');
      const entries = Object.entries(TRANSLATED_LANGS);
      expect(entries.length).toBeGreaterThan(0);
      for (const [code, name] of entries) {
        expect(typeof code).toBe('string');
        expect(code.length).toBeGreaterThan(0);
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
    });

    it('TRANSLATED_LANGS includes English', () => {
      expect(TRANSLATED_LANGS.en).toBe('English');
    });

    it('TRANSLATED_LANGS includes Chinese variants', () => {
      expect(TRANSLATED_LANGS['zh-CN']).toBeDefined();
      expect(TRANSLATED_LANGS['zh-TW']).toBeDefined();
    });

    it('TRANSLATOR_LANGS is a superset of TRANSLATED_LANGS', () => {
      expect(typeof TRANSLATOR_LANGS).toBe('object');
      for (const code of Object.keys(TRANSLATED_LANGS)) {
        expect(code in TRANSLATOR_LANGS).toBe(true);
      }
      // TRANSLATOR_LANGS has extra languages
      expect(Object.keys(TRANSLATOR_LANGS).length).toBeGreaterThanOrEqual(
        Object.keys(TRANSLATED_LANGS).length,
      );
    });

    it('TRANSLATOR_LANGS includes additional languages not in TRANSLATED_LANGS', () => {
      expect(TRANSLATOR_LANGS['nb']).toBeDefined();
      expect(TRANSLATOR_LANGS['sv']).toBeDefined();
      expect(TRANSLATOR_LANGS['fi']).toBeDefined();
    });

    it('SUPPORTED_LANGS includes zh in addition to TRANSLATED_LANGS entries', () => {
      expect(typeof SUPPORTED_LANGS).toBe('object');
      expect(SUPPORTED_LANGS['zh']).toBeDefined();
      // All TRANSLATED_LANGS should be in SUPPORTED_LANGS
      for (const code of Object.keys(TRANSLATED_LANGS)) {
        expect(code in SUPPORTED_LANGS).toBe(true);
      }
    });

    it('SUPPORTED_LANGNAMES is the inverse of SUPPORTED_LANGS', () => {
      expect(typeof SUPPORTED_LANGNAMES).toBe('object');
      const entries = Object.entries(SUPPORTED_LANGNAMES);
      expect(entries.length).toBeGreaterThan(0);
      // Each value in SUPPORTED_LANGNAMES should be a key in SUPPORTED_LANGS
      for (const [name, code] of entries) {
        expect(typeof name).toBe('string');
        expect(typeof code).toBe('string');
        expect(SUPPORTED_LANGS[code]).toBe(name);
      }
    });

    it('SUPPORTED_LANGNAMES has the same number of entries as SUPPORTED_LANGS', () => {
      expect(Object.keys(SUPPORTED_LANGNAMES).length).toBe(Object.keys(SUPPORTED_LANGS).length);
    });
  });
});
