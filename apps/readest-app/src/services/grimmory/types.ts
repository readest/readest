// Wire types of the Grimmory REST API (v3.5.0) that the integration uses.

/** Grimmory's file type names, e.g. EPUB, PDF, CBX, FB2, MOBI, AZW3. */
export type GrimmoryBookType = string;

export interface GrimmoryBookFile {
  id: number;
  bookId?: number;
  fileName?: string;
  /** File size in KiB, rounded down. */
  fileSizeKb?: number | null;
  bookType?: GrimmoryBookType | null;
  extension?: string | null;
}

export interface GrimmoryEpubProgress {
  cfi?: string | null;
  href?: string | null;
  /** 0-100. */
  percentage?: number | null;
}

export interface GrimmoryPageProgress {
  page?: number | null;
  /** 0-100. */
  percentage?: number | null;
}

export interface GrimmoryBook {
  id: number;
  title?: string | null;
  metadata?: { title?: string | null; authors?: string[] | null } | null;
  primaryFile?: GrimmoryBookFile | null;
  alternativeFormats?: GrimmoryBookFile[] | null;
  epubProgress?: GrimmoryEpubProgress | null;
  pdfProgress?: GrimmoryPageProgress | null;
  cbxProgress?: GrimmoryPageProgress | null;
  readStatus?: string | null;
  /** ISO instant. */
  lastReadTime?: string | null;
}

export type GrimmoryAnnotationStyle = 'highlight' | 'underline' | 'strikethrough' | 'squiggly';

export interface GrimmoryAnnotation {
  id: number;
  bookId: number;
  cfi: string;
  text: string;
  color?: string | null;
  style?: GrimmoryAnnotationStyle | null;
  note?: string | null;
  chapterTitle?: string | null;
  /** Server-local datetime without a zone, e.g. 2026-11-05T14:04:52. */
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface GrimmoryAnnotationCreate {
  bookId: number;
  cfi: string;
  text: string;
  color?: string;
  style?: GrimmoryAnnotationStyle;
  note?: string;
  chapterTitle?: string;
}

/** A null field is left unchanged by the server; an empty note clears it. */
export interface GrimmoryAnnotationUpdate {
  color?: string;
  style?: GrimmoryAnnotationStyle;
  note?: string;
}

export interface GrimmoryBookmark {
  id: number;
  bookId: number;
  cfi?: string | null;
  pageNumber?: number | null;
  title?: string | null;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface GrimmoryBookmarkCreate {
  bookId: number;
  cfi: string;
  title?: string;
}

export interface GrimmoryBookmarkUpdate {
  title?: string;
  notes?: string;
}

export interface GrimmoryProgressUpdate {
  bookId: number;
  epubProgress?: { cfi: string; href?: string; percentage: number };
  pdfProgress?: { page: number; percentage: number };
  cbxProgress?: { page: number; percentage: number };
  fileProgress?: {
    bookFileId: number;
    positionData: string;
    positionHref?: string;
    progressPercent: number;
  };
}

export type GrimmoryReadStatus = 'UNREAD' | 'READING' | 'READ' | 'PAUSED';

export interface GrimmoryReadingSession {
  bookId: number;
  bookType?: GrimmoryBookType;
  /** ISO instants. */
  startTime: string;
  endTime: string;
  durationSeconds: number;
  startProgress?: number;
  endProgress?: number;
  progressDelta?: number;
}

export interface GrimmorySessionPage {
  /** Newest first. */
  content: { startTime?: string | null }[];
  page?: { number: number; totalPages: number };
}

/** Body of POST /api/grimmory, the web build's proxy for public servers. */
export interface GrimmoryProxyPayload {
  serverUrl: string;
  /** Path below the server origin, starting with /api/v1/. */
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}
