import { FileSystem, SaveLibraryBooksOptions } from '@/types/system';
import { Book } from '@/types/book';
import { getLibraryFilename } from '@/utils/book';
import { safeLoadJSON, safeSaveJSON } from './persistence';

const COVER_CONCURRENCY = 20;

async function processInBatches<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

export async function loadLibraryBooks(
  fs: FileSystem,
  generateCoverImageUrl: (book: Book) => Promise<string>,
): Promise<Book[]> {
  const libraryFilename = getLibraryFilename();

  if (!(await fs.exists('', 'Books'))) {
    await fs.createDir('', 'Books', true);
  }

  const books = await safeLoadJSON<Book[]>(fs, libraryFilename, 'Books', []);

  await processInBatches(books, COVER_CONCURRENCY, async (book) => {
    book.coverImageUrl = await generateCoverImageUrl(book);
    book.updatedAt ??= book.lastUpdated || Date.now();
  });

  return books;
}

export async function saveLibraryBooks(
  fs: FileSystem,
  books: Book[],
  options?: SaveLibraryBooksOptions,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const incoming = books.map(({ coverImageUrl, ...rest }) => rest);

  if (options?.replace) {
    await safeSaveJSON(fs, getLibraryFilename(), 'Books', incoming);
    return;
  }

  // Merge-floor: treat the on-disk library as a floor. A routine save may add
  // new books or modify existing rows (including setting `deletedAt`
  // tombstones), but it must never silently drop a book that exists on disk.
  // This stops a stale or partially-loaded in-memory library (e.g. the
  // cold-start "Open with" race) from wiping library.json. Deliberate removals
  // must go through `{ replace: true }`.
  const existing = await safeLoadJSON<Book[]>(fs, getLibraryFilename(), 'Books', []);
  const merged = new Map<string, Book>();
  for (const book of existing) merged.set(book.hash, book);
  for (const book of incoming) merged.set(book.hash, book); // incoming wins per hash
  await safeSaveJSON(fs, getLibraryFilename(), 'Books', Array.from(merged.values()));
}
