import {
  BookFont,
  BookLayout,
  BookSearchConfig,
  BookStyle,
  TTSConfig,
  ViewConfig,
} from '@/types/book';
import { ReadSettings } from '@/types/settings';

export const LOCAL_BOOKS_SUBDIR = 'Readest/Books';
export const CLOUD_BOOKS_SUBDIR = 'Readest/Books';

export const SUPPORTED_FILE_EXTS = ['epub', 'mobi', 'azw', 'azw3', 'fb2', 'cbz', 'pdf'];
export const FILE_ACCEPT_FORMATS = SUPPORTED_FILE_EXTS.map((ext) => `.${ext}`).join(', ');

export const DEFAULT_READSETTINGS: ReadSettings = {
  sideBarWidth: '25%',
  isSideBarPinned: true,
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
  writingMode: 'auto',
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

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  sideBarTab: 'toc',
};

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  ttsRate: 1.0,
  ttsVoice: '',
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

export const WINDOWS_FONTS = [
  'Arial',
  'Arial Black',
  'Bahnschrift',
  'Calibri',
  'Cambria',
  'Cambria Math',
  'Candara',
  'Comic Sans MS',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Ebrima',
  'Franklin Gothic Medium',
  'Gabriola',
  'Gadugi',
  'Georgia',
  'HoloLens MDL2 Assets',
  'Impact',
  'Ink Free',
  'Javanese Text',
  'Leelawadee UI',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Malgun Gothic',
  'Marlett',
  'Microsoft Himalaya',
  'Microsoft JhengHei',
  'Microsoft New Tai Lue',
  'Microsoft PhagsPa',
  'Microsoft Sans Serif',
  'Microsoft Tai Le',
  'Microsoft YaHei',
  'Microsoft Yi Baiti',
  'MingLiU-ExtB',
  'Mongolian Baiti',
  'MS Gothic',
  'MV Boli',
  'Myanmar Text',
  'Nirmala UI',
  'Palatino Linotype',
  'Segoe MDL2 Assets',
  'Segoe Print',
  'Segoe Script',
  'Segoe UI',
  'Segoe UI Historic',
  'Segoe UI Emoji',
  'Segoe UI Symbol',
  'SimSun',
  'Sitka',
  'Sylfaen',
  'Symbol',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Webdings',
  'Wingdings',
  'Yu Gothic',
];

export const MACOS_FONTS = [
  'American Typewriter',
  'Andale Mono',
  'Arial',
  'Arial Black',
  'Arial Narrow',
  'Arial Rounded MT Bold',
  'Arial Unicode MS',
  'Avenir',
  'Avenir Next',
  'Avenir Next Condensed',
  'Baskerville',
  'Big Caslon',
  'Bodoni 72',
  'Bodoni 72 Oldstyle',
  'Bodoni 72 Smallcaps',
  'Bradley Hand',
  'Brush Script MT',
  'Chalkboard',
  'Chalkboard SE',
  'Chalkduster',
  'Charter',
  'Cochin',
  'Comic Sans MS',
  'Copperplate',
  'Courier',
  'Courier New',
  'Didot',
  'DIN Alternate',
  'DIN Condensed',
  'Futura',
  'Geneva',
  'Georgia',
  'Gill Sans',
  'Helvetica',
  'Helvetica Neue',
  'Herculanum',
  'Hoefler Text',
  'Impact',
  'Lucida Grande',
  'Luminari',
  'Marker Felt',
  'Menlo',
  'Microsoft Sans Serif',
  'Monaco',
  'Noteworthy',
  'Optima',
  'Palatino',
  'Papyrus',
  'Phosphate',
  'Rockwell',
  'Savoye LET',
  'SignPainter',
  'Skia',
  'Snell Roundhand',
  'Tahoma',
  'Times',
  'Times New Roman',
  'Trattatello',
  'Trebuchet MS',
  'Verdana',
  'Zapfino',
];

export const LINUX_FONTS = [
  'Arial',
  'Cantarell',
  'Comic Sans MS',
  'Courier New',
  'DejaVu Sans',
  'DejaVu Sans Mono',
  'DejaVu Serif',
  'Droid Sans',
  'Droid Sans Mono',
  'FreeMono',
  'FreeSans',
  'FreeSerif',
  'Georgia',
  'Impact',
  'Liberation Mono',
  'Liberation Sans',
  'Liberation Serif',
  'Noto Mono',
  'Noto Sans',
  'Noto Serif',
  'Open Sans',
  'Poppins',
  'Symbola',
  'Times New Roman',
  'Ubuntu',
  'Ubuntu Mono',
  'Wingdings',
];

export const ONE_COLUMN_MAX_INLINE_SIZE = 9999;

export const BOOK_IDS_SEPARATOR = '+';

export const DOWNLOAD_READEST_URL = 'https://readest.com?utm_source=readest_web';

export const READEST_WEB_BASE_URL = 'https://web.readest.com';

export const SYNC_PROGRESS_INTERVAL_SEC = 60;
export const SYNC_NOTES_INTERVAL_SEC = 60;
export const CHECK_UPDATE_INTERVAL_SEC = 24 * 60 * 60;

export const MAX_ZOOM_LEVEL = 140;
export const MIN_ZOOM_LEVEL = 95;
