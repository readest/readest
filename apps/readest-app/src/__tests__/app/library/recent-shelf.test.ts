import { describe, it, expect } from 'vitest';
import { selectRecentShelfBooks } from '../../../app/library/utils/libraryUtils';
import { Book } from '../../../types/book';
import { BookMetadata } from '@/libs/document';

// The shelf is "recently read", so a book counts only once it has reading
// progress. The shared helper in library-utils.test.ts does NOT set `progress`,
// so this local helper defaults a read book; cases that need an unread book
// override `progress: undefined`.
const createMockBook = (
  overrides: Partial<Omit<Book, 'metadata'> & { metadata?: Partial<BookMetadata> }> = {},
): Book => ({
  hash: `hash-${Math.random().toString(36).slice(2, 11)}`,
  format: 'EPUB',
  title: 'Test Book',
  author: 'Test Author',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  progress: [1, 100],
  ...overrides,
  metadata: { ...overrides.metadata } as BookMetadata,
});

describe('selectRecentShelfBooks', () => {
  it('orders books by updatedAt descending (most recent first)', () => {
    const older = createMockBook({ hash: 'older', updatedAt: 1000 });
    const newer = createMockBook({ hash: 'newer', updatedAt: 3000 });
    const middle = createMockBook({ hash: 'middle', updatedAt: 2000 });

    const result = selectRecentShelfBooks([older, newer, middle], 10);

    expect(result.map((book) => book.hash)).toEqual(['newer', 'middle', 'older']);
  });

  it('excludes soft-deleted books', () => {
    const live = createMockBook({ hash: 'live', updatedAt: 1000 });
    const deleted = createMockBook({ hash: 'deleted', updatedAt: 2000, deletedAt: 2500 });

    const result = selectRecentShelfBooks([live, deleted], 10);

    expect(result.map((book) => book.hash)).toEqual(['live']);
  });

  it('excludes imported-but-unread books (no reading progress)', () => {
    const read = createMockBook({ hash: 'read', updatedAt: 1000 });
    const justAdded = createMockBook({ hash: 'added', updatedAt: 9999, progress: undefined });

    const result = selectRecentShelfBooks([read, justAdded], 10);

    expect(result.map((book) => book.hash)).toEqual(['read']);
  });

  it('includes a book once it has been opened (progress present)', () => {
    const opened = createMockBook({ hash: 'opened', updatedAt: 2000, progress: [1, 100] });

    expect(selectRecentShelfBooks([opened], 10).map((book) => book.hash)).toEqual(['opened']);
  });

  it('excludes finished, abandoned and unread books even when they have progress', () => {
    const reading = createMockBook({ hash: 'reading', updatedAt: 1000 });
    const finished = createMockBook({
      hash: 'finished',
      updatedAt: 4000,
      readingStatus: 'finished',
    });
    const abandoned = createMockBook({
      hash: 'abandoned',
      updatedAt: 3000,
      readingStatus: 'abandoned',
    });
    const unread = createMockBook({ hash: 'unread', updatedAt: 2000, readingStatus: 'unread' });

    const result = selectRecentShelfBooks([reading, finished, abandoned, unread], 10);

    expect(result.map((book) => book.hash)).toEqual(['reading']);
  });

  it('slices to the requested count, keeping the most recent', () => {
    const books = [
      createMockBook({ hash: 'a', updatedAt: 1000 }),
      createMockBook({ hash: 'b', updatedAt: 2000 }),
      createMockBook({ hash: 'c', updatedAt: 3000 }),
    ];

    const result = selectRecentShelfBooks(books, 2);

    expect(result.map((book) => book.hash)).toEqual(['c', 'b']);
  });

  it('returns all books when fewer than the count exist', () => {
    const books = [createMockBook({ updatedAt: 1000 }), createMockBook({ updatedAt: 2000 })];

    expect(selectRecentShelfBooks(books, 10)).toHaveLength(2);
  });

  it('returns an empty array when there are no books', () => {
    expect(selectRecentShelfBooks([], 10)).toEqual([]);
  });
});
