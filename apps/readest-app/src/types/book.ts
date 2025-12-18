import { BookMetadata } from '@/libs/document';
import { TTSHighlightOptions } from '@/services/tts/types';

export type BookFormat = 'EPUB' | 'PDF' | 'MOBI' | 'AZW' | 'AZW3' | 'CBZ' | 'FB2' | 'FBZ';
export type BookNoteType = 'bookmark' | 'annotation' | 'excerpt';
export type HighlightStyle = 'highlight' | 'underline' | 'squiggly';
export type HighlightColor = 'red' | 'yellow' | 'green' | 'blue' | 'violet';

export const FIXED_LAYOUT_FORMATS: Set<BookFormat> = new Set(['PDF', 'CBZ']);

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

  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;

  uploadedAt?: number | null;
  downloadedAt?: number | null;
  coverDownloadedAt?: number | null;
  syncedAt?: number | null;

  lastUpdated?: number; // deprecated in favor of updatedAt
  progress?: [number, number]; // Add progress field: [current, total], 1-based page number
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
  cfi: string;
  text?: string;
  style?: HighlightStyle;
  color?: HighlightColor;
  note: string;

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
  disableClick: boolean;
  fullscreenClickArea: boolean;
  swapClickArea: boolean;
  disableDoubleClick: boolean;
  volumeKeysToFlip: boolean;
  continuousScroll: boolean;
  maxColumnCount: number;
  maxInlineSize: number;
  maxBlockSize: number;
  animated: boolean;
  isEink: boolean;
  writingMode: WritingMode;
  vertical: boolean;
  rtl: boolean;
  scrollingOverlap: number;
  allowScript: boolean;
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
  invertImgColorInDark: boolean;
  theme: string;
  overrideFont: boolean;
  overrideLayout: boolean;
  overrideColor: boolean;
  backgroundTextureId: string;
  backgroundOpacity: number;
  backgroundSize: string;
  codeHighlighting: boolean;
  codeLanguage: string;
  userStylesheet: string;
  userUIStylesheet: string;

  // fixed-layout specific
  zoomMode: 'fit-page' | 'fit-width' | 'original-size' | 'custom';
  spreadMode: 'auto' | 'none';
  keepCoverSpread: boolean;
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
  showBarsOnScroll: boolean;
  showMarginsOnScroll: boolean;
  progressStyle: 'percentage' | 'fraction';
  progressInfoMode: 'remaining' | 'progress' | 'all' | 'none';
}

export interface TTSConfig {
  ttsRate: number;
  ttsVoice: string;
  ttsLocation: string;
  showTTSBar: boolean;
  ttsHighlightOptions: TTSHighlightOptions;
}

export interface TranslatorConfig {
  translationEnabled: boolean;
  translationProvider: string;
  translateTargetLang: string;
  showTranslateSource: boolean;
  ttsReadAloudText: string;
}

export interface ScreenConfig {
  screenOrientation: 'auto' | 'portrait' | 'landscape';
}


export interface ReplacementRule {
  id: string;
  pattern: string;
  replacement: string;
  enabled: boolean;
  isRegex: boolean;
  order: number; // Lower numbers apply first
  singleInstance?: boolean; // If true, only replace the specific occurrence
  sectionHref?: string; // Section where the single-instance replacement applies
  occurrenceIndex?: number; // Which occurrence in the section (0-based)
  wholeWord?: boolean; // Match whole words only (uses \b word boundaries)
  caseSensitive?: boolean; // Case-sensitive matching (default true)
  global?: boolean; // Marks global-scope rules explicitly
}

export interface ReplacementRulesConfig {
  replacementRules?: ReplacementRule[];
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
    ReplacementRulesConfig {}

export interface BookProgress {
  location: string;
  sectionId: number;
  sectionHref: string;
  sectionLabel: string;
  section: PageInfo;
  pageinfo: PageInfo;
  timeinfo: TimeInfo;
  range: Range;
}

export interface BookSearchConfig {
  scope: 'book' | 'section';
  matchCase: boolean;
  matchWholeWords: boolean;
  matchDiacritics: boolean;
  index?: number;
  query?: string;
  acceptNode?: (node: Node) => number;
}

export interface SearchExcerpt {
  pre: string;
  match: string;
  post: string;
}

export interface BookSearchMatch {
  cfi: string;
  excerpt: SearchExcerpt;
}

export interface BookSearchResult {
  label: string;
  subitems: BookSearchMatch[];
  progress?: number;
}

export interface BookConfig {
  bookHash?: string;
  metaHash?: string;
  progress?: [number, number]; // [current pagenum, total pagenum], 1-based page number
  location?: string; // CFI of the current location
  xpointer?: string; // XPointer of the current location (for Koreader interoperability)
  booknotes?: BookNote[];
  searchConfig?: Partial<BookSearchConfig>;
  viewSettings?: Partial<ViewSettings>;

  lastSyncedAtConfig?: number;
  lastSyncedAtNotes?: number;

  updatedAt: number;
}

export interface BookDataRecord {
  id: string;
  book_hash: string;
  meta_hash?: string;
  user_id: string;
  updated_at: number | null;
  deleted_at: number | null;
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
