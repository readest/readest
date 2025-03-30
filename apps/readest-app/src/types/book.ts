export type BookFormat = 'EPUB' | 'PDF' | 'MOBI' | 'CBZ' | 'FB2' | 'FBZ';
export type BookNoteType = 'bookmark' | 'annotation' | 'excerpt';
export type HighlightStyle = 'highlight' | 'underline' | 'squiggly';
export type HighlightColor = 'red' | 'yellow' | 'green' | 'blue' | 'violet';

export interface Book {
  // if Book is a remote book we just lazy load the book content via url
  url?: string;
  // if Book is a transient local book we can load the book content via filePath
  filePath?: string;
  hash: string;
  format: BookFormat;
  title: string;
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

  lastUpdated?: number; // deprecated in favor of updatedAt
  progress?: [number, number]; // Add progress field: [current, total], 1-based page number
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

export interface BookNote {
  bookHash?: string;
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
  marginPx: number;
  gapPercent: number;
  scrolled: boolean;
  disableClick: boolean;
  swapClickArea: boolean;
  continuousScroll: boolean;
  maxColumnCount: number;
  maxInlineSize: number;
  maxBlockSize: number;
  animated: boolean;
  writingMode: WritingMode;
  vertical: boolean;
  rtl: boolean;
  doubleBorder: boolean;
  borderColor: string;
  showHeader: boolean;
  showFooter: boolean;
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
  invert: boolean;
  theme: string;
  overrideFont: boolean;
  overrideLayout: boolean;
  userStylesheet: string;
}

export interface BookFont {
  serifFont: string;
  sansSerifFont: string;
  monospaceFont: string;
  defaultFont: string;
  defaultFontSize: number;
  minimumFontSize: number;
  fontWeight: number;
}

export interface ViewConfig {
  sideBarTab: string;
  uiLanguage: string;
}

export interface TTSConfig {
  ttsRate: number;
  ttsVoice: string;
}

export interface ViewSettings extends BookLayout, BookStyle, BookFont, ViewConfig, TTSConfig {}

export interface BookProgress {
  location: string;
  sectionId: number;
  sectionHref: string;
  sectionLabel: string;
  section: PageInfo;
  pageinfo: PageInfo;
  range: Range;
}

export interface BookSearchConfig {
  scope: 'book' | 'section';
  matchCase: boolean;
  matchWholeWords: boolean;
  matchDiacritics: boolean;
  index?: number;
  query?: string;
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
  progress?: [number, number]; // [current pagenum, total pagenum], 1-based page number
  location?: string;
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
  user_id: string;
  updated_at: number | null;
  deleted_at: number | null;
}

export interface BooksGroup {
  id: string;
  name: string;
  books: Book[];

  updatedAt: number;
}
export interface BookContent {
  book: Book;
  file: File;
  config: BookConfig;
}
