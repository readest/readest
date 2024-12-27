import { BookFont, BookLayout, BookSearchConfig, BookStyle } from '@/types/book';
import { ReadSettings } from '@/types/settings';

export const LOCAL_BOOKS_SUBDIR = 'Readest/Books';
export const CLOUD_BOOKS_SUBDIR = 'Readest/Books';

export const SUPPORTED_FILE_EXTS = ['epub', 'mobi', 'azw', 'azw3', 'fb2', 'cbz', 'pdf'];
export const FILE_ACCEPT_FORMATS = SUPPORTED_FILE_EXTS.map((ext) => `.${ext}`).join(', ');

export const DEFAULT_READSETTINGS: ReadSettings = {
  sideBarWidth: '25%',
  isSideBarPinned: true,
  sideBarTab: 'toc',
  notebookWidth: '25%',
  isNotebookPinned: false,
  autohideCursor: true,
  translateTargetLang: 'EN',

  highlightStyle: 'highlight',
  highlightStyles: {
    highlight: 'yellow',
    underline: 'green',
    squiggly: 'blue',
  },
};

export const DEFAULT_BOOK_FONT: BookFont = {
  serifFont: 'Bitter',
  sansSerifFont: 'Roboto',
  monospaceFont: 'Consolas',
  defaultFont: 'Serif',
  defaultFontSize: 16,
  minimumFontSize: 8,
  fontWeight: 400,
};

export const DEFAULT_BOOK_LAYOUT: BookLayout = {
  marginPx: 44,
  gapPercent: 5,
  scrolled: false,
  disableClick: false,
  maxColumnCount: 2,
  maxInlineSize: 720,
  maxBlockSize: 1440,
  animated: false,
  vertical: false,
};

export const DEFAULT_BOOK_STYLE: BookStyle = {
  zoomLevel: 100,
  lineHeight: 1.6,
  fullJustification: true,
  hyphenation: true,
  invert: false,
  theme: 'light',
  overrideFont: false,
  userStylesheet: '',
};

export const DEFAULT_BOOK_SEARCH_CONFIG: BookSearchConfig = {
  scope: 'book',
  matchCase: false,
  matchWholeWords: false,
  matchDiacritics: false,
};

export const SYSTEM_SETTINGS_VERSION = 1;

export const SERIF_FONTS = [
  'Bitter',
  'Literata',
  'Merriweather',
  'Vollkorn',
  'Georgia',
  'Times New Roman',
];

export const SANS_SERIF_FONTS = ['Roboto', 'Noto Sans', 'Open Sans', 'Helvetica', 'Arial'];

export const MONOSPACE_FONTS = ['Fira Code', 'Lucida Console', 'Consolas', 'Courier New'];

export const ONE_COLUMN_MAX_INLINE_SIZE = 9999;

export const BOOK_IDS_SEPARATOR = '+';

export const DOWNLOAD_READEST_URL = 'https://readest.com?utm_source=readest_web';

export const READEST_WEB_BASE_URL = 'https://web.readest.com';

export const SYNC_PROGRESS_INTERVAL_SEC = 60;
export const SYNC_NOTES_INTERVAL_SEC = 60;
export const CHECK_UPDATE_INTERVAL_SEC = 24 * 60 * 60;
