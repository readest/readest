// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { LibraryGroupByType, LibrarySortByType, type LibrarySortCriterion } from '@/types/settings';
import { createBookSorter, createWithinGroupSorter } from '@/app/library/utils/libraryUtils';
import { bookshelfSchema, defaultBookshelves } from '@/services/bookshelves/definitions';
import { evaluateBookshelves } from '@/services/bookshelves/evaluate';
import { presentBookshelf } from '@/services/bookshelves/presentation';
import {
  METADATA_SORT_BY_ORDER,
  getGlobalBookshelfSort,
  resolveBookshelfSort,
  resolveLibrarySortOrder,
} from '@/services/bookshelves/sorting';

const makeBook = (overrides: Partial<Book> & { hash: string; title: string }): Book => ({
  format: 'EPUB',
  author: 'Author',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

describe('priority-based library sorting', () => {
  it('deduplicates stored criteria and fills missing keys in canonical order', () => {
    const resolved = resolveLibrarySortOrder(
      {
        librarySortOrder: [
          { by: LibrarySortByType.Author, ascending: false },
          { by: LibrarySortByType.Author, ascending: true },
          { by: LibrarySortByType.Pages, ascending: true },
        ],
      },
      {
        by: LibrarySortByType.Author,
        ascending: false,
        thenBy: LibrarySortByType.Pages,
        thenAscending: true,
      },
    );

    expect(resolved).toHaveLength(METADATA_SORT_BY_ORDER.length);
    expect(new Set(resolved.map((c) => c.by)).size).toBe(METADATA_SORT_BY_ORDER.length);
    expect(resolved[0]).toEqual({ by: LibrarySortByType.Author, ascending: false });
    expect(resolved[1]).toEqual({ by: LibrarySortByType.Pages, ascending: true });
  });

  it('builds priority list from legacy primary and secondary settings when librarySortOrder is absent', () => {
    const resolved = resolveLibrarySortOrder(
      {},
      {
        by: LibrarySortByType.Published,
        ascending: false,
        thenBy: LibrarySortByType.Title,
        thenAscending: true,
      },
    );

    expect(resolved[0]).toEqual({ by: LibrarySortByType.Published, ascending: false });
    expect(resolved[1]).toEqual({ by: LibrarySortByType.Title, ascending: true });
    expect(resolved).toHaveLength(METADATA_SORT_BY_ORDER.length);
  });

  it('breaks ties across 3+ priority criteria with independent ascending/descending directions', () => {
    const books: Book[] = [
      makeBook({ hash: 'a', title: 'Beta', author: 'Alice', updatedAt: 2000, pageCount: 100 }),
      makeBook({ hash: 'b', title: 'Alpha', author: 'Alice', updatedAt: 2000, pageCount: 300 }),
      makeBook({ hash: 'c', title: 'Gamma', author: 'Alice', updatedAt: 2000, pageCount: 200 }),
      makeBook({ hash: 'd', title: 'Zeta', author: 'Bob', updatedAt: 3000, pageCount: 50 }),
    ];

    const sortOrder: LibrarySortCriterion[] = [
      { by: LibrarySortByType.Updated, ascending: false },
      { by: LibrarySortByType.Author, ascending: true },
      { by: LibrarySortByType.Pages, ascending: false },
      { by: LibrarySortByType.Title, ascending: true },
    ];

    const sorted = [...books].sort(
      createBookSorter('updated', 'en', 'none', false, true, undefined, sortOrder),
    );
    // d has highest updatedAt (3000); a/b/c tie on updatedAt=2000 and author='Alice',
    // so rank 3 (Pages descending) orders b (300) -> c (200) -> a (100).
    expect(sorted.map((b) => b.hash)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('keeps bookshelfSchema valid and evaluates all books when librarySortOrder is set', () => {
    const sortOrder: LibrarySortCriterion[] = [
      { by: LibrarySortByType.Updated, ascending: false },
      { by: LibrarySortByType.Author, ascending: true },
      { by: LibrarySortByType.Pages, ascending: false },
    ];
    const settings = {
      librarySortBy: LibrarySortByType.Updated,
      librarySortAscending: false,
      libraryThenSortBy: LibrarySortByType.Author,
      libraryThenSortAscending: true,
      librarySortOrder: sortOrder,
    };
    const globalSort = getGlobalBookshelfSort(settings);
    const definitions = defaultBookshelves(settings).map((s) => ({
      ...s,
      sort: resolveBookshelfSort(s, globalSort),
    }));
    for (const def of definitions) {
      expect(bookshelfSchema.safeParse(def).success).toBe(true);
    }

    const books: Book[] = [
      makeBook({ hash: 'a', title: 'Beta', author: 'Alice', updatedAt: 2000, pageCount: 100 }),
      makeBook({ hash: 'b', title: 'Alpha', author: 'Alice', updatedAt: 2000, pageCount: 300 }),
    ];
    const evaluated = evaluateBookshelves(
      books,
      definitions,
      'en',
      undefined,
      undefined,
      undefined,
      sortOrder,
    );
    const defaultResult = evaluated.find((r) => r.definition.id === 'default');
    expect(defaultResult?.books.map((b) => b.hash)).toEqual(['b', 'a']);
  });

  it('respects priority #1 before #2 inside non-series groups when sortOrder is active', () => {
    const a = makeBook({ hash: 'a', title: 'A', updatedAt: 2000, pageCount: 100 });
    const b = makeBook({ hash: 'b', title: 'B', updatedAt: 3000, pageCount: 300 });
    const sortOrder: LibrarySortCriterion[] = [
      { by: LibrarySortByType.Updated, ascending: false },
      { by: LibrarySortByType.Pages, ascending: true },
      { by: LibrarySortByType.Title, ascending: true },
    ];
    const sorter = createWithinGroupSorter(
      LibraryGroupByType.Author,
      LibrarySortByType.Updated,
      'en',
      false,
      LibrarySortByType.Pages,
      true,
      undefined,
      sortOrder,
    );
    expect([a, b].sort(sorter).map((book) => book.hash)).toEqual(['b', 'a']);
  });

  it('applies priority criteria #2+ to group and mixed comparisons in presentBookshelf', () => {
    const sortOrder: LibrarySortCriterion[] = [
      { by: LibrarySortByType.Pages, ascending: true },
      { by: LibrarySortByType.Title, ascending: false },
    ];
    const settings = {
      libraryGroupBy: LibraryGroupByType.Series,
      librarySortBy: LibrarySortByType.Pages,
      librarySortAscending: true,
      libraryThenSortBy: LibrarySortByType.Title,
      libraryThenSortAscending: false,
      librarySortOrder: sortOrder,
    };
    const globalSort = getGlobalBookshelfSort(settings);
    const baseDef = defaultBookshelves(settings).find((s) => s.id === 'default')!;
    const def = {
      ...baseDef,
      sort: resolveBookshelfSort(baseDef, globalSort),
    };
    const books: Book[] = [
      makeBook({
        hash: 'g-apple',
        title: 'Apple Book',
        updatedAt: 1000,
        pageCount: 200,
        metadata: { title: 'Apple Book', author: 'Author', language: 'en', series: 'Apple' },
      }),
      makeBook({
        hash: 'g-zebra',
        title: 'Zebra Book',
        updatedAt: 1000,
        pageCount: 200,
        metadata: { title: 'Zebra Book', author: 'Author', language: 'en', series: 'Zebra' },
      }),
      makeBook({
        hash: 'u-middle',
        title: 'Middle',
        updatedAt: 1000,
        pageCount: 200,
      }),
    ];
    const [result] = evaluateBookshelves(
      books,
      [def],
      'en',
      undefined,
      undefined,
      undefined,
      sortOrder,
    );
    const items = presentBookshelf(result!, settings, 'en', undefined, '', undefined, sortOrder);
    const names = items.map((item) => ('books' in item ? item.displayName : item.title));
    expect(names).toEqual(['Zebra', 'Middle', 'Apple']);
  });

  it('applies explicit URL sort params over stored librarySortOrder while preserving remaining order', () => {
    const stored: LibrarySortCriterion[] = [
      { by: LibrarySortByType.Updated, ascending: false },
      { by: LibrarySortByType.Author, ascending: true },
      { by: LibrarySortByType.Title, ascending: true },
    ];
    const params = new URLSearchParams('sort=pages&order=desc&thenSort=title&thenOrder=desc');
    const resolved = resolveLibrarySortOrder(
      {
        librarySortBy: LibrarySortByType.Author,
        librarySortOrder: stored,
      },
      getGlobalBookshelfSort({ librarySortOrder: stored }, params),
      params,
    );
    expect(resolved.slice(0, 4)).toEqual([
      { by: LibrarySortByType.Pages, ascending: false },
      { by: LibrarySortByType.Title, ascending: false },
      { by: LibrarySortByType.Updated, ascending: false },
      { by: LibrarySortByType.Author, ascending: true },
    ]);
  });

  it('tie-breaks unread books with unavailable TimeRemaining by criterion #2 in evaluateBookshelves and presentBookshelf', () => {
    const sortOrder: LibrarySortCriterion[] = [
      { by: LibrarySortByType.TimeRemaining, ascending: true },
      { by: LibrarySortByType.Title, ascending: true },
    ];
    const settings = {
      libraryGroupBy: LibraryGroupByType.None,
      librarySortBy: LibrarySortByType.TimeRemaining,
      librarySortAscending: true,
      libraryThenSortBy: LibrarySortByType.Title,
      libraryThenSortAscending: true,
      librarySortOrder: sortOrder,
    };
    const globalSort = getGlobalBookshelfSort(settings);
    const baseDef = defaultBookshelves(settings).find((s) => s.id === 'default')!;
    const def = { ...baseDef, sort: resolveBookshelfSort(baseDef, globalSort) };
    const books: Book[] = [
      makeBook({ hash: 'z', title: 'Zebra', updatedAt: 2000 }),
      makeBook({ hash: 'a', title: 'Apple', updatedAt: 1000 }),
    ];
    const [result] = evaluateBookshelves(
      books,
      [def],
      'en',
      undefined,
      undefined,
      undefined,
      sortOrder,
    );
    expect(result?.books.map((b) => b.hash)).toEqual(['a', 'z']);
    const items = presentBookshelf(result!, settings, 'en', undefined, '', undefined, sortOrder);
    expect(items.map((item) => ('books' in item ? item.displayName : item.title))).toEqual([
      'Apple',
      'Zebra',
    ]);
  });

  it('continues past Infinity vs Infinity TimeRemaining ties and compares book Series in mixed groups', () => {
    const sortOrder: LibrarySortCriterion[] = [
      { by: LibrarySortByType.Pages, ascending: true },
      { by: LibrarySortByType.TimeRemaining, ascending: true },
      { by: LibrarySortByType.Series, ascending: true },
      { by: LibrarySortByType.Title, ascending: true },
    ];
    const settings = {
      libraryGroupBy: LibraryGroupByType.Series,
      librarySortBy: LibrarySortByType.Pages,
      librarySortAscending: true,
      libraryThenSortBy: LibrarySortByType.TimeRemaining,
      libraryThenSortAscending: true,
      librarySortOrder: sortOrder,
    };
    const globalSort = getGlobalBookshelfSort(settings);
    const baseDef = defaultBookshelves(settings).find((s) => s.id === 'default')!;
    const def = { ...baseDef, sort: resolveBookshelfSort(baseDef, globalSort) };
    const books: Book[] = [
      makeBook({
        hash: 'g-zeta',
        title: 'Zeta Book',
        updatedAt: 100,
        pageCount: 200,
        metadata: { title: 'Zeta Book', author: 'Author', language: 'en', series: 'Zeta Series' },
      }),
      makeBook({
        hash: 'u-alpha',
        title: 'Alpha Book',
        updatedAt: 999999,
        pageCount: 200,
        metadata: { title: 'Alpha Book', author: 'Author', language: 'en', series: 'Alpha Series' },
      }),
      makeBook({
        hash: 'g-beta',
        title: 'Beta Book',
        updatedAt: 500,
        pageCount: 200,
        metadata: { title: 'Beta Book', author: 'Author', language: 'en', series: 'Beta Series' },
      }),
    ];
    // Ungrouped Alpha Book has no series grouping only when series is empty; here use groupBy=Group with empty groupName vs named group:
    const groupSettings = { ...settings, libraryGroupBy: LibraryGroupByType.Group };
    const groupDef = {
      ...baseDef,
      sort: resolveBookshelfSort(baseDef, getGlobalBookshelfSort(groupSettings)),
    };
    const mixedBooks: Book[] = [
      makeBook({
        hash: 'g-zeta',
        title: 'Zeta Book',
        updatedAt: 100,
        pageCount: 200,
        groupName: 'Zeta Series',
      }),
      makeBook({
        hash: 'u-alpha',
        title: 'Alpha Book',
        updatedAt: 999999,
        pageCount: 200,
        metadata: { title: 'Alpha Book', author: 'Author', language: 'en', series: 'Alpha Series' },
      }),
      makeBook({
        hash: 'g-beta',
        title: 'Beta Book',
        updatedAt: 500,
        pageCount: 200,
        groupName: 'Beta Series',
      }),
    ];
    void books;
    void def;
    const [result] = evaluateBookshelves(
      mixedBooks,
      [groupDef],
      'en',
      undefined,
      undefined,
      undefined,
      sortOrder,
    );
    const items = presentBookshelf(
      result!,
      groupSettings,
      'en',
      undefined,
      '',
      undefined,
      sortOrder,
    );
    const names = items.map((item) => ('books' in item ? item.displayName : item.title));
    expect(names).toEqual(['Alpha Book', 'Beta Series', 'Zeta Series']);
  });
});
