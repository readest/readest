import { HighlightColor, HighlightStyle, ViewSettings } from './book';

export type ThemeType = 'light' | 'dark' | 'auto';

export interface ReadSettings {
  sideBarWidth: string;
  isSideBarPinned: boolean;
  notebookWidth: string;
  isNotebookPinned: boolean;
  autohideCursor: boolean;
  translateTargetLang: string;

  highlightStyle: HighlightStyle;
  highlightStyles: Record<HighlightStyle, HighlightColor>;
}

export interface SystemSettings {
  version: number;
  localBooksDir: string;

  keepLogin: boolean;
  autoUpload: boolean;
  autoCheckUpdates: boolean;

  lastSyncedAtBooks: number;
  lastSyncedAtConfigs: number;
  lastSyncedAtNotes: number;

  globalReadSettings: ReadSettings;
  globalViewSettings: ViewSettings;
}
