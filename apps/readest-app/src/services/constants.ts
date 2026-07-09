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
  ViewSettingsConfig,
  WordLensConfig,
} from '@/types/book';
import {
  HardcoverSettings,
  KOSyncSettings,
  LibraryGroupByType,
  LibrarySortByType,
  ReadSettings,
  ReadwiseSettings,
  SystemSettings,
  WebDAVSettings,
  GoogleDriveSettings,
  S3Settings,
} from '@/types/settings';
import { UserStorageQuota, UserDailyTranslationQuota } from '@/types/quota';
import { getDefaultMaxBlockSize, getDefaultMaxInlineSize } from '@/utils/config';
import { stubTranslation as _ } from '@/utils/misc';
import { DEFAULT_AI_SETTINGS } from './ai/constants';
import { DEFAULT_ANNOTATION_TOOLBAR_ITEMS } from '@/utils/annotationToolbar';

export const DATA_SUBDIR = 'Readest';
export const LOCAL_BOOKS_SUBDIR = `${DATA_SUBDIR}/Books`;
export const CLOUD_BOOKS_SUBDIR = `${DATA_SUBDIR}/Books`;
export const CLOUD_REPLICAS_SUBDIR = `${DATA_SUBDIR}/Replicas`;
export const LOCAL_FONTS_SUBDIR = `${DATA_SUBDIR}/Fonts`;
export const LOCAL_IMAGES_SUBDIR = `${DATA_SUBDIR}/Images`;
export const LOCAL_DICTIONARIES_SUBDIR = `${DATA_SUBDIR}/Dictionaries`;

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
  'md',
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

export const DEFAULT_HARDCOVER_SETTINGS = {
  enabled: false,
  accessToken: '',
  lastSyncedAt: 0,
  autoSync: false,
} as HardcoverSettings;

export const DEFAULT_WEBDAV_SETTINGS = {
  enabled: false,
  serverUrl: '',
  username: '',
  password: '',
  rootPath: '/',
  syncProgress: true,
  syncNotes: true,
  syncBooks: false,
  strategy: 'silent',
  deviceId: '',
  lastSyncedAt: 0,
} as WebDAVSettings;

export const DEFAULT_GOOGLE_DRIVE_SETTINGS = {
  enabled: false,
  syncProgress: true,
  syncNotes: true,
  syncBooks: false,
  strategy: 'silent',
  deviceId: '',
  lastSyncedAt: 0,
} as GoogleDriveSettings;

export const DEFAULT_S3_SETTINGS = {
  enabled: false,
  endpoint: '',
  region: 'auto',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  syncProgress: true,
  syncNotes: true,
  syncBooks: false,
  strategy: 'silent',
  deviceId: '',
  lastSyncedAt: 0,
} as S3Settings;

export const DEFAULT_SYSTEM_SETTINGS: Partial<SystemSettings> = {
  keepLogin: false,
  autoUpload: true,
  alwaysOnTop: false,
  openBookInNewWindow: true,
  alwaysShowStatusBar: false,
  autoCheckUpdates: true,
  updateChannel: 'stable',
  screenWakeLock: false,
  screenBrightness: -1, // -1~100, -1 for system default
  autoScreenBrightness: true,
  swipeBrightnessGesture: true,
  hardwarePageTurner: {
    enabled: false,
    bindings: {
      pagePrev: null,
      pageNext: null,
      sectionPrev: null,
      sectionNext: null,
      refresh: null,
    },
  },
  openLastBooks: false,
  lastOpenBooks: [],
  autoImportBooksOnOpen: false,
  telemetryEnabled: true,
  discordRichPresenceEnabled: false,
  libraryViewMode: 'grid',
  librarySortBy: LibrarySortByType.Updated,
  librarySortAscending: false,
  librarySortByAuto: true,
  librarySortBy2: 'none',
  libraryGroupBy: LibraryGroupByType.Group,
  libraryCoverFit: 'crop',
  libraryAutoColumns: true,
  libraryColumns: 6,
  libraryRecentShelfEnabled: false,

  metadataSeriesCollapsed: false,
  metadataOthersCollapsed: false,
  metadataDescriptionCollapsed: false,

  pinCodeEnabled: false,

  customDictionaries: [],
  dictionarySettings: {
    providerOrder: ['builtin:wiktionary', 'builtin:wikipedia'],
    providerEnabled: {
      'builtin:wiktionary': true,
      'builtin:wikipedia': true,
    },
  },

  kosync: DEFAULT_KOSYNC_SETTINGS,
  readwise: DEFAULT_READWISE_SETTINGS,
  hardcover: DEFAULT_HARDCOVER_SETTINGS,
  webdav: DEFAULT_WEBDAV_SETTINGS,
  googleDrive: DEFAULT_GOOGLE_DRIVE_SETTINGS,
  s3: DEFAULT_S3_SETTINGS,
  aiSettings: DEFAULT_AI_SETTINGS,

  lastSyncedAtBooks: 0,
  lastSyncedAtConfigs: 0,
  lastSyncedAtNotes: 0,
  lastSyncedAtReplicas: {},
  syncCategories: {
    book: true,
    progress: true,
    note: true,
    dictionary: true,
    font: true,
    texture: true,
    opds_catalog: true,
    settings: true,
  },
};

export const DEFAULT_MOBILE_SYSTEM_SETTINGS: Partial<SystemSettings> = {
  libraryColumns: 3,
  // Import files opened via the system "Open with" chooser into the library by
  // default so they persist and sync, instead of opening them transiently.
  autoImportBooksOnOpen: true,
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
  wordLensAutoDownload: true,

  customThemes: [],
  highlightStyle: 'highlight',
  highlightStyles: {
    highlight: 'yellow',
    underline: 'green',
    squiggly: 'blue',
  },
  customHighlightColors: HIGHLIGHT_COLOR_HEX,
  userHighlightColors: [],
  defaultHighlightLabels: {},
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
  webtoonMode: false,
  noContinuousScroll: false,
  disableClick: false,
  disableSwipe: false,
  fullscreenClickArea: false,
  swapClickArea: false,
  disableDoubleClick: false,
  volumeKeysToFlip: false,
  maxColumnCount: 2,
  maxInlineSize: getDefaultMaxInlineSize(),
  maxBlockSize: getDefaultMaxBlockSize(),
  writingMode: 'auto',
  vertical: false,
  rtl: false,
  scrollingOverlap: 0,
  allowScript: false,
  hideScrollbar: false,
  autoScrollSpeed: 100,
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
  theme: 'light',
  backgroundTextureId: 'none',
  backgroundOpacity: 0.6,
  backgroundSize: 'cover',
  highlightOpacity: 0.4,
  codeHighlighting: false,
  codeLanguage: 'auto-detect',
  userStylesheet: '',
  userUIStylesheet: '',

  overrideFont: false,
  overrideLayout: false,
  overrideColor: false,
  useBookLayout: false,

  zoomMode: 'fit-page',
  spreadMode: 'auto',
  keepCoverSpread: true,
  invertImgColorInDark: false,
  applyThemeToPDF: false,
  contrast: 100,
};

export const DEFAULT_MOBILE_VIEW_SETTINGS: Partial<ViewSettings> = {
  fullJustification: false,
  animated: true,
  defaultFont: 'Sans-serif',
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

export const DEFAULT_PARAGRAPH_MODE_CONFIG: ParagraphModeConfig = {
  enabled: false,
};

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  sideBarTab: 'toc',
  uiLanguage: '',
  sortedTOC: false,

  doubleBorder: false,
  borderColor: 'red',

  showHeader: true,
  showFooter: true,
  showRemainingTime: false,
  showRemainingPages: false,
  showProgressInfo: true,
  showStickyProgressBar: false,
  showCurrentTime: false,
  showCurrentBatteryStatus: false,
  showBatteryPercentage: true,
  use24HourClock: false,
  showPaginationButtons: false,
  progressStyle: 'fraction',
  referencePageCount: 0,

  animated: false,
  pageTurnStyle: 'push',
  isEink: false,
  isColorEink: false,

  paragraphMode: DEFAULT_PARAGRAPH_MODE_CONFIG,

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
  ttsHighlightOptions: { style: 'highlight', color: '#808080' },
  ttsHighlightGranularity: 'word',
  ttsMediaMetadata: 'sentence',
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
  includePageNumber: true,
  includeTimestamp: false,
  includeChapterSeparator: false,
  // Default to the app deeplink in the native app and the universal web link on
  // the web. Inlined platform check avoids a circular import with
  // environment.ts, which imports from this module.
  linkType: process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri' ? 'app' : 'web',
  noteSeparator: '\n\n',
  useCustomTemplate: false,
  customTemplate: '',
  exportAsPlainText: false,
  excludedColors: [],
  excludedStyles: [],
};

export const DEFAULT_ANNOTATOR_CONFIG: AnnotatorConfig = {
  enableAnnotationQuickActions: true,
  annotationQuickAction: null,
  annotationToolbarItems: DEFAULT_ANNOTATION_TOOLBAR_ITEMS,
  copyToNotebook: false,
  noteExportConfig: DEFAULT_NOTE_EXPORT_CONFIG,
};

export const DEFAULT_WORD_LENS_CONFIG: WordLensConfig = {
  wordLensEnabled: false,
  wordLensLevel: 3,
  wordLensHintLang: '',
  wordLensGlossFontSize: 0.5,
  wordLensGlossColor: '',
};

export const DEFAULT_SCREEN_CONFIG: ScreenConfig = {
  screenOrientation: 'auto',
};

export const DEFAULT_BOOK_SEARCH_CONFIG: BookSearchConfig = {
  scope: 'book',
  mode: 'contains',
  matchCase: false,
  matchDiacritics: false,
  nearbyWords: 10,
  // kept for sync wire back-compat with pre-v3 clients (mirrors mode === 'whole-words')
  matchWholeWords: false,
};

export const DEFAULT_VIEW_SETTINGS_CONFIG: ViewSettingsConfig = {
  isGlobal: true,
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

export const SHARE_BASE_URL = `${READEST_WEB_BASE_URL}/s`;
export const SHARE_EXPIRATION_DAYS = [1, 3, 7] as const;

// Send to Readest — the domain inbound capture emails are addressed to, the
// R2 bucket holding raw inbound payloads, and the per-user cap on undrained
// inbox items (defense against a leaked address).
export const SEND_EMAIL_DOMAIN = 'readest.com';
export const SEND_INBOX_BUCKET = 'readest-send-inbox';
export const SEND_INBOX_PENDING_LIMIT = 50;
// Hard cap on the size of a single uploaded EPUB the browser extension can
// drop into the inbox. 30 MB is the same total-asset cap the client-side
// bundler enforces — plus a bit of head-room for chapter HTML / structural
// overhead. Beyond this size a clipped article is almost certainly an
// over-illustrated page that would never read well in the EPUB anyway.
export const SEND_INBOX_FILE_MAX_BYTES = 40 * 1024 * 1024;
export const SHARE_DEFAULT_EXPIRATION_DAYS = 3;
export const SHARE_MAX_PER_USER = 50;
export const SHARE_TOKEN_LENGTH = 22;
export const SHARE_PRESIGN_TTL_SECONDS = 300;
export const SHARE_CFI_MAX_LENGTH = 512;

const LATEST_DOWNLOAD_BASE_URL = 'https://download.readest.com/releases';

export const READEST_UPDATER_FILE = `${LATEST_DOWNLOAD_BASE_URL}/latest.json`;

export const READEST_CHANGELOG_FILE = `${LATEST_DOWNLOAD_BASE_URL}/release-notes.json`;

export const READEST_NIGHTLY_UPDATER_FILE = 'https://download.readest.com/nightly/latest.json';

// Public (verification) key, identical to src-tauri/tauri.conf.json `updater.pubkey`.
// Used to verify nightly artifacts in the custom install flows (portable /
// AppImage / Android). Safe to embed — it is a public key.
export const READEST_UPDATER_PUBKEY =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEJFMEQ1QjE2OEU1NEIzNTEKUldSUnMxU09GbHNOdmpEaWFMT1crRFpEV2VORzQ2MklxaFc0M1R0ci9xY2c1bENXS0xhM1R1L2sK';

export const READEST_PUBLIC_STORAGE_BASE_URL = 'https://storage.readest.com';

export const READEST_OPDS_USER_AGENT = 'Readest/1.0 (OPDS Browser)';

export const SYNC_PROGRESS_INTERVAL_SEC = 3;
export const SYNC_NOTES_INTERVAL_SEC = 5;
export const SYNC_BOOKS_INTERVAL_SEC = 5;
export const CHECK_UPDATE_INTERVAL_SEC = 24 * 60 * 60;

export const MAX_ZOOM_LEVEL = 500;
export const MIN_ZOOM_LEVEL = 50;
export const ZOOM_STEP = 10;

export const MAX_CONTRAST = 300;
export const MIN_CONTRAST = 50;
export const CONTRAST_STEP = 10;

// Auto Scroll (#4998): speed is stored as a percentage of the base velocity.
export const AUTO_SCROLL_BASE_PX_PER_SEC = 20;
export const MAX_AUTO_SCROLL_SPEED = 500;
export const MIN_AUTO_SCROLL_SPEED = 25;
export const AUTO_SCROLL_SPEED_STEP = 25;

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
  'pt-BR': 'Português (Brasil)',
  ru: 'Русский',
  he: 'עברית',
  ar: 'العربية',
  fa: 'فارسی',
  el: 'Ελληνικά',
  uk: 'Українська',
  pl: 'Polski',
  sl: 'Slovenščina',
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
  ro: 'Română',
  hu: 'Magyar',
  uz: 'Oʻzbek',
};

export const TRANSLATOR_LANGS: Record<string, string> = {
  ...TRANSLATED_LANGS,
  nb: 'Bokmål',
  sv: 'Svenska',
  fi: 'Suomi',
  da: 'Dansk',
  cs: 'Čeština',
  km: 'ខ្មែរ',
  ro: 'Română',
  bg: 'Български',
  hr: 'Hrvatski',
  lt: 'Lietuvių',
  sl: 'Slovenščina',
  sk: 'Slovenčina',
  fa: 'فارسی',
  ur: 'اردو',
};

export const SUPPORTED_LANGS: Record<string, string> = { ...TRANSLATED_LANGS, zh: '中文' };

export const SUPPORTED_LANGNAMES: Record<string, string> = Object.fromEntries(
  Object.entries(SUPPORTED_LANGS).map(([code, name]) => [name, code]),
);
