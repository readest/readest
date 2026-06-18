import { describe, expect, it } from 'vitest';
import { withReadingStatus } from '@/app/library/utils/libraryUtils';
import type { Book } from '@/types/book';

const book: Book = {
  hash: 'h1',
  format: 'EPUB',
  title: 'T',
  author: 'A',
  createdAt: 1,
  updatedAt: 2,
  readingStatus: undefined,
};

describe('withReadingStatus', () => {
  it('sets status, stamps readingStatusUpdatedAt = updatedAt, and does not mutate input', () => {
    const out = withReadingStatus(book, 'abandoned');
    expect(out.readingStatus).toBe('abandoned');
    expect(out.readingStatusUpdatedAt).toBe(out.updatedAt);
    expect(out.readingStatusUpdatedAt).toBeGreaterThan(0);
    expect(book.readingStatus).toBeUndefined(); // input untouched
  });

  it('clears the status when undefined is passed but still stamps the timestamp', () => {
    const out = withReadingStatus({ ...book, readingStatus: 'finished' }, undefined);
    expect(out.readingStatus).toBeUndefined();
    expect(out.readingStatusUpdatedAt).toBe(out.updatedAt);
  });
});
