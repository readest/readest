import { Book } from '@/types/book';
import { EXTS } from '@/libs/document';
import { makeSafeFilename } from '@/utils/misc';

/**
 * Layout convention for the WebDAV "Readest" subtree under the user's
 * configured rootPath. The whole sync feature is scoped to this subtree so
 * we never touch unrelated files in the user's WebDAV.
 *
 * Tree:
 *   <rootPath>/
 *     Readest/
 *       library.json                                 ← shared index
 *       books/
 *         <hash>/
 *           <safe-title>.<ext>                       ← the book file
 *           cover.png                                ← optional
 *           config.json                              ← progress + booknotes
 *
 * Why hash directories: avoids title collisions and makes title edits a
 * pure metadata operation (no remote rename). The friendly file name
 * inside the directory keeps the WebDAV client experience readable.
 */

export const WEBDAV_BASE_DIR = 'Readest';
export const WEBDAV_BOOKS_DIR = 'books';
export const WEBDAV_LIBRARY_FILE = 'library.json';
export const WEBDAV_BOOK_CONFIG_FILE = 'config.json';
export const WEBDAV_BOOK_COVER_FILE = 'cover.png';

/**
 * Normalise the user-entered rootPath so the rest of the code can rely on
 * a leading slash and no trailing slash (root = "/").
 */
export const normalizeRoot = (rootPath: string | undefined): string => {
  if (!rootPath) return '/';
  let p = rootPath.trim();
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
};

/** Join normalised path segments with single slashes, leading-slash kept. */
const join = (...parts: string[]): string => {
  const cleaned = parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter((p) => p.length > 0);
  return `/${cleaned.join('/')}`;
};

/** Absolute path of the Readest base directory (where library.json lives). */
export const buildBasePath = (rootPath: string): string =>
  join(normalizeRoot(rootPath), WEBDAV_BASE_DIR);

/** Absolute path of the per-book directory keyed by hash. */
export const buildBookDirPath = (rootPath: string, bookHash: string): string =>
  join(buildBasePath(rootPath), WEBDAV_BOOKS_DIR, bookHash);

/** Absolute path of a book's config.json (progress + booknotes). */
export const buildBookConfigPath = (rootPath: string, bookHash: string): string =>
  join(buildBookDirPath(rootPath, bookHash), WEBDAV_BOOK_CONFIG_FILE);

/** Absolute path of the shared library.json index. */
export const buildLibraryPath = (rootPath: string): string =>
  join(buildBasePath(rootPath), WEBDAV_LIBRARY_FILE);

/**
 * Friendly book file name "<sanitized title>.<ext>" used inside the
 * per-hash directory. Collisions across books are impossible because
 * each book lives in its own hash dir; collisions inside a single
 * hash dir are also impossible because there's only ever one book file.
 *
 * Re-uses readest's existing `makeSafeFilename` so naming rules are
 * consistent with the local on-disk layout (which is `<hash>/<title>.<ext>`).
 */
export const buildBookFileName = (book: Book): string => {
  const ext = EXTS[book.format] || 'bin';
  const baseName = book.sourceTitle || book.title || book.hash;
  return `${makeSafeFilename(baseName)}.${ext}`;
};

/** Absolute path of the book file, including the friendly file name. */
export const buildBookFilePath = (rootPath: string, book: Book): string =>
  join(buildBookDirPath(rootPath, book.hash), buildBookFileName(book));

/** Absolute path of the book cover image. */
export const buildBookCoverPath = (rootPath: string, bookHash: string): string =>
  join(buildBookDirPath(rootPath, bookHash), WEBDAV_BOOK_COVER_FILE);

/**
 * Walk the parents of an absolute path, top-down, so callers can
 * MKCOL each segment idempotently before writing a file. Excludes the
 * leaf itself.
 *
 * Example: ancestorsOf('/a/b/c/file.json') -> ['/a', '/a/b', '/a/b/c']
 */
export const ancestorsOf = (absolutePath: string): string[] => {
  const segments = absolutePath.split('/').filter(Boolean);
  if (segments.length <= 1) return [];
  const out: string[] = [];
  let acc = '';
  for (let i = 0; i < segments.length - 1; i += 1) {
    acc += `/${segments[i]}`;
    out.push(acc);
  }
  return out;
};
