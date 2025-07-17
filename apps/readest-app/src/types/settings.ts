import { CustomTheme } from '@/styles/themes';
import { HighlightColor, HighlightStyle, ViewSettings } from './book';

export type ThemeType = 'light' | 'dark' | 'auto';
export type LibraryViewModeType = 'grid' | 'list';
export type LibrarySortByType = 'title' | 'author' | 'updated' | 'created' | 'size' | 'format';
export type LibraryCoverFitType = 'crop' | 'fit';

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
  customThemes: CustomTheme[];
}

export interface SystemSettings {
  version: number;
  localBooksDir: string;

  keepLogin: boolean;
  autoUpload: boolean;
  alwaysOnTop: boolean;
  openBookInNewWindow: boolean;
  autoCheckUpdates: boolean;
  screenWakeLock: boolean;
  alwaysShowStatusBar: boolean;
  openLastBooks: boolean;
  lastOpenBooks: string[];
  autoImportBooksOnOpen: boolean;
  telemetryEnabled: boolean;
  libraryViewMode: LibraryViewModeType;
  librarySortBy: LibrarySortByType;
  librarySortAscending: boolean;
  libraryCoverFit: LibraryCoverFitType;

  lastSyncedAtBooks: number;
  lastSyncedAtConfigs: number;
  lastSyncedAtNotes: number;

  globalReadSettings: ReadSettings;
  globalViewSettings: ViewSettings;
}
