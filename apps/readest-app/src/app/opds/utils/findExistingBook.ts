import type { Book } from '@/types/book';
import type { OPDSPublication } from '@/types/opds';

const normalizeTitle = (title: string | undefined): string =>
  title?.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase() ?? '';

export const findExistingBookForPublication = (
  publication: OPDSPublication | null | undefined,
  library: Book[] | null | undefined,
): Book | null => {
  const title = normalizeTitle(publication?.metadata?.title);
  if (!title || !library?.length) return null;

  return (
    library.find((book) => {
      const bookTitle = typeof book.metadata?.title === 'string' ? book.metadata.title : book.title;
      return !book.deletedAt && normalizeTitle(bookTitle) === title;
    }) ?? null
  );
};
