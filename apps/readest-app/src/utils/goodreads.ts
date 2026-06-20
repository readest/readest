import { Book } from '@/types/book';

const GOODREADS_SEARCH_URL = 'https://www.goodreads.com/search';

/** Build a Goodreads search URL for an arbitrary query string. */
export const getGoodreadsSearchUrl = (query: string): string =>
  `${GOODREADS_SEARCH_URL}?q=${encodeURIComponent(query.trim())}`;

/**
 * Compose the Goodreads search query for a book from its title and author.
 * The author improves match precision; it's dropped when empty.
 */
export const getBookGoodreadsQuery = (book: Pick<Book, 'title' | 'author'>): string =>
  [book.title, book.author]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
