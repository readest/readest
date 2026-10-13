import { describe, expect, it } from 'vitest';
import {
  bookshelfSchema,
  createBookshelf,
  defaultBookshelves,
} from '@/services/bookshelves/definitions';
import { getGlobalBookshelfSort, resolveBookshelfSort } from '@/services/bookshelves/sorting';

describe('bookshelf sorting inheritance', () => {
  it('defaults every built-in and new shelf to global sorting, including older definitions', () => {
    const global = getGlobalBookshelfSort({
      librarySortBy: 'author',
      librarySortAscending: true,
      libraryThenSortBy: 'title',
      libraryThenSortAscending: false,
    });
    for (const shelf of [...defaultBookshelves({}), createBookshelf('New')]) {
      expect(shelf.useGlobalSort).toBe(true);
      expect(resolveBookshelfSort(shelf, global)).toEqual(global);
      const { useGlobalSort: _legacy, ...old } = shelf;
      expect(bookshelfSchema.safeParse(old).success).toBe(true);
      expect(resolveBookshelfSort(old, global)).toEqual(global);
      expect(resolveBookshelfSort({ ...shelf, useGlobalSort: false }, global)).toEqual(shelf.sort);
    }
  });
  it('retains grouping smart defaults and honors explicit URL sorting and directions', () => {
    expect(getGlobalBookshelfSort({ libraryGroupBy: 'series' }).by).toBe('series');
    expect(getGlobalBookshelfSort({ libraryGroupBy: 'author' }).thenBy).toBe('series');
    expect(
      getGlobalBookshelfSort({
        libraryGroupBy: 'series',
        librarySortByAuto: false,
        librarySortBy: 'title',
      }).by,
    ).toBe('title');
    expect(
      getGlobalBookshelfSort(
        { libraryGroupBy: 'series' },
        new URLSearchParams('sort=author&order=asc&thenSort=progress&thenOrder=desc'),
      ),
    ).toEqual({
      by: 'author',
      ascending: true,
      thenBy: 'progress',
      thenAscending: false,
    });
    expect(
      getGlobalBookshelfSort(
        { librarySortBy: 'title' },
        new URLSearchParams('sort=invalid&order=invalid'),
      ),
    ).toMatchObject({ by: 'title', ascending: false });
  });
  it('validates the inheritance flag at persistence and sync boundaries', () => {
    expect(
      bookshelfSchema.safeParse({ ...createBookshelf('Independent'), useGlobalSort: false })
        .success,
    ).toBe(true);
    expect(
      bookshelfSchema.safeParse({ ...createBookshelf('Invalid'), useGlobalSort: 'false' }).success,
    ).toBe(false);
  });
});
