import { describe, expect, it } from 'vitest';
import { withReadingStatus, pickFresherReadingStatus } from '@/app/library/utils/libraryUtils';
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

describe('pickFresherReadingStatus', () => {
  it('keeps the status whose timestamp is newer, even if the other object is newer overall', () => {
    const local = { readingStatus: 'finished' as const, readingStatusUpdatedAt: 200 };
    const remote = { readingStatus: undefined, readingStatusUpdatedAt: 100 };
    expect(pickFresherReadingStatus(local, remote)).toEqual({
      readingStatus: 'finished',
      readingStatusUpdatedAt: 200,
    });
  });

  it('treats a missing timestamp as oldest', () => {
    const local = { readingStatus: undefined, readingStatusUpdatedAt: undefined };
    const remote = { readingStatus: 'abandoned' as const, readingStatusUpdatedAt: 5 };
    expect(pickFresherReadingStatus(local, remote)).toEqual({
      readingStatus: 'abandoned',
      readingStatusUpdatedAt: 5,
    });
  });

  it('prefers the first argument on a timestamp tie', () => {
    const a = { readingStatus: 'reading' as const, readingStatusUpdatedAt: 50 };
    const b = { readingStatus: 'finished' as const, readingStatusUpdatedAt: 50 };
    expect(pickFresherReadingStatus(a, b).readingStatus).toBe('reading');
  });
});
