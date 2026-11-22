// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { LibraryGroupByType, LibrarySortByType } from '@/types/settings';
import { createBookSorter } from '@/app/library/utils/libraryUtils';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { evaluateBookshelves } from '@/services/bookshelves/evaluate';
import { presentBookshelf } from '@/services/bookshelves/presentation';

const makeBooks = (titles: string[]): Book[] =>
  titles.map((title, index) => ({
    hash: `${index}`,
    title,
    author: 'Writer',
    format: 'EPUB',
    createdAt: index,
    updatedAt: index,
  }));
const titles = ['The Great Gatsby', 'A Tale of Two Cities', 'An American Tragedy', 'Dune'];
const expected = ['An American Tragedy', 'Dune', 'The Great Gatsby', 'A Tale of Two Cities'];

describe('ignoring leading English articles in title sorting', () => {
  it.each([true, false])('sorts primary and secondary titles (ascending: %s)', (ascending) => {
    for (const secondary of [false, true]) {
      const books = makeBooks(titles);
      books.sort(
        createBookSorter(
          secondary ? LibrarySortByType.Author : LibrarySortByType.Title,
          'en',
          secondary ? LibrarySortByType.Title : 'none',
          ascending,
          ascending,
        ),
      );
      expect(books.map((book) => book.title)).toEqual(
        ascending ? expected : [...expected].reverse(),
      );
      expect(books.map((book) => book.title).sort()).toEqual([...titles].sort());
    }
  });

  it('ignores leading articles by default', () => {
    expect(
      makeBooks(titles)
        .sort(createBookSorter(LibrarySortByType.Title, 'en'))
        .map((book) => book.title),
    ).toEqual(expected);
  });

  it('matches one whole leading article case-insensitively and preserves numeric collation', () => {
    const input = [
      'the Volume 12',
      'A Volume 3',
      'AN Volume 2',
      'Theatre',
      'Analysis',
      'Aardvark',
      'The',
      'An',
      'A',
      'Le Monde',
      'The The Book',
      '  The Volume 1',
    ];
    expect(
      makeBooks(input)
        .sort(createBookSorter(LibrarySortByType.Title, 'en'))
        .map((book) => book.title),
    ).toEqual([
      'A',
      'Aardvark',
      'An',
      'Analysis',
      'Le Monde',
      'The',
      'The The Book',
      'Theatre',
      '  The Volume 1',
      'AN Volume 2',
      'A Volume 3',
      'the Volume 12',
    ]);
  });

  it.each([
    'grid',
    'list',
    'carousel',
  ] as const)('applies to books in %s shelves and groups', (layout) => {
    const definition = {
      ...createBookshelf('Articles'),
      layout,
      sort: { by: 'title' as const, ascending: true, thenBy: 'none' as const, thenAscending: true },
    };
    const result = evaluateBookshelves(makeBooks(titles), [definition], 'en')[0]!;
    const settings = { libraryGroupBy: LibraryGroupByType.None };
    expect(
      presentBookshelf(result, settings, 'en').map((item) => 'title' in item && item.title),
    ).toEqual(expected);

    const grouped = presentBookshelf(
      result,
      { ...settings, libraryGroupBy: LibraryGroupByType.Author },
      'en',
    );
    const group = grouped[0]!;
    expect('books' in group && group.books.map((book) => book.title)).toEqual(expected);
    expect(
      presentBookshelf(
        result,
        { ...settings, libraryGroupBy: LibraryGroupByType.Author },
        'en',
        undefined,
        'id' in group ? group.id : '',
      ).map((item) => 'title' in item && item.title),
    ).toEqual(expected);
  });

  // #7786: a group named "The Collection" sorts under C, as a book with that title would.
  it.each([
    false,
    true,
  ])('ignores a leading article in group names too (saved order: %s)', (withOrder) => {
    const books = makeBooks([
      'The Great Gatsby',
      'Dune',
      'An American Tragedy',
      'A Tale of Two Cities',
      'Ender',
    ]);
    books[1]!.groupName = 'The Collection';
    books[4]!.groupName = 'Fables';
    const definition = {
      ...createBookshelf('Articles'),
      sort: {
        by: 'title' as const,
        ascending: true,
        thenBy: 'none' as const,
        thenAscending: true,
      },
    };
    const order = withOrder ? [{ by: LibrarySortByType.Title, ascending: true }] : undefined;
    const result = evaluateBookshelves(books, [definition], 'en')[0]!;
    expect(
      presentBookshelf(
        result,
        { libraryGroupBy: LibraryGroupByType.Group },
        'en',
        undefined,
        '',
        undefined,
        order,
      ).map((item) => ('books' in item ? item.name : item.title)),
    ).toEqual([
      'An American Tragedy',
      'The Collection',
      'Fables',
      'The Great Gatsby',
      'A Tale of Two Cities',
    ]);
  });
});
