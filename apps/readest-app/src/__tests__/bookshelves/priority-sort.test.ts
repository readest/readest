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

  // #4307: without a saved list, "Then by" is the within-group order. A saved list
  // always has a rank 2, so it is followed in rank order inside a group too (#7786).
  it('orders books inside a non-series group by rank 1 when an order is saved', () => {
    const mk = (hash: string, title: string, series: string) =>
      makeBook({
        hash,
        title,
        author: 'Tolkien',
        metadata: { title, author: 'Tolkien', language: 'en', series, seriesIndex: 1 },
      });
    const books = [mk('a', 'Apple', 'Zeta'), mk('b', 'Birch', 'Alpha'), mk('c', 'Cedar', 'Mid')];
    const sortOrder: LibrarySortCriterion[] = [
      { by: LibrarySortByType.Title, ascending: true },
      { by: LibrarySortByType.Series, ascending: true },
      { by: LibrarySortByType.Updated, ascending: false },
    ];
    const sorter = (order?: LibrarySortCriterion[]) =>
      createWithinGroupSorter(
        LibraryGroupByType.Author,
        LibrarySortByType.Title,
        'en',
        true,
        LibrarySortByType.Series,
        true,
        undefined,
        order,
      );
    expect([...books].sort(sorter(sortOrder)).map((book) => book.hash)).toEqual(['a', 'b', 'c']);
    expect([...books].sort(sorter()).map((book) => book.hash)).toEqual(['b', 'c', 'a']);
  });

  it('orders a Status group by Date Read, then Title, as the saved list ranks them', () => {
    const sortOrder: LibrarySortCriterion[] = [
      { by: LibrarySortByType.Updated, ascending: false },
      { by: LibrarySortByType.Title, ascending: true },
    ];
    const settings = {
      libraryGroupBy: LibraryGroupByType.Status,
      librarySortBy: LibrarySortByType.Updated,
      librarySortAscending: false,
      libraryThenSortBy: LibrarySortByType.Title,
      libraryThenSortAscending: true,
      librarySortOrder: sortOrder,
    };
    const baseDef = defaultBookshelves(settings).find((s) => s.id === 'default')!;
    const def = {
      ...baseDef,
      sort: resolveBookshelfSort(baseDef, getGlobalBookshelfSort(settings)),
    };
    const finished = (hash: string, title: string, updatedAt: number) =>
      makeBook({ hash, title, updatedAt, readingStatus: 'finished' });
    const books = [
      finished('old', 'Alpha', 1000),
      finished('new', 'Zeta', 3000),
      finished('mid', 'Mid', 2000),
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
    const [group] = presentBookshelf(result!, settings, 'en', undefined, '', undefined, sortOrder);
    expect(group && 'books' in group && group.books.map((book) => book.title)).toEqual([
      'Zeta',
      'Mid',
      'Alpha',
    ]);
    const groupId = group && 'books' in group ? group.id : '';
    const drilledIn = presentBookshelf(
      result!,
      settings,
      'en',
      undefined,
      groupId,
      undefined,
      sortOrder,
    );
    expect(drilledIn.map((item) => ('books' in item ? item.name : item.title))).toEqual([
      'Zeta',
      'Mid',
      'Alpha',
    ]);
  });

  // Users who never touch the list keep main's order: with Group by Series and
  // Sort by Series ascending, books without a series stay below the series groups.
  it('keeps books without a series below series groups when no order is saved', () => {
    const settings = {
      libraryGroupBy: LibraryGroupByType.Series,
      librarySortBy: LibrarySortByType.Updated,
      librarySortAscending: true,
      librarySortByAuto: true,
      libraryThenSortBy: 'none' as const,
      libraryThenSortAscending: true,
    };
    const baseDef = defaultBookshelves(settings).find((s) => s.id === 'default')!;
    const def = {
      ...baseDef,
      sort: resolveBookshelfSort(baseDef, getGlobalBookshelfSort(settings)),
    };
    const inSeries = (hash: string, series: string) =>
      makeBook({
        hash,
        title: `${series} 1`,
        metadata: { title: `${series} 1`, author: 'X', language: 'en', series, seriesIndex: 1 },
      });
    const books = [
      inSeries('s1', 'Alpha'),
      makeBook({ hash: 'n1', title: 'Loose A', updatedAt: 9000 }),
      inSeries('s2', 'Zeta'),
      makeBook({ hash: 'n2', title: 'Loose B', updatedAt: 100 }),
      inSeries('s3', 'Mid'),
    ];
    const [result] = evaluateBookshelves(books, [def], 'en');
    const items = presentBookshelf(result!, settings, 'en');
    expect(items.map((item) => ('books' in item ? `[${item.displayName}]` : item.title))).toEqual([
      '[Alpha]',
      '[Mid]',
      '[Zeta]',
      'Loose A',
      'Loose B',
    ]);
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

  // A finished book has no time remaining, as on its card: a group holding only
  // one ties with an unread book on Time Remaining, and Title decides.
  it('treats a group of finished books as having no time remaining', () => {
    const sortOrder: LibrarySortCriterion[] = [
      { by: LibrarySortByType.TimeRemaining, ascending: true },
      { by: LibrarySortByType.Title, ascending: true },
    ];
    const settings = {
      libraryGroupBy: LibraryGroupByType.Group,
      librarySortBy: LibrarySortByType.TimeRemaining,
      librarySortAscending: true,
      libraryThenSortBy: LibrarySortByType.Title,
      libraryThenSortAscending: true,
      librarySortOrder: sortOrder,
    };
    const baseDef = defaultBookshelves(settings).find((s) => s.id === 'default')!;
    const def = {
      ...baseDef,
      sort: resolveBookshelfSort(baseDef, getGlobalBookshelfSort(settings)),
    };
    const books: Book[] = [
      makeBook({ hash: 'apple', title: 'Apple', readingStatus: 'unread' }),
      makeBook({
        hash: 'done',
        title: 'Done Book',
        groupName: 'Zebra',
        readingStatus: 'finished',
        progress: [90, 100],
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
    expect(items.map((item) => ('books' in item ? item.displayName : item.title))).toEqual([
      'Apple',
      'Zebra',
    ]);
  });

  // Books of one series order by index; a group named like that series must sit
  // at one fixed place among them. Comparing it by Title instead made a cycle
  // (Apple < [Saga] < Zulu < Apple), so a pair and the full list disagreed.
  it('orders a group named like a series at one place among that series', () => {
    const sortOrder: LibrarySortCriterion[] = [
      { by: LibrarySortByType.Series, ascending: true },
      { by: LibrarySortByType.Title, ascending: true },
    ];
    const settings = {
      libraryGroupBy: LibraryGroupByType.Group,
      librarySortBy: LibrarySortByType.Series,
      librarySortAscending: true,
      libraryThenSortBy: LibrarySortByType.Title,
      libraryThenSortAscending: true,
      librarySortOrder: sortOrder,
    };
    const baseDef = defaultBookshelves(settings).find((s) => s.id === 'default')!;
    const def = {
      ...baseDef,
      sort: resolveBookshelfSort(baseDef, getGlobalBookshelfSort(settings)),
    };
    const inSaga = (hash: string, title: string, seriesIndex: number) =>
      makeBook({
        hash,
        title,
        metadata: { title, author: 'X', language: 'en', series: 'Saga', seriesIndex },
      });
    const sagaBooks = [inSaga('a', 'Zulu', 1), inSaga('b', 'Apple', 2)];
    const grouped = makeBook({ hash: 'g', title: 'Grouped', groupName: 'Saga' });
    const present = (input: Book[]) => {
      const [result] = evaluateBookshelves(
        input,
        [def],
        'en',
        undefined,
        undefined,
        undefined,
        sortOrder,
      );
      return presentBookshelf(result!, settings, 'en', undefined, '', undefined, sortOrder).map(
        (item) => ('books' in item ? `[${item.displayName}]` : item.title),
      );
    };
    expect(present([...sagaBooks, grouped])).toEqual(['[Saga]', 'Zulu', 'Apple']);
    for (const book of sagaBooks) expect(present([book, grouped])[0]).toBe('[Saga]');
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
