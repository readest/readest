import { CustomTheme } from '@/styles/themes';
import { CustomFont } from '@/styles/fonts';
import { CustomTexture } from '@/styles/textures';
import { HighlightColor, HighlightStyle, ViewSettings } from './book';
import { OPDSCatalog } from './opds';
import type { AISettings } from '@/services/ai/types';
import type { NotebookTab } from '@/store/notebookStore';

export type ThemeType = 'light' | 'dark' | 'auto';
export type LibraryViewModeType = 'grid' | 'list';
export const LibrarySortByType = {
  Title: 'title',
  Author: 'author',
  Updated: 'updated',
  Created: 'created',
  Series: 'series',
  Size: 'size',
  Format: 'format',
  Published: 'published',
} as const;

export type LibrarySortByType = (typeof LibrarySortByType)[keyof typeof LibrarySortByType];

export type LibraryCoverFitType = 'crop' | 'fit';

export const LibraryGroupByType = {
  None: 'none',
  Group: 'group',
  Series: 'series',
  Author: 'author',
} as const;

export type LibraryGroupByType = (typeof LibraryGroupByType)[keyof typeof LibraryGroupByType];

export type KOSyncChecksumMethod = 'binary' | 'filename';
export type KOSyncStrategy = 'prompt' | 'silent' | 'send' | 'receive';

export interface ReadSettings {
  sideBarWidth: string;
  isSideBarPinned: boolean;
  notebookWidth: string;
  isNotebookPinned: boolean;
  notebookActiveTab: NotebookTab;
  autohideCursor: boolean;
  translationProvider: string;
  translateTargetLang: string;

  highlightStyle: HighlightStyle;
  highlightStyles: Record<HighlightStyle, HighlightColor>;
  customHighlightColors: Record<HighlightColor, string>;
  userHighlightColors: string[];
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

export interface ReadwiseSettings {
  enabled: boolean;
  accessToken: string;
  lastSyncedAt: number;
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
  savedBookCoverForLockScreenPath: string;
  telemetryEnabled: boolean;
  discordRichPresenceEnabled: boolean;
  libraryViewMode: LibraryViewModeType;
  librarySortBy: LibrarySortByType;
  librarySortAscending: boolean;
  libraryGroupBy: LibraryGroupByType;
  libraryCoverFit: LibraryCoverFitType;
  libraryAutoColumns: boolean;
  libraryColumns: number;
  customFonts: CustomFont[];
  customTextures: CustomTexture[];
  opdsCatalogs: OPDSCatalog[];
  metadataSeriesCollapsed: boolean;
  metadataOthersCollapsed: boolean;
  metadataDescriptionCollapsed: boolean;

  kosync: KOSyncSettings;
  readwise: ReadwiseSettings;

  lastSyncedAtBooks: number;
  lastSyncedAtConfigs: number;
  lastSyncedAtNotes: number;

  migrationVersion: number;

  aiSettings: AISettings;
  globalReadSettings: ReadSettings;
  globalViewSettings: ViewSettings;
}
