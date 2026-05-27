import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import type { BookMetadata } from '@/libs/document';
import type { OPDSPublication } from '@/types/opds';
import { findExistingBookForPublication } from '@/app/opds/utils/findExistingBook';

const book = (title: string, overrides: Partial<Book> = {}): Book => ({
  hash: overrides.hash ?? title,
  format: 'EPUB',
  title,
  author: '',
  metadata: { title, author: '', language: '' } as BookMetadata,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const publication = (title?: string, author = 'Author'): OPDSPublication => ({
  metadata: {
    ...(title ? { title } : {}),
    author: [{ name: author, links: [] }],
  },
  links: [],
  images: [],
});

describe('findExistingBookForPublication', () => {
  it('matches by normalized title', () => {
    expect(
      findExistingBookForPublication(publication('  Some   Title  '), [book('some title')])?.hash,
    ).toBe('some title');
  });

  it('does not require matching authors', () => {
    expect(
      findExistingBookForPublication(publication('Shared Title', 'Author A'), [
        book('Shared Title', { author: 'Author B' }),
      ])?.hash,
    ).toBe('Shared Title');
  });

  it('skips soft-deleted books', () => {
    expect(
      findExistingBookForPublication(publication('Deleted'), [
        book('Deleted', { deletedAt: Date.now() }),
      ]),
    ).toBeNull();
  });

  it('returns null without a title match', () => {
    expect(findExistingBookForPublication(publication(), [book('Untitled')])).toBeNull();
    expect(findExistingBookForPublication(publication('A'), [book('B')])).toBeNull();
  });
});
