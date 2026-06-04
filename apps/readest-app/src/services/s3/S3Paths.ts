import { Book } from '@/types/book';
import { EXTS } from '@/libs/document';
import { makeSafeFilename } from '@/utils/misc';

export const S3_BASE_DIR = 'Readest';
export const S3_BOOKS_DIR = 'books';
export const S3_LIBRARY_FILE = 'library.json';
export const S3_BOOK_CONFIG_FILE = 'config.json';
export const S3_BOOK_COVER_FILE = 'cover.png';

const normalizeRoot = (rootPath: string | undefined): string => {
  if (!rootPath) return '';
  let p = rootPath.trim();
  if (p.startsWith('/')) p = p.slice(1);
  if (p.endsWith('/')) p = p.slice(0, -1);
  return p;
};

const join = (...parts: string[]): string => {
  const cleaned = parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter((p) => p.length > 0);
  return cleaned.join('/');
};

export const buildBasePath = (rootPath: string): string =>
  join(normalizeRoot(rootPath), S3_BASE_DIR);

export const buildBookDirPath = (rootPath: string, bookHash: string): string =>
  join(buildBasePath(rootPath), S3_BOOKS_DIR, bookHash);

export const buildBookConfigPath = (rootPath: string, bookHash: string): string =>
  join(buildBookDirPath(rootPath, bookHash), S3_BOOK_CONFIG_FILE);

export const buildLibraryPath = (rootPath: string): string =>
  join(buildBasePath(rootPath), S3_LIBRARY_FILE);

export const buildBookFileName = (book: Book): string => {
  const ext = EXTS[book.format] || 'bin';
  const baseName = book.sourceTitle || book.title || book.hash;
  return `${makeSafeFilename(baseName)}.${ext}`;
};

export const buildBookFilePath = (rootPath: string, book: Book): string =>
  join(buildBookDirPath(rootPath, book.hash), buildBookFileName(book));

export const buildBookCoverPath = (rootPath: string, bookHash: string): string =>
  join(buildBookDirPath(rootPath, bookHash), S3_BOOK_COVER_FILE);
