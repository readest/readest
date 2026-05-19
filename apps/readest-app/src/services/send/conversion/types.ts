/** MIME types that Send to Readest converts to EPUB before import. */
export type ConvertibleMime =
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
  | 'application/rtf'
  | 'text/rtf'
  | 'text/html'
  | 'application/xhtml+xml'
  | 'text/plain'
  | 'text/uri-list'; // a web article URL

export interface ConvertedBook {
  /** The generated `.epub` file, ready for the normal import pipeline. */
  file: File;
  title: string;
  author: string;
}

/** One chapter of body-inner HTML (already sanitized). */
export interface EpubChapter {
  title: string;
  html: string;
}

export interface EpubBuildMetadata {
  title: string;
  author: string;
  language: string;
  /** Stable EPUB `dc:identifier` — derive deterministically so re-converting
   *  the same source yields the same bytes and dedups on import. */
  identifier: string;
}

export class ConversionError extends Error {
  constructor(
    message: string,
    readonly code: 'unsupported_type' | 'empty_input' | 'parse_failed' | 'fetch_failed',
  ) {
    super(message);
    this.name = 'ConversionError';
  }
}
