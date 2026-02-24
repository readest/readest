import {
  AnnotatorConfig,
  BookFont,
  BookLanguage,
  BookLayout,
  BookSearchConfig,
  BookStyle,
  HighlightColor,
  NoteExportConfig,
  ParagraphModeConfig,
  ReadingRulerColor,
  ScreenConfig,
  TranslatorConfig,
  TTSConfig,
  ViewConfig,
  ViewSettings,
} from '@/types/book';
import {
  KOSyncSettings,
  LibraryGroupByType,
  LibrarySortByType,
  ReadSettings,
  ReadwiseSettings,
  SystemSettings,
} from '@/types/settings';
import { UserStorageQuota, UserDailyTranslationQuota } from '@/types/quota';
import { getDefaultMaxBlockSize, getDefaultMaxInlineSize } from '@/utils/config';
import { stubTranslation as _ } from '@/utils/misc';
import { DEFAULT_AI_SETTINGS } from './ai/constants';

export const DATA_SUBDIR = 'Readest';
export const LOCAL_BOOKS_SUBDIR = `${DATA_SUBDIR}/Books`;
export const CLOUD_BOOKS_SUBDIR = `${DATA_SUBDIR}/Books`;
export const LOCAL_FONTS_SUBDIR = `${DATA_SUBDIR}/Fonts`;
export const LOCAL_IMAGES_SUBDIR = `${DATA_SUBDIR}/Images`;

export const SETTINGS_FILENAME = 'settings.json';

export const SUPPORTED_BOOK_EXTS = [
  'epub',
  'mobi',
  'azw',
  'azw3',
  'fb2',
  'zip',
  'cbz',
  'pdf',
  'txt',
];
export const BOOK_ACCEPT_FORMATS = SUPPORTED_BOOK_EXTS.map((ext) => `.${ext}`).join(', ');
export const BOOK_UNGROUPED_NAME = '';
export const BOOK_UNGROUPED_ID = '';

export const SUPPORTED_IMAGE_EXTS = ['png', 'jpg', 'jpeg'];
export const IMAGE_ACCEPT_FORMATS = SUPPORTED_IMAGE_EXTS.map((ext) => `.${ext}`).join(', ');

export const DEFAULT_KOSYNC_SETTINGS = {
  serverUrl: 'https://sync.koreader.rocks/', // https://kosync.ak-team.com:3042/
  username: '',
  userkey: '',
  deviceId: '',
  deviceName: '',
  checksumMethod: 'binary',
  strategy: 'prompt',
  enabled: false,
} as KOSyncSettings;

export const READWISE_API_BASE_URL = 'https://readwise.io/api/v2';

export const DEFAULT_READWISE_SETTINGS = {
  enabled: false,
  accessToken: '',
  lastSyncedAt: 0,
} as ReadwiseSettings;

export const DEFAULT_SYSTEM_SETTINGS: Partial<SystemSettings> = {
  keepLogin: false,
  autoUpload: true,
  alwaysOnTop: false,
  openBookInNewWindow: true,
  alwaysShowStatusBar: false,
  alwaysInForeground: false,
  autoCheckUpdates: true,
  screenWakeLock: false,
  screenBrightness: -1, // -1~100, -1 for system default
  autoScreenBrightness: true,
  openLastBooks: false,
  lastOpenBooks: [],
  autoImportBooksOnOpen: false,
  telemetryEnabled: true,
  discordRichPresenceEnabled: false,
  libraryViewMode: 'grid',
  librarySortBy: LibrarySortByType.Updated,
  librarySortAscending: false,
  libraryGroupBy: LibraryGroupByType.Group,
  libraryCoverFit: 'crop',
  libraryAutoColumns: true,
  libraryColumns: 6,

  metadataSeriesCollapsed: false,
  metadataOthersCollapsed: false,
  metadataDescriptionCollapsed: false,

  kosync: DEFAULT_KOSYNC_SETTINGS,
  readwise: DEFAULT_READWISE_SETTINGS,
  aiSettings: DEFAULT_AI_SETTINGS,

  lastSyncedAtBooks: 0,
  lastSyncedAtConfigs: 0,
  lastSyncedAtNotes: 0,
};

export const DEFAULT_MOBILE_SYSTEM_SETTINGS: Partial<SystemSettings> = {
  libraryColumns: 3,
};

export const HIGHLIGHT_COLOR_HEX: Record<HighlightColor, string> = {
  red: '#f87171', // red-400
  yellow: '#facc15', // yellow-400
  green: '#4ade80', // green-400
  blue: '#60a5fa', // blue-400
  violet: '#a78bfa', // violet-400
};

export const READING_RULER_COLORS: Record<ReadingRulerColor, string> = {
  transparent: '#00000000',
  yellow: '#facc15',
  green: '#4ade80',
  blue: '#60a5fa',
  rose: '#fb7185',
};

export const DEFAULT_READSETTINGS: ReadSettings = {
  sideBarWidth: '15%',
  isSideBarPinned: true,
  notebookWidth: '25%',
  isNotebookPinned: false,
  notebookActiveTab: 'notes',
  autohideCursor: true,
  translationProvider: 'deepl',
  translateTargetLang: 'EN',

  customThemes: [],
  highlightStyle: 'highlight',
  highlightStyles: {
    highlight: 'yellow',
    underline: 'green',
    squiggly: 'blue',
  },
  customHighlightColors: HIGHLIGHT_COLOR_HEX,
  userHighlightColors: [],
  customTtsHighlightColors: [],
};

export const DEFAULT_MOBILE_READSETTINGS: Partial<ReadSettings> = {
  sideBarWidth: '25%',
  isSideBarPinned: false,
};

export const DEFAULT_BOOK_FONT: BookFont = {
  serifFont: 'Bitter',
  sansSerifFont: 'Roboto',
  monospaceFont: 'Consolas',
  defaultFont: 'Serif',
  defaultCJKFont: 'LXGW WenKai GB Screen',
  defaultFontSize: 16,
  minimumFontSize: 8,
  fontWeight: 400,
};

export const DEFAULT_BOOK_LAYOUT: BookLayout = {
  marginTopPx: 44,
  marginBottomPx: 44,
  marginLeftPx: 16,
  marginRightPx: 16,
  compactMarginTopPx: 16,
  compactMarginBottomPx: 16,
  compactMarginLeftPx: 16,
  compactMarginRightPx: 16,
  gapPercent: 5,
  scrolled: false,
  disableClick: false,
  fullscreenClickArea: false,
  swapClickArea: false,
  disableDoubleClick: false,
  volumeKeysToFlip: false,
  continuousScroll: false,
  maxColumnCount: 2,
  maxInlineSize: getDefaultMaxInlineSize(),
  maxBlockSize: getDefaultMaxBlockSize(),
  writingMode: 'auto',
  vertical: false,
  rtl: false,
  scrollingOverlap: 0,
  allowScript: false,
};

export const DEFAULT_BOOK_LANGUAGE: BookLanguage = {
  replaceQuotationMarks: true,
  convertChineseVariant: 'none',
};

export const DEFAULT_BOOK_STYLE: BookStyle = {
  zoomLevel: 100,
  paragraphMargin: 0.6,
  lineHeight: 1.4,
  wordSpacing: 0,
  letterSpacing: 0,
  textIndent: 0,
  fullJustification: true,
  hyphenation: true,
  invertImgColorInDark: false,
  theme: 'light',
  overrideFont: false,
  overrideLayout: false,
  overrideColor: false,
  backgroundTextureId: 'none',
  backgroundOpacity: 0.6,
  backgroundSize: 'cover',
  codeHighlighting: false,
  codeLanguage: 'auto-detect',
  userStylesheet: '',
  userUIStylesheet: '',

  zoomMode: 'fit-page',
  spreadMode: 'auto',
  keepCoverSpread: true,
};

export const DEFAULT_MOBILE_VIEW_SETTINGS: Partial<ViewSettings> = {
  fullJustification: false,
  animated: true,
  defaultFont: 'Sans-serif',
  marginBottomPx: 16,
  disableDoubleClick: true,
  spreadMode: 'none',
};

export const DEFAULT_CJK_VIEW_SETTINGS: Partial<ViewSettings> = {
  fullJustification: true,
  textIndent: 2,
  paragraphMargin: 1,
  lineHeight: 1.6,
};

export const DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS: Partial<ViewSettings> = {
  overrideColor: false,
};

export const DEFAULT_EINK_VIEW_SETTINGS: Partial<ViewSettings> = {
  isEink: true,
  animated: false,
  volumeKeysToFlip: true,
};

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  sideBarTab: 'toc',
  uiLanguage: '',
  sortedTOC: false,

  doubleBorder: false,
  borderColor: 'red',

  showHeader: true,
  showFooter: true,
  showBarsOnScroll: false,
  showRemainingTime: false,
  showRemainingPages: false,
  showProgressInfo: true,
  tapToToggleFooter: false,
  showMarginsOnScroll: false,
  showPaginationButtons: false,
  progressStyle: 'fraction',
  progressInfoMode: 'all',

  animated: false,
  isEink: false,
  isColorEink: false,

  readingRulerEnabled: false,
  readingRulerLines: 2,
  readingRulerPosition: 33,
  readingRulerOpacity: 0.5,
  readingRulerColor: 'transparent',
};

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  ttsRate: 1.3,
  ttsVoice: '',
  ttsLocation: '',
  showTTSBar: false,
  ttsHighlightOptions: { style: 'highlight', color: '#808080' },
};

export const DEFAULT_TRANSLATOR_CONFIG: TranslatorConfig = {
  translationEnabled: false,
  translationProvider: 'deepl',
  translateTargetLang: '',
  showTranslateSource: true,
  ttsReadAloudText: 'both',
};

export const DEFAULT_NOTE_EXPORT_CONFIG: NoteExportConfig = {
  includeTitle: true,
  includeAuthor: true,
  includeDate: true,
  includeChapterTitles: true,
  includeQuotes: true,
  includeNotes: true,
  includeTimestamp: false,
  includeChapterSeparator: false,
  noteSeparator: '\n\n',
  useCustomTemplate: false,
  customTemplate: '',
  exportAsPlainText: false,
};

export const DEFAULT_ANNOTATOR_CONFIG: AnnotatorConfig = {
  enableAnnotationQuickActions: true,
  annotationQuickAction: null,
  copyToNotebook: false,
  noteExportConfig: DEFAULT_NOTE_EXPORT_CONFIG,
};

export const DEFAULT_SCREEN_CONFIG: ScreenConfig = {
  screenOrientation: 'auto',
};

export const DEFAULT_PARAGRAPH_MODE_CONFIG: ParagraphModeConfig = {
  enabled: false,
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
  'Roboto Slab',
  'Vollkorn',
  'PT Serif',
  'Georgia',
  'Times New Roman',
];

export const NON_FREE_FONTS = ['Georgia', 'Times New Roman'];

export const CJK_SERIF_FONTS = [
  _('LXGW WenKai GB Screen'),
  _('LXGW WenKai TC'),
  _('GuanKiapTsingKhai-T'),
  _('Source Han Serif CN'),
  _('Huiwen-MinchoGBK'),
  _('KingHwa_OldSong'),
];

export const CJK_SANS_SERIF_FONTS = ['Noto Sans SC', 'Noto Sans TC'];

export const SANS_SERIF_FONTS = ['Roboto', 'Noto Sans', 'Open Sans', 'PT Sans', 'Helvetica'];

export const MONOSPACE_FONTS = [
  'Fira Code',
  'Consolas',
  'Courier New',
  'Lucida Console',
  'PT Mono',
];

export const FALLBACK_FONTS = ['MiSans L3'];

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
  'FangSong',
  'Franklin Gothic Medium',
  'Gabriola',
  'Gadugi',
  'Georgia',
  'Heiti',
  'HoloLens MDL2 Assets',
  'Impact',
  'Ink Free',
  'Javanese Text',
  'KaiTi',
  'Leelawadee UI',
  'Lucida Console',
  'Lucida Sans Unicode',
  'LXGW WenKai GB Screen',
  'LXGW WenKai TC',
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
  'MingLiU',
  'MingLiU-ExtB',
  'Mongolian Baiti',
  'MS Gothic',
  'MS Mincho',
  'MV Boli',
  'Myanmar Text',
  'Nirmala UI',
  'Noto Serif JP',
  'NSimSun',
  'Palatino Linotype',
  'PMingLiU',
  'Segoe MDL2 Assets',
  'Segoe Print',
  'Segoe Script',
  'Segoe UI',
  'Segoe UI Historic',
  'Segoe UI Emoji',
  'Segoe UI Symbol',
  'SimHei',
  'SimSun',
  'SimSun-ExtB',
  'Sitka',
  'Sylfaen',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'XiHeiti',
  'Yu Gothic',
  'Yu Mincho',
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
  'BiauKai',
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
  'FangSong',
  'Futura',
  'Geneva',
  'Georgia',
  'Gill Sans',
  'Heiti SC',
  'Heiti TC',
  'Helvetica',
  'Helvetica Neue',
  'Herculanum',
  'Hiragino Sans',
  'Hiragino Mincho',
  'Hoefler Text',
  'Impact',
  'Kaiti SC',
  'Kaiti TC',
  'Kozuka Gothic Pro',
  'Kozuka Mincho Pro',
  'Lucida Grande',
  'Luminari',
  'LXGW WenKai GB Screen',
  'LXGW WenKai TC',
  'Marker Felt',
  'Menlo',
  'Microsoft Sans Serif',
  'Monaco',
  'Noteworthy',
  'Noto Serif JP',
  'Optima',
  'Palatino',
  'Papyrus',
  'PingFang HK',
  'PingFang SC',
  'PingFang TC',
  'Phosphate',
  'Rockwell',
  'Savoye LET',
  'SignPainter',
  'Skia',
  'Snell Roundhand',
  'Songti SC',
  'Songti TC',
  'STFangsong',
  'STKaiti',
  'STSong',
  'STXihei',
  'Tahoma',
  'Times',
  'Times New Roman',
  'Trattatello',
  'Trebuchet MS',
  'Verdana',
  'XiHeiti',
  'Yu Mincho',
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
  'FangSong',
  'FreeMono',
  'FreeSans',
  'FreeSerif',
  'Georgia',
  'Heiti',
  'Impact',
  'Kaiti',
  'Liberation Mono',
  'Liberation Sans',
  'Liberation Serif',
  'LXGW WenKai GB Screen',
  'LXGW WenKai TC',
  'Noto Mono',
  'Noto Sans',
  'Noto Sans JP',
  'Noto Sans CJK SC',
  'Noto Sans CJK TC',
  'Noto Serif',
  'Noto Serif JP',
  'Noto Serif CJK SC',
  'Noto Serif CJK TC',
  'Open Sans',
  'Poppins',
  'Sazanami Gothic',
  'Sazanami Mincho',
  'Source Han Sans',
  'Source Han Serif',
  'Times New Roman',
  'Ubuntu',
  'Ubuntu Mono',
  'WenQuanYi Micro Hei',
  'WenQuanYi Zen Hei',
  'XiHeiti',
];

export const IOS_FONTS = [
  'Avenir',
  'Avenir Next',
  'Courier',
  'Courier New',
  'FangSong',
  'Georgia',
  'Heiti',
  'Helvetica',
  'Helvetica Neue',
  'Hiragino Mincho',
  'Hiragino Sans',
  'Kaiti',
  'LXGW WenKai GB Screen',
  'LXGW WenKai TC',
  'Palatino',
  'PingFang SC',
  'PingFang TC',
  'San Francisco',
  'SF Pro Display',
  'SF Pro Rounded',
  'SF Pro Text',
  'Songti',
  'Times New Roman',
  'Verdana',
  'XiHeiti',
];

export const ANDROID_FONTS = [
  'Arial',
  'Droid Sans',
  'Droid Serif',
  'FangSong',
  'FZLanTingHei',
  'Georgia',
  'Heiti',
  'Kaiti',
  'LXGW WenKai GB Screen',
  'LXGW WenKai TC',
  'Noto Sans',
  'Noto Sans CJK',
  'Noto Sans JP',
  'Noto Serif',
  'Noto Serif CJK',
  'Noto Serif JP',
  'PingFang SC',
  'Roboto',
  'Source Han Sans',
  'Source Han Serif',
  'STHeiti',
  'STSong',
  'Tahoma',
  'Verdana',
  'XiHeiti',
];

export const CJK_EXCLUDE_PATTENS = new RegExp(
  ['AlBayan', 'STIX', 'Kailasa', 'ITCTT', 'Luminari', 'Myanmar'].join('|'),
  'i',
);
export const CJK_FONTS_PATTENS = new RegExp(
  [
    'CJK',
    'TC$',
    'SC$',
    'HK',
    'JP',
    'TW',
    'Sim',
    'Kai',
    'Hei',
    'Yan',
    'Min',
    'Khai',
    'Yuan',
    'Song',
    'Ming',
    'FZ',
    'Huiwen',
    'KingHwa',
    'FangZheng',
    'WenQuanYi',
    'PingFang',
    'Hiragino',
    'Meiryo',
    'Source\\s?Han',
    'Yu\\s?Gothic',
    'Yu\\s?Mincho',
    'Mincho',
    'Nanum',
    'Malgun',
    'Gulim',
    'Dotum',
    'Batang',
    'Gungsuh',
    'OPPO sans',
    'MiSans',
    'Fallback',
  ].join('|'),
  'i',
);

export const BOOK_IDS_SEPARATOR = '+';

export const DOWNLOAD_READEST_URL = 'https://readest.com?utm_source=readest_web';

export const READEST_WEB_BASE_URL = 'https://web.readest.com';
export const READEST_NODE_BASE_URL = 'https://node.readest.com';

const LATEST_DOWNLOAD_BASE_URL = 'https://download.readest.com/releases';

export const READEST_UPDATER_FILE = `${LATEST_DOWNLOAD_BASE_URL}/latest.json`;

export const READEST_CHANGELOG_FILE = `${LATEST_DOWNLOAD_BASE_URL}/release-notes.json`;

export const READEST_PUBLIC_STORAGE_BASE_URL = 'https://storage.readest.com';

export const READEST_OPDS_USER_AGENT = 'Readest/1.0 (OPDS Browser)';

export const SYNC_PROGRESS_INTERVAL_SEC = 3;
export const SYNC_NOTES_INTERVAL_SEC = 5;
export const SYNC_BOOKS_INTERVAL_SEC = 5;
export const CHECK_UPDATE_INTERVAL_SEC = 24 * 60 * 60;

export const MAX_ZOOM_LEVEL = 500;
export const MIN_ZOOM_LEVEL = 50;
export const ZOOM_STEP = 10;

export const SHOW_UNREAD_STATUS_BADGE = false;

export const DEFAULT_STORAGE_QUOTA: UserStorageQuota = {
  free: 500 * 1024 * 1024,
  plus: 5 * 1024 * 1024 * 1024,
  pro: 20 * 1024 * 1024 * 1024,
  purchase: 0,
};

export const DEFAULT_DAILY_TRANSLATION_QUOTA: UserDailyTranslationQuota = {
  free: 10 * 1024,
  plus: 100 * 1024,
  pro: 500 * 1024,
  purchase: 0,
};

export const DOUBLE_CLICK_INTERVAL_THRESHOLD_MS = 250;
export const DISABLE_DOUBLE_CLICK_ON_MOBILE = true;
export const LONG_HOLD_THRESHOLD = 500;

export const SIZE_PER_LOC = 1500;
export const SIZE_PER_TIME_UNIT = 1600;

export const CUSTOM_THEME_TEMPLATES = [
  {
    light: {
      fg: '#2b2b2b',
      bg: '#f3f3f3',
      primary: '#3c5a72',
    },
    dark: {
      fg: '#d0d0d0',
      bg: '#1a1c1f',
      primary: '#486e8a',
    },
  },
  {
    light: {
      fg: '#3f2f3c',
      bg: '#f5ecf8',
      primary: '#7b5291',
    },
    dark: {
      fg: '#d6cadd',
      bg: '#3a2c3d',
      primary: '#bda0cc',
    },
  },
  {
    light: {
      fg: '#2b2b2b',
      bg: '#defcd9',
      primary: '#00796b',
    },
    dark: {
      fg: '#c8e6c9',
      bg: '#273c33',
      primary: '#26a69a',
    },
  },
];

export const MIGHT_BE_RTL_LANGS = [
  'zh',
  'ja',
  'ko',
  'ar',
  'he',
  'fa',
  'ur',
  'dv',
  'ps',
  'sd',
  'yi',
  '',
];

export const TRANSLATED_LANGS = {
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  nl: 'Nederlands',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  pt: 'Português',
  ru: 'Русский',
  he: 'עברית',
  ar: 'العربية',
  fa: 'فارسی',
  el: 'Ελληνικά',
  uk: 'Українська',
  pl: 'Polski',
  tr: 'Türkçe',
  hi: 'हिन्दी',
  id: 'Indonesia',
  vi: 'Tiếng Việt',
  th: 'ภาษาไทย',
  ms: 'Melayu',
  bo: 'བོད་སྐད་',
  bn: 'বাংলা',
  ta: 'தமிழ்',
  si: 'සිංහල',
  'zh-CN': '简体中文',
  'zh-TW': '正體中文',
};

export const TRANSLATOR_LANGS: Record<string, string> = {
  ...TRANSLATED_LANGS,
  nb: 'Bokmål',
  sv: 'Svenska',
  fi: 'Suomi',
  da: 'Dansk',
  cs: 'Čeština',
  hu: 'Magyar',
  km: 'ខ្មែរ',
  ro: 'Română',
  bg: 'Български',
  hr: 'Hrvatski',
  lt: 'Lietuvių',
  sl: 'Slovenščina',
  sk: 'Slovenčina',
  fa: 'فارسی',
};

export const SUPPORTED_LANGS: Record<string, string> = { ...TRANSLATED_LANGS, zh: '中文' };

export const SUPPORTED_LANGNAMES: Record<string, string> = Object.fromEntries(
  Object.entries(SUPPORTED_LANGS).map(([code, name]) => [name, code]),
);
