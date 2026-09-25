import type { Book } from '@/types/book';

export const LOCAL_READING_ONLY = true;

export const UNIFIED_SOURCE_FORMATS = ['EPUB', 'HTML', 'TXT', 'MD'] as const;

const normalizedSourceTitle = (book: Book): string =>
  book.title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

const normalizedSourceAuthor = (book: Book): string =>
  book.author.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

const normalizedSourceFileStem = (book: Book): string | null => {
  const sourceTitle = book.sourceTitle?.trim();
  if (!sourceTitle) return null;
  return sourceTitle
    .replace(/\.(?:epub|html?|txt|md|markdown)$/i, '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
};

const sourceIdentityKeys = (book: Book): string[] => {
  const keys = [`book:${normalizedSourceTitle(book)}:${normalizedSourceAuthor(book)}`];
  if (book.metaHash) keys.push(`meta:${book.metaHash}`);
  const fileStem = normalizedSourceFileStem(book);
  if (fileStem) keys.push(`file:${fileStem}`);
  return keys;
};

export const findUnifiedSourceVariants = (books: Book[], selectedBook: Book): Book[] => {
  if (!(UNIFIED_SOURCE_FORMATS as readonly string[]).includes(selectedBook.format)) {
    return [selectedBook];
  }
  const selectedKeys = new Set(sourceIdentityKeys(selectedBook));
  return books
    .filter(
      (book) =>
        !book.deletedAt &&
        (UNIFIED_SOURCE_FORMATS as readonly string[]).includes(book.format) &&
        sourceIdentityKeys(book).some((key) => selectedKeys.has(key)),
    )
    .sort(
      (left, right) =>
        left.format.localeCompare(right.format) || left.hash.localeCompare(right.hash),
    );
};
