import { describe, expect, it } from 'vitest';
import {
  getDisplayedTimeRemaining,
  getTimeRemainingMinutes,
} from '@/app/library/utils/libraryUtils';
import type { Book } from '@/types/book';

const book = (over: Partial<Book>): Book =>
  ({ hash: 'h', title: 'T', author: 'A', format: 'EPUB', ...over }) as Book;

describe('getTimeRemainingMinutes', () => {
  it('converts remaining pages at the reading pace for an ebook', () => {
    // 100 pages left at 60s/page is 100 minutes.
    expect(getTimeRemainingMinutes(book({ progress: [100, 200] as [number, number] }), 60)).toBe(
      100,
    );
  });

  // An audiobook's `progress` is [seconds, seconds] and its length lives in
  // `duration` -- there are no pages and no reading pace. Running it through
  // the page maths turned 7h of listening into hundreds of hours, which
  // floated every audiobook to the top of a time-remaining sort (#6224).
  it('reads an audiobook straight off the clock, not the page estimate', () => {
    const audiobook = book({
      format: 'BOOKORBIT',
      duration: 37084,
      progress: [8548, 37084] as [number, number],
    });

    // 37084 - 8548 = 28536s = 475.6 minutes.
    expect(getTimeRemainingMinutes(audiobook)).toBe(476);
  });

  it('is undefined for an audiobook with no length recorded yet', () => {
    expect(
      getTimeRemainingMinutes(book({ format: 'BOOKORBIT', progress: [10, 0] as [number, number] })),
    ).toBeUndefined();
  });

  it('is undefined for a finished audiobook', () => {
    const finished = book({
      format: 'BOOKORBIT',
      duration: 100,
      progress: [100, 100] as [number, number],
    });

    expect(getTimeRemainingMinutes(finished)).toBeUndefined();
  });
});

describe('getDisplayedTimeRemaining', () => {
  it('keeps hiding a time for books that render a status badge instead', () => {
    const base = {
      format: 'BOOKORBIT' as const,
      duration: 37084,
      progress: [0, 37084] as [number, number],
    };

    expect(getDisplayedTimeRemaining(book({ ...base, readingStatus: 'finished' }))).toBeUndefined();
    expect(getDisplayedTimeRemaining(book({ ...base, readingStatus: 'unread' }))).toBeUndefined();
    expect(getDisplayedTimeRemaining(book({ ...base }))).toBeGreaterThan(0);
  });
});
