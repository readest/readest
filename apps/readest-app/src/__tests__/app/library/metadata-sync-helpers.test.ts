import { describe, expect, it } from 'vitest';
import { pickFresherMetadata } from '@/app/library/utils/libraryUtils';
import { getBookWithUpdatedMetadata } from '@/utils/book';
import type { Book } from '@/types/book';

const base: Book = {
  hash: 'h1',
  format: 'EPUB',
  title: 'T',
  author: 'A',
  createdAt: 1,
  updatedAt: 2,
};

const book = (over: Partial<Book>): Book => ({ ...base, ...over });

describe('pickFresherMetadata (issue #5438)', () => {
  it('returns the synced metadata group when its stamp is newer', () => {
    const out = pickFresherMetadata(
      book({ title: 'Stale', metadataUpdatedAt: 100 }),
      book({
        title: 'Edited',
        author: 'B',
        tags: ['news'],
        metadata: { title: 'Edited', author: 'B', language: 'sv' },
        metadataUpdatedAt: 200,
      }),
    );
    expect(out).toEqual({
      title: 'Edited',
      author: 'B',
      tags: ['news'],
      metadata: { title: 'Edited', author: 'B', language: 'sv' },
      metadataUpdatedAt: 200,
    });
  });

  it('returns the local metadata group when the local stamp is newer', () => {
    const out = pickFresherMetadata(
      book({ title: 'Edited here', metadataUpdatedAt: 300 }),
      book({ title: 'Stale cloud', metadataUpdatedAt: 100 }),
    );
    expect(out?.title).toBe('Edited here');
    expect(out?.metadataUpdatedAt).toBe(300);
  });

  it('returns null when neither side is stamped (row-level winner stands)', () => {
    expect(pickFresherMetadata(book({}), book({ title: 'Other' }))).toBeNull();
  });

  it('returns null on equal stamps (no churn)', () => {
    expect(
      pickFresherMetadata(
        book({ metadataUpdatedAt: 100 }),
        book({ title: 'Other', metadataUpdatedAt: 100 }),
      ),
    ).toBeNull();
  });
});

describe('getBookWithUpdatedMetadata stamps metadataUpdatedAt', () => {
  it('sets metadataUpdatedAt alongside updatedAt on a metadata edit', () => {
    const before = Date.now();
    const updated = getBookWithUpdatedMetadata(book({}), {
      title: 'New',
      author: 'A',
      language: 'sv',
    });
    expect(updated.metadataUpdatedAt).toBeGreaterThanOrEqual(before);
    expect(updated.metadataUpdatedAt).toBe(updated.updatedAt);
  });
});
