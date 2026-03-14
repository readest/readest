import { FileSystem } from '@/types/system';
import { Book } from '@/types/book';
import { getLibraryFilename } from '@/utils/book';
import { safeLoadJSON, safeSaveJSON } from './persistence';

export async function loadLibraryBooks(
  fs: FileSystem,
  generateCoverImageUrl: (book: Book) => Promise<string>,
): Promise<Book[]> {
  const libraryFilename = getLibraryFilename();

  if (!(await fs.exists('', 'Books'))) {
    await fs.createDir('', 'Books', true);
  }

  const books = await safeLoadJSON<Book[]>(fs, libraryFilename, 'Books', []);

  await Promise.all(
    books.map(async (book) => {
      book.coverImageUrl = await generateCoverImageUrl(book);
      book.updatedAt ??= book.lastUpdated || Date.now();
      return book;
    }),
  );

  return books;
}

export async function saveLibraryBooks(fs: FileSystem, books: Book[]): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const libraryBooks = books.map(({ coverImageUrl, ...rest }) => rest);
  await safeSaveJSON(fs, getLibraryFilename(), 'Books', libraryBooks);
}
