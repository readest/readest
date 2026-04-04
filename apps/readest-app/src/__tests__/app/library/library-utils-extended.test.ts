import { describe, it, expect } from 'vitest';
import {
  createBookFilter,
  getBreadcrumbs,
  getBookSortValue,
  compareSortValues,
  createBookSorter,
} from '@/app/library/utils/libraryUtils';
import { Book } from '@/types/book';
import { LibrarySortByType } from '@/types/settings';
import { BookMetadata } from '@/libs/document';

/**
 * Tests for functions NOT covered by the existing library-utils.test.ts:
 * - createBookFilter
 * - getBreadcrumbs
 * - getBookSortValue
 * - compareSortValues
 * - createBookSorter (additional sort-by cases: Author, Format, Series, Published, default)
 */

const createMockBook = (
  overrides: Partial<Omit<Book, 'metadata'> & { metadata?: Partial<BookMetadata> }> = {},
): Book => ({
  hash: `hash-${Math.random().toString(36).substr(2, 9)}`,
  format: 'EPUB',
  title: 'Test Book',
  author: 'Test Author',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
  metadata: { ...overrides.metadata } as BookMetadata,
});

describe('createBookFilter', () => {
  it('should return true for all books when queryTerm is null', () => {
    const filter = createBookFilter(null);
    const book = createMockBook({ title: 'Anything' });
    expect(filter(book)).toBe(true);
  });

  it('should return true for all non-deleted books when queryTerm is empty string', () => {
    const filter = createBookFilter('');
    const book = createMockBook({ title: 'Anything' });
    expect(filter(book)).toBe(true);
  });

  it('should match by title', () => {
    const filter = createBookFilter('Moby');
    const book = createMockBook({ title: 'Moby Dick' });
    expect(filter(book)).toBe(true);
  });

  it('should match by author', () => {
    const filter = createBookFilter('Twain');
    const book = createMockBook({ title: 'Adventures', author: 'Mark Twain' });
    expect(filter(book)).toBe(true);
  });

  it('should match by format', () => {
    const filter = createBookFilter('PDF');
    const book = createMockBook({ format: 'PDF', title: 'Some Book' });
    expect(filter(book)).toBe(true);
  });

  it('should match by groupName', () => {
    const filter = createBookFilter('fiction');
    const book = createMockBook({ title: 'A Book', groupName: 'Science Fiction' });
    expect(filter(book)).toBe(true);
  });

  it('should match by description in metadata', () => {
    const filter = createBookFilter('adventure');
    const book = createMockBook({
      title: 'A Book',
      metadata: { description: 'An adventure tale' },
    });
    expect(filter(book)).toBe(true);
  });

  it('should be case-insensitive', () => {
    const filter = createBookFilter('moby');
    const book = createMockBook({ title: 'MOBY DICK' });
    expect(filter(book)).toBe(true);
  });

  it('should not match non-matching books', () => {
    const filter = createBookFilter('nonexistent');
    const book = createMockBook({ title: 'Real Book', author: 'Real Author' });
    expect(filter(book)).toBeFalsy();
  });

  it('should return false for deleted books', () => {
    const filter = createBookFilter('test');
    const book = createMockBook({ title: 'test book', deletedAt: Date.now() });
    expect(filter(book)).toBe(false);
  });

  it('should handle invalid regex gracefully by doing substring match', () => {
    // The string "[invalid" is an invalid regex pattern
    const filter = createBookFilter('[invalid');
    const book = createMockBook({ title: 'A book with [invalid text' });
    expect(filter(book)).toBe(true);
  });

  it('should not match when invalid regex query does not match', () => {
    const filter = createBookFilter('[invalid');
    const book = createMockBook({ title: 'Normal Title', author: 'Normal Author' });
    expect(filter(book)).toBeFalsy();
  });

  it('should support regex patterns', () => {
    const filter = createBookFilter('^Moby');
    const bookMatch = createMockBook({ title: 'Moby Dick' });
    const bookNoMatch = createMockBook({ title: 'The Moby Dick' });
    expect(filter(bookMatch)).toBeTruthy();
    expect(filter(bookNoMatch)).toBeFalsy();
  });
});

describe('getBreadcrumbs', () => {
  it('should return empty array for empty string', () => {
    expect(getBreadcrumbs('')).toEqual([]);
  });

  it('should return single breadcrumb for single segment', () => {
    const result = getBreadcrumbs('Library');
    expect(result).toEqual([{ name: 'Library', path: 'Library' }]);
  });

  it('should return multiple breadcrumbs for path with separators', () => {
    const result = getBreadcrumbs('Library/Fiction/Scifi');
    expect(result).toEqual([
      { name: 'Library', path: 'Library' },
      { name: 'Fiction', path: 'Library/Fiction' },
      { name: 'Scifi', path: 'Library/Fiction/Scifi' },
    ]);
  });

  it('should handle two segments', () => {
    const result = getBreadcrumbs('A/B');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'A', path: 'A' });
    expect(result[1]).toEqual({ name: 'B', path: 'A/B' });
  });
});

describe('getBookSortValue', () => {
  it('should return formatted title for Title sort', () => {
    const book = createMockBook({ title: 'The Great Book' });
    const value = getBookSortValue(book, LibrarySortByType.Title);
    expect(typeof value).toBe('string');
    expect(value).toBeTruthy();
  });

  it('should return formatted author for Author sort', () => {
    const book = createMockBook({ author: 'Jane Austen' });
    const value = getBookSortValue(book, LibrarySortByType.Author);
    expect(typeof value).toBe('string');
    expect(value).toBeTruthy();
  });

  it('should return updatedAt for Updated sort', () => {
    const book = createMockBook({ updatedAt: 12345 });
    expect(getBookSortValue(book, LibrarySortByType.Updated)).toBe(12345);
  });

  it('should return createdAt for Created sort', () => {
    const book = createMockBook({ createdAt: 67890 });
    expect(getBookSortValue(book, LibrarySortByType.Created)).toBe(67890);
  });

  it('should return format string for Format sort', () => {
    const book = createMockBook({ format: 'PDF' });
    expect(getBookSortValue(book, LibrarySortByType.Format)).toBe('PDF');
  });

  it('should return published date timestamp for Published sort', () => {
    const book = createMockBook({ metadata: { published: '2023-01-15' } });
    const value = getBookSortValue(book, LibrarySortByType.Published);
    expect(value).toBe(new Date('2023-01-15').getTime());
  });

  it('should return 0 for Published sort when no published date', () => {
    const book = createMockBook({ metadata: {} });
    expect(getBookSortValue(book, LibrarySortByType.Published)).toBe(0);
  });

  it('should return 0 for Published sort when date is invalid', () => {
    const book = createMockBook({ metadata: { published: 'not-a-date' } });
    expect(getBookSortValue(book, LibrarySortByType.Published)).toBe(0);
  });

  it('should return updatedAt for unknown sort type', () => {
    const book = createMockBook({ updatedAt: 99999 });
    expect(getBookSortValue(book, 'unknown' as LibrarySortByType)).toBe(99999);
  });
});

describe('compareSortValues', () => {
  it('should compare two strings using locale comparison', () => {
    const result = compareSortValues('Apple', 'Banana', 'en');
    expect(result).toBeLessThan(0);
  });

  it('should compare two numbers', () => {
    expect(compareSortValues(10, 20, 'en')).toBeLessThan(0);
    expect(compareSortValues(20, 10, 'en')).toBeGreaterThan(0);
    expect(compareSortValues(10, 10, 'en')).toBe(0);
  });

  it('should return 0 when types are mismatched', () => {
    expect(compareSortValues('hello', 42, 'en')).toBe(0);
    expect(compareSortValues(42, 'hello', 'en')).toBe(0);
  });

  it('should handle equal strings', () => {
    expect(compareSortValues('same', 'same', 'en')).toBe(0);
  });
});

describe('createBookSorter - additional cases', () => {
  it('should sort by author with last-name-first formatting', () => {
    const books = [
      createMockBook({ author: 'Jane Austen' }),
      createMockBook({ author: 'Charles Dickens' }),
    ];
    const sorter = createBookSorter(LibrarySortByType.Author, 'en');
    const sorted = [...books].sort(sorter);
    // Austen < Dickens (by last name)
    expect(sorted[0]!.author).toBe('Jane Austen');
    expect(sorted[1]!.author).toBe('Charles Dickens');
  });

  it('should sort by createdAt', () => {
    const books = [
      createMockBook({ title: 'Newer', createdAt: 2000 }),
      createMockBook({ title: 'Older', createdAt: 1000 }),
    ];
    const sorter = createBookSorter(LibrarySortByType.Created, 'en');
    const sorted = [...books].sort(sorter);
    expect(sorted[0]!.title).toBe('Older');
    expect(sorted[1]!.title).toBe('Newer');
  });

  it('should sort by format alphabetically', () => {
    const books = [createMockBook({ format: 'PDF' }), createMockBook({ format: 'EPUB' })];
    const sorter = createBookSorter(LibrarySortByType.Format, 'en');
    const sorted = [...books].sort(sorter);
    expect(sorted[0]!.format).toBe('EPUB');
    expect(sorted[1]!.format).toBe('PDF');
  });

  it('should sort by seriesIndex', () => {
    const books = [
      createMockBook({ metadata: { seriesIndex: 3 } }),
      createMockBook({ metadata: { seriesIndex: 1 } }),
      createMockBook({ metadata: { seriesIndex: 2 } }),
    ];
    const sorter = createBookSorter(LibrarySortByType.Series, 'en');
    const sorted = [...books].sort(sorter);
    expect(sorted[0]!.metadata?.seriesIndex).toBe(1);
    expect(sorted[1]!.metadata?.seriesIndex).toBe(2);
    expect(sorted[2]!.metadata?.seriesIndex).toBe(3);
  });

  it('should sort by published date', () => {
    const books = [
      createMockBook({ metadata: { published: '2023-06-15' } }),
      createMockBook({ metadata: { published: '2020-01-01' } }),
      createMockBook({ metadata: { published: '2021-12-31' } }),
    ];
    const sorter = createBookSorter(LibrarySortByType.Published, 'en');
    const sorted = [...books].sort(sorter);
    expect(sorted[0]!.metadata?.published).toBe('2020-01-01');
    expect(sorted[1]!.metadata?.published).toBe('2021-12-31');
    expect(sorted[2]!.metadata?.published).toBe('2023-06-15');
  });

  it('should handle missing published dates in sort (books without date use fallback 0001-01-01)', () => {
    const books = [
      createMockBook({ metadata: {} }),
      createMockBook({ metadata: { published: '2020-01-01' } }),
    ];
    const sorter = createBookSorter(LibrarySortByType.Published, 'en');
    const sorted = [...books].sort(sorter);
    // Book without published date defaults to '0001-01-01', which is earlier
    expect(sorted[0]!.metadata?.published).toBeUndefined();
    expect(sorted[1]!.metadata?.published).toBe('2020-01-01');
  });

  it('should handle invalid published dates', () => {
    const books = [
      createMockBook({ metadata: { published: 'not-a-date' } }),
      createMockBook({ metadata: { published: '2020-01-01' } }),
    ];
    const sorter = createBookSorter(LibrarySortByType.Published, 'en');
    const sorted = [...books].sort(sorter);
    // Invalid date treated like missing, should sort after valid dates
    expect(sorted[0]!.metadata?.published).toBe('2020-01-01');
  });

  it('should use updatedAt as default sort for unknown sort type', () => {
    const books = [
      createMockBook({ title: 'Newer', updatedAt: 2000 }),
      createMockBook({ title: 'Older', updatedAt: 1000 }),
    ];
    const sorter = createBookSorter('unknown', 'en');
    const sorted = [...books].sort(sorter);
    expect(sorted[0]!.title).toBe('Older');
    expect(sorted[1]!.title).toBe('Newer');
  });
});
