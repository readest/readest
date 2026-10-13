/**
 * ReadEra backup (`ReadEra-*.bak`) parser.
 *
 * A ReadEra backup is a plain zip whose `library.json` carries the whole
 * library: one entry per document with its metadata, reading position,
 * highlights (`citations`) and `bookmarks`. The book files themselves are not
 * part of the backup, so an import can only attach data to books the user
 * already has in Readest — hence the title/author matching below, and the
 * `doc_md5` fallback for the books it cannot name.
 *
 * Locators come in two shapes:
 * - reflowable formats use CREngine XPointers, the same family KOReader emits
 *   (`/body/DocFragment[6]/body/p[2]/text().467`, see `utils/xcfi.ts`);
 * - PDFs use MuPDF page paths (`/page[402]/block[10]/line[0]/char[1]@x:y`)
 *   where the page index is 0-based.
 */

import { fullMD5, isMd5 } from './md5';

export interface ReadEraPosition {
  ratio?: number;
  page?: number;
  pagesCount?: number;
  xPath?: string;
  xPathEnd?: string;
}

export interface ReadEraNote {
  uri: string;
  /** The highlighted text, or a generated label like "Bookmark 1". */
  body: string;
  /** The user's own note attached to a highlight (`note_extra`). */
  note: string;
  /** Highlight color index, 0-4. */
  mark?: number;
  page?: number;
  position?: ReadEraPosition;
  createdAt: number;
  updatedAt: number;
}

export interface ReadEraDoc {
  format?: string;
  /** Original file name without extension. */
  fileName?: string;
  /** md5 of the whole book file, as ReadEra recorded it. */
  md5?: string;
  title?: string;
  author?: string;
  fileSize?: number;
  position?: ReadEraPosition;
  citations: ReadEraNote[];
  bookmarks: ReadEraNote[];
}

export interface ReadEraBookMatch {
  title?: string;
  sourceTitle?: string;
  author?: string;
  format?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const parseReadEraPosition = (raw: unknown): ReadEraPosition | undefined => {
  const text = asString(raw);
  if (!text) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const record = asRecord(parsed);
  if (!record) return undefined;
  const position: ReadEraPosition = {};
  const ratio = asNumber(record['ratio']);
  const page = asNumber(record['page']);
  const pagesCount = asNumber(record['pagesCount']);
  const xPath = asString(record['xPath']);
  const xPathEnd = asString(record['xPathEnd']);
  if (ratio !== undefined) position.ratio = ratio;
  if (page !== undefined) position.page = page;
  if (pagesCount !== undefined) position.pagesCount = pagesCount;
  if (xPath) position.xPath = xPath;
  if (xPathEnd) position.xPathEnd = xPathEnd;
  return position;
};

const parseNote = (value: unknown): ReadEraNote | null => {
  const record = asRecord(value);
  if (!record) return null;
  const uri = asString(record['note_uri']);
  if (!uri) return null;
  const createdAt = asNumber(record['note_insert_time']) ?? Date.now();
  return {
    uri,
    body: asString(record['note_body']) ?? '',
    note: asString(record['note_extra']) ?? '',
    mark: asNumber(record['note_mark']),
    page: asNumber(record['note_page']),
    position: parseReadEraPosition(record['note_data']),
    createdAt,
    updatedAt: asNumber(record['note_modified_time']) ?? createdAt,
  };
};

const parseNotes = (value: unknown): ReadEraNote[] => {
  if (!Array.isArray(value)) return [];
  return value.map(parseNote).filter((note): note is ReadEraNote => note !== null);
};

const parseDoc = (value: unknown): ReadEraDoc | null => {
  const record = asRecord(value);
  const data = asRecord(record?.['data']);
  if (!data) return null;
  // Documents the user deleted stay in the backup with a delete timestamp.
  if (asNumber(data['doc_delete_time'])) return null;
  return {
    format: asString(data['doc_format']),
    fileName: asString(data['doc_file_name_title']),
    md5: asString(data['doc_md5']),
    title: asString(data['user_title']) ?? asString(data['doc_title']),
    author: asString(data['user_authors']) ?? asString(data['doc_authors']),
    fileSize: asNumber(data['doc_file_size']),
    position: parseReadEraPosition(data['doc_position']),
    citations: parseNotes(record?.['citations']),
    bookmarks: parseNotes(record?.['bookmarks']),
  };
};

/** Parse the `library.json` payload of a ReadEra backup. */
export const parseReadEraBackup = (content: string): ReadEraDoc[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const root = asRecord(parsed);
  if (!root || !Array.isArray(root['docs'])) return null;
  return root['docs'].map(parseDoc).filter((doc): doc is ReadEraDoc => doc !== null);
};

/**
 * Read `library.json` out of a ReadEra backup archive. Returns null when the
 * archive is not a ReadEra backup (or not a zip at all).
 */
export const extractReadEraLibrary = async (data: ArrayBuffer): Promise<string | null> => {
  const { configureZip } = await import('./zip');
  await configureZip();
  const { ZipReader, BlobReader, TextWriter } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(new Blob([data])));
  try {
    const entries = await reader.getEntries();
    const entry = entries.find(
      (item) =>
        !item.directory &&
        (item.filename === 'library.json' || item.filename.endsWith('/library.json')),
    );
    if (!entry || entry.directory) return null;
    return await entry.getData(new TextWriter());
  } catch {
    return null;
  } finally {
    await reader.close();
  }
};

/**
 * Rewrite a ReadEra XPointer into the shape `utils/xcfi.ts` resolves against a
 * real XHTML section document, i.e. `/body/DocFragment[N]/body` followed by a
 * path relative to the section's `<body>`:
 * - ReadEra's CREngine keeps the source document's own `body` (in the sample
 *   backup for issue #5982, either `/body/body/...` or, on older DOM versions,
 *   `/body/html/body/...`) inside the fragment. KOReader's XPointers have no
 *   such level, so it has to go before the rest of the path can be resolved;
 * - `autoBoxing` elements are synthetic boxes CREngine inserts around runs of
 *   inline content and never exist in the source markup.
 */
export const normalizeReadEraXPointer = (xpointer: string): string =>
  xpointer
    .replace(/^(\/body\/DocFragment\[\d+\]\/body)\/(?:html\/)?body/, '$1')
    .replace(/\/autoBoxing(\[\d+\])?/g, '');

const normalizeText = (value: string | undefined): string =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Whether one title contains the other closely enough to be the same book. An
 * edition or subtitle suffix keeps most of the longer string ("The Little
 * Prince" inside "The Little Prince (Illustrated)"); a sequel does not ("Dune"
 * inside "Dune Messiah" or "Dune 2"), and importing its annotations would write
 * another book's highlights into this one. A short title carries too little of
 * either signal, so it has to match exactly. Books this rejects are still found
 * by `findReadEraDocByFileMd5` when the file is the one ReadEra read.
 */
const MIN_CONTAINED_TITLE_LENGTH = 12;

const containsTitle = (a: string, b: string): boolean => {
  const shorter = Math.min(a.length, b.length);
  if (shorter < MIN_CONTAINED_TITLE_LENGTH) return false;
  if (!a.includes(b) && !b.includes(a)) return false;
  return shorter / Math.max(a.length, b.length) >= 0.5;
};

/** ReadEra formats that map onto a Readest book format of the same name. */
const matchesFormat = (docFormat: string | undefined, bookFormat: string | undefined): boolean => {
  if (!docFormat || !bookFormat) return true;
  return docFormat.toUpperCase() === bookFormat.toUpperCase();
};

/**
 * Pick the backup entry that belongs to `book` by title, file name and author.
 * ReadEra keys documents by the sha1/md5 of the whole file while Readest uses a
 * partial md5, so the two hashes never line up on their own; when this decides
 * nothing the caller hashes the file itself and uses `findReadEraDocByFileMd5`.
 */
export const findReadEraDocForBook = (
  docs: ReadEraDoc[],
  book: ReadEraBookMatch,
): ReadEraDoc | null => {
  const titles = [book.title, book.sourceTitle].map(normalizeText).filter(Boolean);
  if (!titles.length) return null;
  const author = normalizeText(book.author);

  let best: { doc: ReadEraDoc; score: number; notes: number } | null = null;
  for (const doc of docs) {
    if (!matchesFormat(doc.format, book.format)) continue;
    const candidates = [doc.title, doc.fileName].map(normalizeText).filter(Boolean);
    let score = 0;
    for (const title of titles) {
      for (const candidate of candidates) {
        if (candidate === title) score = Math.max(score, 2);
        else if (containsTitle(candidate, title)) score = Math.max(score, 1);
      }
    }
    if (!score) continue;
    if (author && author === normalizeText(doc.author)) score += 1;
    if (score < 2) continue;

    const notes = doc.citations.length + doc.bookmarks.length;
    if (!best || score > best.score || (score === best.score && notes > best.notes)) {
      best = { doc, score, notes };
    }
  }
  return best?.doc ?? null;
};

const fileMd5Cache = new Map<string, Promise<string>>();

/**
 * The md5 ReadEra keys a document by: of the whole file, not the `partialMD5`
 * Readest keys books by. Reading a whole book is expensive, so the result is
 * kept for the session, keyed by the book's own hash.
 */
export const getReadEraFileMd5 = (bookHash: string, file: File): Promise<string> => {
  let hash = fileMd5Cache.get(bookHash);
  if (!hash) {
    hash = fullMD5(file);
    fileMd5Cache.set(bookHash, hash);
  }
  return hash;
};

/**
 * Pick the backup entry whose file is byte for byte the book being read. This
 * is exact where the title matching above can only guess, but it costs a full
 * read of the book, so the import reaches for it only when the titles decide
 * nothing.
 */
export const findReadEraDocByFileMd5 = (docs: ReadEraDoc[], md5: string): ReadEraDoc | null => {
  const wanted = md5.toLowerCase();
  if (!isMd5(wanted)) return null;
  return docs.find((doc) => doc.md5?.toLowerCase() === wanted) ?? null;
};
