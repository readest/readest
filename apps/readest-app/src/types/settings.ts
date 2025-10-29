import { CustomTheme } from '@/styles/themes';
import { CustomFont } from '@/styles/fonts';
import { CustomTexture } from '@/styles/textures';
import { HighlightColor, HighlightStyle, ViewSettings } from './book';

export type ThemeType = 'light' | 'dark' | 'auto';
export type LibraryViewModeType = 'grid' | 'list';
export type LibrarySortByType = 'title' | 'author' | 'updated' | 'created' | 'size' | 'format';
export type LibraryCoverFitType = 'crop' | 'fit';

export type KOSyncChecksumMethod = 'binary' | 'filename';
export type KOSyncStrategy = 'prompt' | 'silent' | 'send' | 'receive';

export interface ReadSettings {
  sideBarWidth: string;
  isSideBarPinned: boolean;
  notebookWidth: string;
  isNotebookPinned: boolean;
  autohideCursor: boolean;
  translationProvider: string;
  translateTargetLang: string;

  highlightStyle: HighlightStyle;
  highlightStyles: Record<HighlightStyle, HighlightColor>;
  customHighlightColors: Record<HighlightColor, string>;
  customTtsHighlightColors: string[];
  customThemes: CustomTheme[];
}

export interface KOSyncSettings {
  enabled: boolean;
  serverUrl: string;
  username: string;
  userkey: string;
  deviceId: string;
  deviceName: string;
  checksumMethod: KOSyncChecksumMethod;
  strategy: KOSyncStrategy;
}

export interface SystemSettings {
  version: number;
  localBooksDir: string;
  customRootDir?: string;

  keepLogin: boolean;
  autoUpload: boolean;
  alwaysOnTop: boolean;
  openBookInNewWindow: boolean;
  autoCheckUpdates: boolean;
  screenWakeLock: boolean;
  screenBrightness: number;
  autoScreenBrightness: boolean;
  alwaysShowStatusBar: boolean;
  alwaysInForeground: boolean;
  openLastBooks: boolean;
  lastOpenBooks: string[];
  autoImportBooksOnOpen: boolean;
  savedBookCoverForLockScreen: string;
  telemetryEnabled: boolean;
  libraryViewMode: LibraryViewModeType;
  librarySortBy: LibrarySortByType;
  librarySortAscending: boolean;
  libraryCoverFit: LibraryCoverFitType;
  customFonts: CustomFont[];
  customTextures: CustomTexture[];

  kosync: KOSyncSettings;

  lastSyncedAtBooks: number;
  lastSyncedAtConfigs: number;
  lastSyncedAtNotes: number;

  migrationVersion: number;

  globalReadSettings: ReadSettings;
  globalViewSettings: ViewSettings;
}
