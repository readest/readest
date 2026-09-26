import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import {
  applyBookTagEdits,
  getLibraryTags,
  getTagSelectionState,
} from '@/app/library/utils/libraryUtils';

const book = (hash: string, tags?: string[], extra: Partial<Book> = {}): Book => ({
  hash,
  title: hash,
  author: '',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  tags,
  ...extra,
});

describe('getLibraryTags', () => {
  it('lists every tag in the library once, sorted, skipping deleted books', () => {
    const books = [
      book('a', ['Sci-Fi', ' Classic ']),
      book('b', ['Classic', 'Adventure']),
      book('c', ['Gone'], { deletedAt: 5 }),
      book('d'),
    ];
    expect(getLibraryTags(books)).toEqual(['Adventure', 'Classic', 'Sci-Fi']);
  });
});

describe('getTagSelectionState', () => {
  const books = [book('a', ['Classic', 'Sci-Fi']), book('b', ['Classic'])];
  it('reports whether all, some or none of the books carry the tag', () => {
    expect(getTagSelectionState(books, 'Classic')).toBe('all');
    expect(getTagSelectionState(books, 'Sci-Fi')).toBe('some');
    expect(getTagSelectionState(books, 'Horror')).toBe('none');
  });
});

describe('applyBookTagEdits', () => {
  const now = 1000;

  it('adds and removes tags on the selected books only, stamping the metadata clock', () => {
    const books = [
      book('a', ['Classic', 'Sci-Fi']),
      book('b', ['Classic']),
      book('c', ['Classic']),
    ];
    const result = applyBookTagEdits(
      books,
      ['a', 'b'],
      { add: ['Favorites'], remove: ['Classic'] },
      now,
    );
    expect(result[0]).toMatchObject({ tags: ['Sci-Fi', 'Favorites'], updatedAt: now });
    expect(result[0]!.metadataUpdatedAt).toBe(now);
    expect(result[1]!.tags).toEqual(['Favorites']);
    expect(result[2]).toBe(books[2]);
  });

  it('leaves books untouched when nothing changes for them', () => {
    const books = [book('a', ['Classic']), book('b', ['Old'], { deletedAt: 5 })];
    const result = applyBookTagEdits(books, ['a', 'b'], { add: ['Classic'], remove: ['Old'] }, now);
    expect(result[0]).toBe(books[0]);
    expect(result[1]).toBe(books[1]);
  });

  it('returns new book objects instead of mutating the originals', () => {
    const books = [book('a', ['Classic'])];
    applyBookTagEdits(books, ['a'], { add: ['New'], remove: [] }, now);
    expect(books[0]!.tags).toEqual(['Classic']);
    expect(books[0]!.updatedAt).toBe(1);
  });
});
