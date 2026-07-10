import { BookMetadata } from '@/libs/document';
import { TTSHighlightOptions } from '@/services/tts/types';
import { TTSHighlightGranularity } from '@/services/tts/types';
import { TTSMediaMetadataMode } from '@/services/tts/types';
import type { AnnotationLinkType } from '@/utils/deeplink';
import { AnnotationToolType } from './annotator';

export type BookFormat =
  | 'EPUB'
  | 'PDF'
  | 'MOBI'
  | 'AZW'
  | 'AZW3'
  | 'CBZ'
  | 'FB2'
  | 'FBZ'
  | 'TXT'
  | 'MD';
export type BookNoteType = 'bookmark' | 'annotation' | 'excerpt';
export type ReadingStatus = 'unread' | 'reading' | 'finished' | 'abandoned';
export type HighlightStyle = 'highlight' | 'underline' | 'squiggly';
// Predefined highlight colors, can be extended with custom hex colors
export type HighlightColor = 'red' | 'yellow' | 'green' | 'blue' | 'violet' | string;
export const DEFAULT_HIGHLIGHT_COLORS = ['red', 'yellow', 'green', 'blue', 'violet'] as const;
export type DefaultHighlightColor = (typeof DEFAULT_HIGHLIGHT_COLORS)[number];
// A user-added highlight color with optional label
export interface UserHighlightColor {
  hex: string;
  label?: string;
}
export type ReadingRulerColor = 'transparent' | 'yellow' | 'green' | 'blue' | 'rose';

export interface ParagraphModeConfig {
  enabled: boolean;
}

export const FIXED_LAYOUT_FORMATS: Set<BookFormat> = new Set(['PDF', 'CBZ']);

/**
 * Lookup tables built from a Book[] for O(1) hash and metaHash queries during
 * batch import. Mutated in place by importBook so subsequent files in the
 * same batch see books added by earlier files. Defined here (rather than in
 * services/bookService) so the AppService interface in types/system can
 * reference it without an inline `import(...)` type.
 */
export interface BookLookupIndex {
  byHash: Map<string, Book>;
  byMetaKey: Map<string, Book[]>; // key = `${metaHash}:${format}`
  // Maps normalized absolute source path -> Book for in-place imports.
  // Lets the importer recognize "I already have this exact file" without
  // having to open, parse, and hash it again. Only books with a non-empty
  // `filePath` and `!deletedAt` are indexed. The key is produced by
  // `normalizeFilePathForIndex` so callers must use the same helper to
  // probe; importBook handles that internally.
  byFilePath: Map<string, Book>;
}

/**
 * User-facing options for AppService.importBook. The bookService implementation
 * extends this with required callbacks (saveBookConfig / generateCoverImageUrl)
 * that are bound by the AppService instance.
 */
export interface ImportBookOptions {
  /** Whether to copy the file into the Books directory. Defaults to true. */
  saveBook?: boolean;
  /** Whether to extract and save a cover image. Defaults to true. */
  saveCover?: boolean;
  /** Whether to overwrite an existing file at the same path. Defaults to false. */
  overwrite?: boolean;
  /** Whether the import is transient (not stored long-term). Defaults to false. */
  transient?: boolean;
  /**
   * If true, do NOT copy the source file into Books/<hash>/. Instead, persist
   * an absolute filePath on the Book and let isBookAvailable / loadBookContent
   * fall back to it. The caller is responsible for verifying the source is
   * already inside the user's chosen library root (customRootDir) so that the
   * file remains stable across launches. Sidecar files (cover.png, config.json,
   * nav.json) are still written to Books/<hash>/ as usual. Defaults to false.
   */
  inPlace?: boolean;
  /** Pre-built lookup index for O(1) dedup during batch imports. */
  lookupIndex?: BookLookupIndex;
}

export interface Book {
  // if Book is a remote book we just lazy load the book content via url
  url?: string;
  // if Book is a transient local book we can load the book content via filePath
  filePath?: string;
  // Partial md5 hash of the book file, used as the unique identifier
  hash: string;
  // Metadata md5 hash, used to aggregate different versions of the same book
  metaHash?: string;
  format: BookFormat;
  title: string; // editable title from metadata
  sourceTitle?: string; // parsed when the book is imported and used to locate the file
  author: string;
  group?: string; // deprecated in favor of groupId and groupName
  groupId?: string;
  groupName?: string;
  tags?: string[];
  coverImageUrl?: string | null;
  // Partial MD5 of the local cover.png. Content-addressed cover-change signal:
  // a peer re-downloads the cover iff its synced value differs from the local
  // one (issue #4544). Invariant: coverHash === partialMD5(cover.png).
  coverHash?: string | null;

  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;

  uploadedAt?: number | null;
  downloadedAt?: number | null;
  coverDownloadedAt?: number | null;
  // Field-level LWW timestamp for the cover, so a page-turn that wins whole-row
  // LWW on updatedAt cannot clobber a cover edit (mirrors readingStatusUpdatedAt).
  coverUpdatedAt?: number | null;
  syncedAt?: number | null;

  lastUpdated?: number; // deprecated in favor of updatedAt
  progress?: [number, number]; // Add progress field: [current, total], 1-based page number
  readingStatus?: ReadingStatus;
  readingStatusUpdatedAt?: number; // ms; bumped only when readingStatus changes
  primaryLanguage?: string;

  metadata?: BookMetadata;
}

export interface BookGroupType {
  id: string;
  name: string;
}

export interface PageInfo {
  current: number;
  next?: number;
  total: number;
}

// Remaining time of the book in minutes
export interface TimeInfo {
  section: number;
  total: number;
}

export interface BookNote {
  bookHash?: string;
  metaHash?: string;
  id: string;
  type: BookNoteType;
  cfi: string; // Canonicalized CFI for the note location
  xpointer0?: string; // Start XPointer for the note location
  xpointer1?: string; // End XPointer for the note location
  page?: number;
  text?: string;
  style?: HighlightStyle;
  color?: HighlightColor;
  note: string;
  /**
   * If true, this annotation should be applied to every occurrence of `text`
   * within the same section (chapter/spine item), in addition to the original
   * range identified by `cfi`. Defaults to false / undefined (single-range).
   * Only meaningful for annotations that have a `text` value; ignored for
   * bookmarks and excerpts, and for fixed-layout formats (e.g. PDF).
   */
  global?: boolean;

  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface BooknoteGroup {
  id: number;
  href: string;
  label: string;
  booknotes: BookNote[];
}

export type WritingMode = 'auto' | 'horizontal-tb' | 'horizontal-rl' | 'vertical-rl';

export interface BookLayout {
  marginTopPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  marginRightPx: number;
  marginPx?: number; // deprecated
  compactMarginTopPx: number;
  compactMarginBottomPx: number;
  compactMarginLeftPx: number;
  compactMarginRightPx: number;
  compactMarginPx?: number; // deprecated
  gapPercent: number;
  scrolled: boolean;
  webtoonMode: boolean;
  noContinuousScroll: boolean;
  disableClick: boolean;
  disableSwipe: boolean;
  fullscreenClickArea: boolean;
  swapClickArea: boolean;
  disableDoubleClick: boolean;
  volumeKeysToFlip: boolean;
  maxColumnCount: number;
  maxInlineSize: number;
  maxBlockSize: number;
  writingMode: WritingMode;
  vertical: boolean;
  rtl: boolean;
  scrollingOverlap: number;
  allowScript: boolean;
  hideScrollbar: boolean;
  /* Auto Scroll (#4998) speed as a percentage; 100 = AUTO_SCROLL_BASE_PX_PER_SEC. */
  autoScrollSpeed: number;
}

export interface BookStyle {
  zoomLevel: number;
  paragraphMargin: number;
  lineHeight: number;
  wordSpacing: number;
  letterSpacing: number;
  textIndent: number;
  fullJustification: boolean;
  hyphenation: boolean;
  theme: string;
  backgroundTextureId: string;
  backgroundOpacity: number;
  backgroundSize: string;
  highlightOpacity: number;
  codeHighlighting: boolean;
  codeLanguage: string;
  userStylesheet: string;
  userUIStylesheet: string;

  overrideFont: boolean;
  overrideLayout: boolean;
  overrideColor: boolean;
  useBookLayout: boolean;

  // fixed-layout specific
  zoomMode: 'fit-page' | 'fit-width' | 'original-size' | 'custom';
  spreadMode: 'auto' | 'none';
  keepCoverSpread: boolean;
  invertImgColorInDark: boolean;
  applyThemeToPDF: boolean;
  contrast: number;
}

export interface BookFont {
  serifFont: string;
  sansSerifFont: string;
  monospaceFont: string;
  defaultFont: string;
  defaultCJKFont: string;
  defaultFontSize: number;
  minimumFontSize: number;
  fontWeight: number;
}

export type ConvertChineseVariant =
  | 'none'
  | 's2t'
  | 't2s'
  | 's2tw'
  | 's2hk'
  | 's2twp'
  | 'tw2s'
  | 'hk2s'
  | 'tw2sp';

export interface BookLanguage {
  replaceQuotationMarks: boolean;
  convertChineseVariant: ConvertChineseVariant;
}

// 'push' slides the whole strip; 'slide' and 'curl' layer the outgoing page
// over the still incoming page (Apple Books style, needs View Transitions).
export type PageTurnStyle = 'push' | 'slide' | 'curl';
export interface ViewConfig {
  sideBarTab: string;
  uiLanguage: string;
  sortedTOC: boolean;

  doubleBorder: boolean;
  borderColor: string;

  showHeader: boolean;
  showFooter: boolean;
  showRemainingTime: boolean;
  showRemainingPages: boolean;
  showProgressInfo: boolean;
  showStickyProgressBar: boolean;
  showCurrentTime: boolean;
  use24HourClock: boolean;
  showCurrentBatteryStatus: boolean;
  showBatteryPercentage: boolean;
  showPaginationButtons: boolean;
  progressStyle: 'percentage' | 'fraction' | 'reference';
  referencePageCount: number;

  animated: boolean;
  pageTurnStyle: PageTurnStyle;
  isEink: boolean;
  isColorEink: boolean;

  paragraphMode: ParagraphModeConfig;

  readingRulerEnabled: boolean;
  readingRulerLines: number;
  readingRulerPosition: number;
  readingRulerOpacity: number;
  readingRulerColor: ReadingRulerColor;
}

export interface TTSConfig {
  ttsRate: number;
  ttsSentenceGap: number;
  ttsVoice: string;
  ttsLocation: string;
  ttsHighlightOptions: TTSHighlightOptions;
  ttsHighlightGranularity: TTSHighlightGranularity;
  ttsMediaMetadata: TTSMediaMetadataMode;
}

export interface TranslatorConfig {
  translationEnabled: boolean;
  translationProvider: string;
  translateTargetLang: string;
  showTranslateSource: boolean;
  ttsReadAloudText: string;
}

export interface NoteExportConfig {
  includeTitle: boolean;
  includeAuthor: boolean;
  includeDate: boolean;
  includeChapterTitles: boolean;
  includeQuotes: boolean;
  includeNotes: boolean;
  includePageNumber: boolean;
  includeTimestamp: boolean;
  includeChapterSeparator: boolean;
  linkType: AnnotationLinkType;
  noteSeparator: string;
  useCustomTemplate: boolean;
  customTemplate: string;
  exportAsPlainText: boolean;
  // Highlight colors/styles to omit from the export. Empty arrays export
  // everything; storing exclusions keeps colors/styles added later included
  // by default (#4801).
  excludedColors: HighlightColor[];
  excludedStyles: HighlightStyle[];
}

export interface AnnotatorConfig {
  enableAnnotationQuickActions: boolean;
  annotationQuickAction: AnnotationToolType | null;
  annotationToolbarItems: AnnotationToolType[];
  copyToNotebook: boolean;
  noteExportConfig: NoteExportConfig;
}

export interface WordLensConfig {
  wordLensEnabled: boolean;
  /** Difficulty slider, 1 (fewest hints) .. 5 (most hints). */
  wordLensLevel: number;
  /** Hint (target) language; '' = auto (app UI language). */
  wordLensHintLang: string;
  /** Gloss (<rt>) font size relative to the word, in em (default 0.5). */
  wordLensGlossFontSize: number;
  /** Gloss (<rt>) color as a hex string; '' = default (muted, theme-adaptive). */
  wordLensGlossColor: string;
}

export interface ScreenConfig {
  screenOrientation: 'auto' | 'portrait' | 'landscape';
}

export type ProofreadScope = 'selection' | 'book' | 'library';

export interface ProofreadRule {
  id: string;
  scope: ProofreadScope;
  pattern: string;
  replacement: string;
  cfi?: string;
  sectionHref?: string;
  enabled: boolean;
  isRegex: boolean;
  order: number; // Lower numbers apply first
  wholeWord?: boolean; // Match whole words only (uses \b word boundaries)
  caseSensitive?: boolean; // Case-sensitive matching (default true)
  onlyForTTS?: boolean; // Only replace text for TTS, not in the book display (only for book/library scope)
  // CRDT sync fields (book/selection scope rides the book-config sync). `updatedAt`
  // is the last-write-wins key for the per-id merge; `deletedAt` is a tombstone so a
  // deletion survives the merge instead of being resurrected by the peer's copy.
  // Library-scope rules sync via the settings replica (whole-field LWW) and don't
  // need a tombstone, so these stay optional for back-compat with older configs.
  updatedAt?: number;
  deletedAt?: number | null;
}

export interface ProofreadRulesConfig {
  proofreadRules?: ProofreadRule[];
}

export interface ViewSettingsConfig {
  isGlobal: boolean;
}

export interface ViewSettings
  extends BookLayout,
    BookStyle,
    BookFont,
    BookLanguage,
    ViewConfig,
    TTSConfig,
    TranslatorConfig,
    ScreenConfig,
    ProofreadRulesConfig,
    AnnotatorConfig,
    WordLensConfig,
    ViewSettingsConfig {}

export interface BookProgress {
  location: string;
  sectionHref: string;
  sectionLabel: string;
  section: PageInfo;
  pageinfo: PageInfo;
  pageItem?: { label?: string; href?: string } | null;
  timeinfo: TimeInfo;
  // Overall reading position in foliate's size-domain (0..1), matching the
  // domain used by the sticky progress bar's chapter ticks.
  fraction: number;
  index: number;
  range: Range;
  page: number;
}

export type SearchMode = 'contains' | 'whole-words' | 'regex' | 'nearby-words';

export interface BookSearchConfig {
  scope: 'book' | 'section';
  mode: SearchMode;
  matchCase: boolean;
  matchDiacritics: boolean;
  // nearby-words: maximum number of words separating the matched words
  nearbyWords?: number;
  /** @deprecated since schema v3 — mirrors `mode === 'whole-words'`; kept for sync wire back-compat. */
  matchWholeWords?: boolean;
  index?: number;
  query?: string;
  acceptNode?: (node: Node) => number;

  // pre-cached search results
  results?: BookSearchResult[] | BookSearchMatch[] | null;
}

export interface SearchExcerpt {
  pre: string;
  match: string;
  post: string;
  // nearby-words: the cluster window split into matched (emphasized) words and gaps
  segments?: { text: string; emphasized: boolean }[];
}

export interface BookSearchMatch {
  cfi: string;
  // nearby-words: per-word CFIs to highlight (>= 2); absent for single-span matches
  cfis?: string[];
  excerpt: SearchExcerpt;
}

export interface BookSearchResult {
  index?: number;
  label: string;
  subitems: BookSearchMatch[];
  progress?: number;
}

export const BOOK_CONFIG_SCHEMA_VERSION = 3;

export interface BookConfig {
  schemaVersion?: number;
  bookHash?: string;
  metaHash?: string;
  progress?: [number, number]; // [current pagenum, total pagenum], 1-based page number
  location?: string; // CFI of the current location
  xpointer?: string; // XPointer of the current location (for Koreader interoperability)
  booknotes?: BookNote[];
  rsvpPosition?: { cfi: string; wordText: string };
  searchConfig?: Partial<BookSearchConfig>;
  viewSettings?: Partial<ViewSettings>;

  lastSyncedAtConfig?: number;
  lastSyncedAtNotes?: number;
  lastPushedAtConfig?: number;
  lastPushedAtNotes?: number;
  foliateImportedAt?: number;

  updatedAt: number;
}

export interface BookDataRecord {
  id: string;
  book_hash: string;
  meta_hash?: string;
  user_id: string;
  updated_at: number | null;
  deleted_at: number | null;
  // Server-assigned incremental-pull cursor, decoupled from updated_at (the
  // client event time / sort key). Present on books rows from a server that
  // ran migration 016; absent (fall back to updated_at) on older servers and
  // on config/note records. Carried over the wire as an ISO-8601 string.
  // See issue #4678.
  synced_at?: string | null;
  // Only book records carry an upload state: a book is indexed in the cloud
  // as soon as its metadata syncs, but is unavailable to peers until its file
  // blob is uploaded. Absent on config/note records.
  uploaded_at?: string | null;
}

export interface BooksGroup {
  id: string;
  name: string;
  displayName: string;
  books: Book[];

  updatedAt: number;
}
export interface BookContent {
  book: Book;
  file: File;
}
