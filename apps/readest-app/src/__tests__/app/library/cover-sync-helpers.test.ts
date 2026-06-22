import { describe, expect, it } from 'vitest';
import { needsCoverRefresh, pickFresherCover } from '@/app/library/utils/libraryUtils';
import type { Book } from '@/types/book';

const base: Book = {
  hash: 'h1',
  format: 'EPUB',
  title: 'T',
  author: 'A',
  createdAt: 1,
  updatedAt: 2,
};

const local = (over: Partial<Book>): Book => ({ ...base, ...over });
const synced = (over: Partial<Book>): Book => ({ ...base, ...over });

describe('needsCoverRefresh (issue #4544)', () => {
  it('first download: synced is in cloud and local never fetched the cover', () => {
    expect(
      needsCoverRefresh(
        local({ coverDownloadedAt: null }),
        synced({ uploadedAt: 1000, coverHash: 'hA', coverUpdatedAt: 1000 }),
      ),
    ).toBe(true);
  });

  it('changed cover: newer coverUpdatedAt and a different hash → refresh', () => {
    expect(
      needsCoverRefresh(
        local({ coverDownloadedAt: 1000, coverHash: 'hOLD', coverUpdatedAt: 1000 }),
        synced({ uploadedAt: 1000, coverHash: 'hNEW', coverUpdatedAt: 2000 }),
      ),
    ).toBe(true);
  });

  it('same hash even if timestamp is newer → no refresh (idempotent, no churn)', () => {
    expect(
      needsCoverRefresh(
        local({ coverDownloadedAt: 1000, coverHash: 'hSAME', coverUpdatedAt: 1000 }),
        synced({ uploadedAt: 1000, coverHash: 'hSAME', coverUpdatedAt: 2000 }),
      ),
    ).toBe(false);
  });

  it('not newer (synced older/equal) → no refresh (unpushed-local-edit race)', () => {
    expect(
      needsCoverRefresh(
        local({ coverDownloadedAt: 1000, coverHash: 'hLOCAL', coverUpdatedAt: 3000 }),
        synced({ uploadedAt: 1000, coverHash: 'hSTALE', coverUpdatedAt: 2000 }),
      ),
    ).toBe(false);
  });

  it('legacy synced book without a coverHash → no refresh', () => {
    expect(
      needsCoverRefresh(
        local({ coverDownloadedAt: 1000, coverHash: null, coverUpdatedAt: null }),
        synced({ uploadedAt: 1000, coverHash: null, coverUpdatedAt: null }),
      ),
    ).toBe(false);
  });

  it('not uploaded to cloud → no refresh', () => {
    expect(
      needsCoverRefresh(
        local({ coverDownloadedAt: null }),
        synced({ uploadedAt: null, coverHash: 'hA', coverUpdatedAt: 1000 }),
      ),
    ).toBe(false);
  });

  it('deleted synced book → no refresh', () => {
    expect(
      needsCoverRefresh(
        local({ coverDownloadedAt: 1000, coverHash: 'hOLD', coverUpdatedAt: 1000 }),
        synced({ deletedAt: 5000, uploadedAt: 1000, coverHash: 'hNEW', coverUpdatedAt: 2000 }),
      ),
    ).toBe(false);
  });
});

describe('pickFresherCover (issue #4544)', () => {
  it('keeps the cover whose coverUpdatedAt is newer', () => {
    expect(
      pickFresherCover(
        { coverHash: 'hLOCAL', coverUpdatedAt: 1000 },
        { coverHash: 'hSYNCED', coverUpdatedAt: 2000 },
      ),
    ).toEqual({ coverHash: 'hSYNCED', coverUpdatedAt: 2000 });
  });

  it('ties go to local (it already holds the file)', () => {
    expect(
      pickFresherCover(
        { coverHash: 'hLOCAL', coverUpdatedAt: 1500 },
        { coverHash: 'hSYNCED', coverUpdatedAt: 1500 },
      ),
    ).toEqual({ coverHash: 'hLOCAL', coverUpdatedAt: 1500 });
  });

  it('treats a missing timestamp as oldest', () => {
    expect(
      pickFresherCover(
        { coverHash: 'hLOCAL', coverUpdatedAt: null },
        { coverHash: 'hSYNCED', coverUpdatedAt: 1 },
      ),
    ).toEqual({ coverHash: 'hSYNCED', coverUpdatedAt: 1 });
  });
});
