// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { LibrarySortByType, type LibrarySortCriterion } from '@/types/settings';
import { createBookSorter } from '@/app/library/utils/libraryUtils';
import { bookshelfSchema, defaultBookshelves } from '@/services/bookshelves/definitions';
import { evaluateBookshelves } from '@/services/bookshelves/evaluate';
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
});
