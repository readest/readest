// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Book, BooksGroup } from '@/types/book';
import { LibraryGroupByType, LibrarySortByType, type LibrarySortCriterion } from '@/types/settings';
import { createBookSorter, createWithinGroupSorter } from '@/app/library/utils/libraryUtils';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { evaluateBookshelves } from '@/services/bookshelves/evaluate';
import { presentBookshelf } from '@/services/bookshelves/presentation';

const makeBook = (overrides: Partial<Book> & { hash: string; title: string }): Book => ({
  format: 'EPUB',
  author: 'Author',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const label = (item: Book | BooksGroup) => ('books' in item ? `[${item.name}]` : item.title);

// #7786: books with no time left (unread, finished) sit after the ones with time
// in both directions, at every rank, as `withTimeRemainingLast` does for rank 1.
describe('Time Remaining descending keeps books without time last', () => {
  const books = [
    makeBook({ hash: 'unread', title: 'Unread' }),
    makeBook({ hash: 'done', title: 'Done', readingStatus: 'finished', progress: [100, 100] }),
    makeBook({ hash: 'short', title: 'Short', progress: [90, 100] }),
    makeBook({ hash: 'long', title: 'Long', progress: [10, 100] }),
  ];
  const hashes = (sorted: Book[]) => sorted.map((book) => book.hash);

  it('at rank 1, as search results sort', () => {
    const legacy = createBookSorter(LibrarySortByType.TimeRemaining, 'en', 'none', false);
    expect(hashes([...books].sort(legacy)).slice(0, 2)).toEqual(['long', 'short']);
    const ordered = createBookSorter(
      LibrarySortByType.TimeRemaining,
      'en',
      LibrarySortByType.Title,
      false,
      true,
      undefined,
      [
        { by: LibrarySortByType.TimeRemaining, ascending: false },
        { by: LibrarySortByType.Title, ascending: true },
      ],
    );
    expect(hashes([...books].sort(ordered))).toEqual(['long', 'short', 'done', 'unread']);
  });

  it('at rank 2 and below', () => {
    const legacy = createBookSorter(
      LibrarySortByType.Format,
      'en',
      LibrarySortByType.TimeRemaining,
      true,
      false,
    );
    expect(hashes([...books].sort(legacy)).slice(0, 2)).toEqual(['long', 'short']);
    const ordered = createBookSorter(
      LibrarySortByType.Format,
      'en',
      LibrarySortByType.TimeRemaining,
      true,
      false,
      undefined,
      [
        { by: LibrarySortByType.Format, ascending: true },
        { by: LibrarySortByType.TimeRemaining, ascending: false },
        { by: LibrarySortByType.Title, ascending: true },
      ],
    );
    expect(hashes([...books].sort(ordered))).toEqual(['long', 'short', 'done', 'unread']);
  });

  it('as the within-group key of an author group', () => {
    const sorter = createWithinGroupSorter(
      LibraryGroupByType.Author,
      LibrarySortByType.Title,
      'en',
      true,
      LibrarySortByType.TimeRemaining,
      false,
    );
    expect(hashes([...books].sort(sorter))).toEqual(['long', 'short', 'done', 'unread']);
  });

  it('between a group and a book tied on rank 1', () => {
    const shelfBooks = [
      makeBook({ hash: 'aaa', title: 'Aaa', pageCount: 200 }),
      makeBook({ hash: 'reading', title: 'Reading', progress: [20, 200] }),
      makeBook({
        hash: 'grouped',
        title: 'Grouped',
        groupName: 'Shelf',
        readingStatus: 'finished',
        progress: [200, 200],
      }),
    ];
    const definition = {
      ...createBookshelf('Shelf'),
      sort: { by: 'pages' as const, ascending: true, thenBy: 'none' as const, thenAscending: true },
    };
    const order: LibrarySortCriterion[] = [
      { by: LibrarySortByType.Pages, ascending: true },
      { by: LibrarySortByType.TimeRemaining, ascending: false },
      { by: LibrarySortByType.Title, ascending: true },
    ];
    const [result] = evaluateBookshelves(
      shelfBooks,
      [definition],
      'en',
      undefined,
      undefined,
      undefined,
      order,
    );
    const items = presentBookshelf(
      result!,
      { libraryGroupBy: LibraryGroupByType.Group },
      'en',
      undefined,
      '',
      undefined,
      order,
    );
    expect(items.map(label)).toEqual(['Reading', 'Aaa', '[Shelf]']);
  });
});
