import { describe, expect, it } from 'vitest';

import { formatSeries, getBookDataAttributes, markBookDeleted } from '@/utils/book';
import type { Book } from '@/types/book';

describe('formatSeries', () => {
  it('returns an empty string when there is no series name', () => {
    expect(formatSeries(undefined)).toBe('');
    expect(formatSeries('')).toBe('');
    expect(formatSeries('   ')).toBe('');
  });

  it('returns an empty string when only an index is present', () => {
    expect(formatSeries(undefined, 3)).toBe('');
  });

  it('returns the trimmed series name when no index is present', () => {
    expect(formatSeries('Harry Potter')).toBe('Harry Potter');
    expect(formatSeries('  The Expanse  ')).toBe('The Expanse');
  });

  it('appends the series number when a positive index is present', () => {
    expect(formatSeries('Harry Potter', 3)).toBe('Harry Potter #3');
    expect(formatSeries('  The Expanse  ', 2)).toBe('The Expanse #2');
  });

  it('supports fractional series indices', () => {
    expect(formatSeries('The Expanse', 1.5)).toBe('The Expanse #1.5');
  });

  it('omits the number when the index is zero or not a finite number', () => {
    expect(formatSeries('Harry Potter', 0)).toBe('Harry Potter');
    expect(formatSeries('Harry Potter', Number.NaN)).toBe('Harry Potter');
  });

  it('accepts an index persisted as a string by the metadata edit form', () => {
    // Libraries edited before the form coerced numbers hold "2", synced across
    // devices; the badge must not drop the index for those books.
    expect(formatSeries('Harry Potter', '2' as unknown as number)).toBe('Harry Potter #2');
    expect(formatSeries('Harry Potter', 'abc' as unknown as number)).toBe('Harry Potter');
  });
});

describe('getBookDataAttributes (#5776)', () => {
  // Custom Reader UI CSS reads these with attr() to surface "Series #2 - Title"
  // in the running header / header bar. Series attributes must be absent (not
  // empty) for standalone books so `[data-book-series]` presence checks work.
  it('exposes the title and omits series attributes for a standalone book', () => {
    expect(getBookDataAttributes('Dune', {})).toEqual({
      'data-book-title': 'Dune',
      'data-book-series': undefined,
      'data-book-series-index': undefined,
    });
    expect(getBookDataAttributes('Dune', undefined)['data-book-series']).toBeUndefined();
  });

  it('exposes the trimmed series name and its index', () => {
    expect(
      getBookDataAttributes('Leviathan Wakes', { series: ' The Expanse ', seriesIndex: 1 }),
    ).toEqual({
      'data-book-title': 'Leviathan Wakes',
      'data-book-series': 'The Expanse',
      'data-book-series-index': 1,
    });
  });

  it('keeps fractional indices', () => {
    expect(
      getBookDataAttributes('Novella', { series: 'The Expanse', seriesIndex: 1.5 })[
        'data-book-series-index'
      ],
    ).toBe(1.5);
  });

  it('omits the index when it is missing, zero (the unknown-position default) or not finite', () => {
    // readerStore fills a missing calibre:series_index with parseFloat('0'),
    // so 0 means "no position", matching formatSeries.
    expect(getBookDataAttributes('T', { series: 'S' })['data-book-series-index']).toBeUndefined();
    expect(
      getBookDataAttributes('T', { series: 'S', seriesIndex: 0 })['data-book-series-index'],
    ).toBeUndefined();
    expect(
      getBookDataAttributes('T', { series: 'S', seriesIndex: Number.NaN })[
        'data-book-series-index'
      ],
    ).toBeUndefined();
  });

  it('omits the index when there is no series to index into', () => {
    expect(getBookDataAttributes('T', { seriesIndex: 3 })).toEqual({
      'data-book-title': 'T',
      'data-book-series': undefined,
      'data-book-series-index': undefined,
    });
  });

  it('omits the title attribute when the book has no title yet', () => {
    // SectionInfo renders before bookData resolves; no attribute beats an empty one.
    expect(
      getBookDataAttributes(undefined, { series: 'S', seriesIndex: 1 })['data-book-title'],
    ).toBeUndefined();
    expect(getBookDataAttributes('', { series: 'S' })['data-book-title']).toBeUndefined();
  });

  it('drops a whitespace-only series along with its index', () => {
    expect(getBookDataAttributes('T', { series: '   ', seriesIndex: 2 })).toEqual({
      'data-book-title': 'T',
      'data-book-series': undefined,
      'data-book-series-index': undefined,
    });
  });

  it('omits negative and infinite indices', () => {
    expect(
      getBookDataAttributes('T', { series: 'S', seriesIndex: -1 })['data-book-series-index'],
    ).toBeUndefined();
    expect(
      getBookDataAttributes('T', { series: 'S', seriesIndex: Number.POSITIVE_INFINITY })[
        'data-book-series-index'
      ],
    ).toBeUndefined();
  });

  it('accepts an index persisted as a string by the metadata edit form', () => {
    expect(
      getBookDataAttributes('T', { series: 'S', seriesIndex: '2' as unknown as number })[
        'data-book-series-index'
      ],
    ).toBe(2);
    expect(
      getBookDataAttributes('T', { series: 'S', seriesIndex: 'abc' as unknown as number })[
        'data-book-series-index'
      ],
    ).toBeUndefined();
  });

  it('does not throw on a non-string series from a corrupt or foreign metadata row', () => {
    // Persisted metadata is not runtime-validated (backup restore, sync index);
    // a bad row must not make the reader header unrenderable.
    expect(getBookDataAttributes('T', { series: 42 as unknown as string, seriesIndex: 1 })).toEqual(
      {
        'data-book-title': 'T',
        'data-book-series': undefined,
        'data-book-series-index': undefined,
      },
    );
  });
});

describe('markBookDeleted', () => {
  const makeBook = (over: Partial<Book> = {}): Book =>
    ({
      hash: 'hash-1',
      format: 'EPUB',
      title: 'Book',
      updatedAt: 100,
      progress: [3, 10],
      downloadedAt: 50,
      coverDownloadedAt: 50,
      ...over,
    }) as Book;

  it('stamps the delete on updatedAt so the whole-row sync merge keeps the tombstone', () => {
    // The cloud merge is last-write-wins on `updatedAt`. A delete used to leave
    // it alone, so the row's own older page-turn progress won the merge, the
    // tombstone was cleared, and the book (with its progress) came back — the
    // purge looked like it did nothing (#6663).
    const book = makeBook();
    markBookDeleted(book, 200, true);
    expect(book.deletedAt).toBe(200);
    expect(book.fileSyncDeletionRequestedAt).toBe(200);
    expect(book.downloadedAt).toBeNull();
    expect(book.coverDownloadedAt).toBeNull();
    expect(book.updatedAt).toBe(200);
    expect(book.progress).toBeNull();
  });

  it('never lowers a future-dated updatedAt, so the tombstone still outranks the cloud row', () => {
    // A peer with a fast clock can leave `updatedAt` ahead of this device's
    // now. Lowering it would let that cloud row win the merge (ties go to the
    // cloud), clearing `deletedAt` again.
    const book = makeBook({ updatedAt: 500 });
    markBookDeleted(book, 200, false);
    expect(book.deletedAt).toBe(200);
    expect(book.updatedAt).toBeGreaterThan(500);
  });

  it('keeps the reading progress on a plain delete', () => {
    const book = makeBook();
    markBookDeleted(book, 200, false);
    expect(book.deletedAt).toBe(200);
    expect(book.progress).toEqual([3, 10]);
  });
});
