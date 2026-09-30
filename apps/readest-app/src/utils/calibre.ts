import type { BookMetadata, CalibreSourceInfo } from '@/libs/document';
import type { CalibreBookJson } from '@/types/calibre';
import type { Book } from '@/types/book';
import { EXTS } from '@/libs/document';
import { md5 } from '@/utils/md5';
import { formatAuthors, formatTitle, getPrimaryLanguage } from '@/utils/book';

/** Scheme prefix for the synthetic filePath of a Calibre server book. */
export const CALIBRE_FILE_SCHEME = 'calibre://';

/**
 * Builds the synthetic filePath for a Calibre book:
 * `calibre://<serverId>/<libraryId>/<bookId>`. The server id is the URL-derived
 * contentId (stable across devices), so the filePath — and the stub hash
 * derived from it — identifies the same server book everywhere. The library id
 * is a folder name and may contain `/`; it is percent-encoded to keep the path
 * a strict 3-segment form (the same encoding the API requests use).
 */
export const makeCalibreFilePath = (
  serverId: string,
  libraryId: string,
  bookId: string | number,
): string => `${CALIBRE_FILE_SCHEME}${serverId}/${encodeURIComponent(libraryId)}/${bookId}`;

/** Parses a `filePath` produced by {@link makeCalibreFilePath}, or returns null if it isn't one. */
export const parseCalibreFilePath = (
  filePath: string | undefined,
): { serverId: string; libraryId: string; bookId: string } | null => {
  if (!filePath || !filePath.startsWith(CALIBRE_FILE_SCHEME)) return null;
  const rest = filePath.slice(CALIBRE_FILE_SCHEME.length);
  const parts = rest.split('/');
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  try {
    return { serverId: parts[0]!, libraryId: decodeURIComponent(parts[1]!), bookId: parts[2]! };
  } catch {
    // Malformed percent-encoding in a hand-edited or legacy path.
    return null;
  }
};

/**
 * Stable id for a Calibre server row, derived from its base URL (scheme,
 * host, port, path prefix; trailing slash dropped). Two devices adding the
 * same server derive the same id, so synced stub hashes match.
 */
export const computeCalibreServerId = (url: string): string => {
  let normalized = url.trim().replace(/\/+$/, '');
  try {
    const urlObj = new URL(normalized);
    // Credentials in the URL must not leak into the persisted id.
    urlObj.username = '';
    urlObj.password = '';
    normalized = urlObj.toString().replace(/\/+$/, '');
  } catch {
    // Invalid URL — hash as-is; the connect form validates before saving.
  }
  return md5(normalized);
};

// Best -> worst, mirroring getFormatTier's policy (EPUB > AZW3/MOBI/AZW >
// PDF/CBZ > FB2 > TXT/MD). Every entry must be an EXTS key; formats calibre
// reports but Readest cannot open (kfx, docx, prc, kepub, ...) simply fall
// outside this list, and the EXTS check below rejects anything unexpected.
const FORMAT_PREFERENCE = ['epub', 'azw3', 'mobi', 'azw', 'pdf', 'cbz', 'fb2', 'fbz', 'txt', 'md'];

/**
 * The format Readest would rather download from a calibre format list
 * (lowercase names from `formats`), or '' when the book has no format
 * Readest can open. The result is always a valid BookFormat: it is checked
 * against the EXTS keys so the uppercase cast in reconcile can never mint an
 * unknown format (whose EXTS lookup would be undefined).
 */
export const pickPreferredFormat = (formats: string[] | undefined | null): string => {
  if (!formats?.length) return '';
  const available = new Set(formats.map((f) => f.toLowerCase()));
  for (const fmt of FORMAT_PREFERENCE) {
    // EXTS guard keeps this correct if the preference list and EXTS drift.
    if (available.has(fmt) && fmt.toUpperCase() in EXTS) return fmt;
  }
  return '';
};

/** True when `book` came from a Calibre server (stub or downloaded copy). */
export const isCalibreBook = (book: { filePath?: string; metadata?: Book['metadata'] }): boolean =>
  !!parseCalibreFilePath(book.filePath) || !!book.metadata?.calibreSource?.serverId;

/** True for a synced-but-not-yet-downloaded Calibre book (no local file yet). */
export const isCalibreStub = (book: Book): boolean => !!parseCalibreFilePath(book.filePath);

/**
 * The server identity of a Calibre book, from whichever anchor is present:
 * the synthetic `calibre://` filePath on undownloaded stubs, or the
 * `metadata.calibreSource` stamp that survives the download (the filePath is
 * cleared once the real file lands, so the row then behaves like a normal
 * local book for sync/open, while calibreSource keeps re-download and
 * progress sync working).
 */
export const resolveCalibreIdentity = (
  book: Pick<Book, 'filePath' | 'metadata'>,
): { serverId: string; libraryId: string; bookId: string } | null => {
  const parsed = parseCalibreFilePath(book.filePath);
  if (parsed) return parsed;
  const source = book.metadata?.calibreSource;
  if (source?.serverId && source.libraryId && source.bookId) {
    return { serverId: source.serverId, libraryId: source.libraryId, bookId: source.bookId };
  }
  return null;
};

/**
 * The download format ladder: the preferred format first, then the rest of
 * the server-advertised formats in Readest's preference order (not the
 * server's listing order). Entries that aren't valid BookFormats are dropped
 * (pickPreferredFormat([f]) === f is the whitelist check). The preferred
 * entry stays even when the list is missing or doesn't contain it —
 * pre-formats rows keep their old behavior.
 */
export const buildDownloadLadder = (
  preferred: string | undefined,
  available: string[] | undefined,
): string[] => {
  const head = preferred?.toLowerCase() ?? '';
  const rest: string[] = [];
  for (const f of available ?? []) {
    const fmt = f.toLowerCase();
    if (fmt && fmt !== head && !rest.includes(fmt) && pickPreferredFormat([fmt]) === fmt) {
      rest.push(fmt);
    }
  }
  const rank = (fmt: string) => {
    const index = FORMAT_PREFERENCE.indexOf(fmt);
    return index === -1 ? FORMAT_PREFERENCE.length : index;
  };
  rest.sort((a, b) => rank(a) - rank(b));
  return head ? [head, ...rest] : rest;
};

/**
 * Build the `metadata` payload a Calibre book syncs with. Mirrors
 * buildAbsBookMetadata (src/utils/audiobook.ts): identity fields with no
 * cloud `books` column ride inside `metadata`, which does sync.
 */
export const buildCalibreBookMetadata = (
  serverBook: CalibreBookJson,
  source: CalibreSourceInfo,
): BookMetadata => {
  const metadata: BookMetadata = {
    title: serverBook.title || 'Untitled',
    author: serverBook.authors?.join(', ') || '',
    language: serverBook.languages?.length ? serverBook.languages : '',
  };
  if (serverBook.publisher) metadata.publisher = serverBook.publisher;
  if (serverBook.pubdate) metadata.published = serverBook.pubdate;
  if (serverBook.comments) metadata.description = serverBook.comments;
  if (serverBook.tags?.length) metadata.subject = serverBook.tags;
  if (serverBook.rating) metadata.rating = serverBook.rating;
  if (serverBook.series) {
    metadata.series = serverBook.series;
    if (typeof serverBook.series_index === 'number') {
      metadata.seriesIndex = serverBook.series_index;
    }
  }
  const isbn = serverBook.identifiers?.['isbn'];
  if (isbn) metadata.isbn = isbn;
  const identifier = serverBook.identifiers?.['uri'] ?? serverBook.uuid;
  if (identifier) metadata.identifier = identifier;
  metadata.calibreSource = source;
  return metadata;
};

/**
 * Derive the denormalized Book display fields from a metadata payload
 * (title/author/language), matching how imports hydrate them.
 */
export const hydrateCalibreBookFields = (
  book: Pick<Book, 'metadata' | 'title' | 'author' | 'primaryLanguage'>,
): void => {
  const metadata = book.metadata;
  if (!metadata) return;
  book.title = formatTitle(metadata.title);
  book.author = formatAuthors(metadata.author, book.primaryLanguage);
  book.primaryLanguage = getPrimaryLanguage(metadata.language);
};
