import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { EXTS } from '@/libs/document';
import { getDir, getLocalBookFilename } from '@/utils/book';
import { isContentURI, isValidURL } from '@/utils/misc';
import { isPseStreamFileName } from './opds/pseStream';

export type BookContentSource =
  | { kind: 'managed'; path: string; base: 'Books'; legacy?: boolean }
  | { kind: 'external'; path: string; base: 'None' }
  | { kind: 'url'; path: string; base: 'None' }
  | { kind: 'stream'; path: string; base: 'None'; scheme: 'pse' }
  | { kind: 'missing' };

export type BookFileContentSource = Extract<
  BookContentSource,
  { kind: 'managed' | 'external' | 'url' }
>;

export function isBookFileContentSource(
  source: BookContentSource,
): source is BookFileContentSource {
  return source.kind === 'managed' || source.kind === 'external' || source.kind === 'url';
}

async function resolveLegacyManagedSource(
  fs: FileSystem,
  book: Book,
): Promise<BookContentSource | null> {
  try {
    const bookDir = getDir(book);
    const files = await fs.readDir(bookDir, 'Books');
    const bookFile = files.find((f) => f.path.endsWith(`.${EXTS[book.format]}`));
    if (!bookFile) return null;
    return { kind: 'managed', path: `${bookDir}/${bookFile.path}`, base: 'Books', legacy: true };
  } catch {
    return null;
  }
}

export async function resolveBookContentSource(
  fs: FileSystem,
  book: Book,
): Promise<BookContentSource> {
  // Prefer the managed copy when it exists; book.filePath is device-local and
  // can outlive a prior in-place/import mode.
  const managedPath = getLocalBookFilename(book);
  if (await fs.exists(managedPath, 'Books')) {
    return { kind: 'managed', path: managedPath, base: 'Books' };
  }

  if (book.filePath) {
    // Android "Open with Readest" hands us a content:// URI as the
    // book.filePath (e.g. content://media/external/file/1322). Tauri's
    // fs.exists() doesn't understand content URIs and returns false,
    // which would route us to `missing` here even though the URI is
    // perfectly readable through appService.openFile (which copies the
    // content to Cache on demand). Skip the existence probe for URIs
    // we know openFile knows how to resolve.
    if (isContentURI(book.filePath)) {
      return { kind: 'external', path: book.filePath, base: 'None' };
    }
    if (await fs.exists(book.filePath, 'None')) {
      return { kind: 'external', path: book.filePath, base: 'None' };
    }
  }

  if (book.url) {
    if (isPseStreamFileName(book.url)) {
      return { kind: 'stream', path: book.url, base: 'None', scheme: 'pse' };
    }
    if (isValidURL(book.url)) {
      return { kind: 'url', path: book.url, base: 'None' };
    }
  }

  const legacyManagedSource = await resolveLegacyManagedSource(fs, book);
  return legacyManagedSource ?? { kind: 'missing' };
}
