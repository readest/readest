import { describe, it, expect } from 'vitest';
import {
  parseAuthors,
  createBookGroups,
  createWithinGroupSorter,
  createGroupSorter,
  getGroupSortValue,
  createBookSorter,
  ensureLibrarySortByType,
  ensureLibrarySecondarySortByType,
  ensureLibraryGroupByType,
  resolveEffectivePrimarySort,
  resolveEffectiveSecondarySort,
  findGroupById,
  getGroupDisplayName,
  expandBookshelfSelection,
  buildGroupNameUpdatedAt,
} from '../../app/library/utils/libraryUtils';
import { Book, BooksGroup } from '../../types/book';
import { LibraryGroupByType, LibrarySortByType } from '../../types/settings';
import { BookMetadata } from '@/libs/document';

// Helper to create mock books with minimal required fields
const createMockBook = (
  overrides: Partial<Omit<Book, 'metadata'> & { metadata?: Partial<BookMetadata> }> = {},
): Book => ({
  hash: `hash-${Math.random().toString(36).substr(2, 9)}`,
  format: 'EPUB',
  title: 'Test Book',
  author: 'Test Author',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
  metadata: { ...overrides.metadata } as BookMetadata,
});

describe('parseAuthors', () => {
  it('should return single author as array', () => {
    expect(parseAuthors('John Smith')).toEqual(['John Smith']);
  });

  it('should split authors by comma', () => {
    expect(parseAuthors('John Smith, Jane Doe')).toEqual(['John Smith', 'Jane Doe']);
  });

  it('should split authors by ampersand', () => {
    expect(parseAuthors('John Smith & Jane Doe')).toEqual(['John Smith', 'Jane Doe']);
  });

  it('should split authors by "and"', () => {
    expect(parseAuthors('John Smith and Jane Doe')).toEqual(['John Smith', 'Jane Doe']);
  });

  it('should handle mixed separators', () => {
    expect(parseAuthors('John Smith, Jane Doe & Bob Wilson')).toEqual([
      'John Smith',
      'Jane Doe',
      'Bob Wilson',
    ]);
  });

  it('should handle "and" with commas', () => {
    expect(parseAuthors('John Smith, Jane Doe, and Bob Wilson')).toEqual([
      'John Smith',
      'Jane Doe',
      'Bob Wilson',
    ]);
  });

  it('should trim whitespace from author names', () => {
    expect(parseAuthors('  John Smith  ,  Jane Doe  ')).toEqual(['John Smith', 'Jane Doe']);
  });

  it('should return empty array for empty string', () => {
    expect(parseAuthors('')).toEqual([]);
  });

  it('should return empty array for whitespace only', () => {
    expect(parseAuthors('   ')).toEqual([]);
  });

  it('should handle single author with extra spaces', () => {
    expect(parseAuthors('  John Smith  ')).toEqual(['John Smith']);
  });
});

describe('createBookGroups', () => {
  describe('groupBy: none', () => {
    it('should return all books as flat list', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1' }),
        createMockBook({ hash: '2', title: 'Book 2' }),
      ];

      const result = createBookGroups(books, LibraryGroupByType.None);

      expect(result).toHaveLength(2);
      expect(result.every((item) => 'format' in item)).toBe(true);
    });

    it('should filter out deleted books', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1' }),
        createMockBook({ hash: '2', title: 'Book 2', deletedAt: Date.now() }),
      ];

      const result = createBookGroups(books, LibraryGroupByType.None);

      expect(result).toHaveLength(1);
    });
  });

  describe('groupBy: series', () => {
    it('should group books by series name', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1', metadata: { series: 'Series A' } }),
        createMockBook({ hash: '2', title: 'Book 2', metadata: { series: 'Series A' } }),
        createMockBook({ hash: '3', title: 'Book 3', metadata: { series: 'Series B' } }),
      ];

      const result = createBookGroups(books, LibraryGroupByType.Series);

      const groups = result.filter((item): item is BooksGroup => 'books' in item);
      expect(groups).toHaveLength(2);

      const seriesA = groups.find((g) => g.name === 'Series A');
      expect(seriesA?.books).toHaveLength(2);

      const seriesB = groups.find((g) => g.name === 'Series B');
      expect(seriesB?.books).toHaveLength(1);
    });

    it('should leave books without series as ungrouped items', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1', metadata: { series: 'Series A' } }),
        createMockBook({ hash: '2', title: 'Book 2' }), // No series
        createMockBook({ hash: '3', title: 'Book 3', metadata: {} }), // Empty metadata
      ];

      const result = createBookGroups(books, LibraryGroupByType.Series);

      const groups = result.filter((item): item is BooksGroup => 'books' in item);
      const ungrouped = result.filter((item): item is Book => 'format' in item);

      expect(groups).toHaveLength(1);
      expect(ungrouped).toHaveLength(2);
    });

    it('should handle empty series string as ungrouped', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1', metadata: { series: '' } }),
        createMockBook({ hash: '2', title: 'Book 2', metadata: { series: '  ' } }),
      ];

      const result = createBookGroups(books, LibraryGroupByType.Series);

      const groups = result.filter((item): item is BooksGroup => 'books' in item);
      const ungrouped = result.filter((item): item is Book => 'format' in item);

      expect(groups).toHaveLength(0);
      expect(ungrouped).toHaveLength(2);
    });

    it('should set group updatedAt to most recent book', () => {
      const books = [
        createMockBook({
          hash: '1',
          title: 'Book 1',
          metadata: { series: 'Series A' },
          updatedAt: 1000,
        }),
        createMockBook({
          hash: '2',
          title: 'Book 2',
          metadata: { series: 'Series A' },
          updatedAt: 2000,
        }),
      ];

      const result = createBookGroups(books, LibraryGroupByType.Series);
      const group = result.find((item): item is BooksGroup => 'books' in item);

      expect(group?.updatedAt).toBe(2000);
    });
  });

  describe('groupBy: author', () => {
    it('should group books by author', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1', author: 'Author A' }),
        createMockBook({ hash: '2', title: 'Book 2', author: 'Author A' }),
        createMockBook({ hash: '3', title: 'Book 3', author: 'Author B' }),
      ];

      const result = createBookGroups(books, LibraryGroupByType.Author);

      const groups = result.filter((item): item is BooksGroup => 'books' in item);
      expect(groups).toHaveLength(2);

      const authorA = groups.find((g) => g.name === 'Author A');
      expect(authorA?.books).toHaveLength(2);
    });

    it('should place book in multiple groups for multiple authors', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1', author: 'John Smith, Jane Doe' }),
      ];

      const result = createBookGroups(books, LibraryGroupByType.Author);

      const groups = result.filter((item): item is BooksGroup => 'books' in item);
      expect(groups).toHaveLength(2);

      const john = groups.find((g) => g.name === 'John Smith');
      const jane = groups.find((g) => g.name === 'Jane Doe');

      expect(john?.books).toHaveLength(1);
      expect(jane?.books).toHaveLength(1);
      expect(john?.books[0]?.hash).toBe(jane?.books[0]?.hash);
    });

    it('should leave books without author as ungrouped', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1', author: 'Author A' }),
        createMockBook({ hash: '2', title: 'Book 2', author: '' }),
        createMockBook({ hash: '3', title: 'Book 3', author: '   ' }),
      ];

      const result = createBookGroups(books, LibraryGroupByType.Author);

      const groups = result.filter((item): item is BooksGroup => 'books' in item);
      const ungrouped = result.filter((item): item is Book => 'format' in item);

      expect(groups).toHaveLength(1);
      expect(ungrouped).toHaveLength(2);
    });
  });

  describe('groupBy: group', () => {
    it('should return books as-is (group mode handled elsewhere)', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1' }),
        createMockBook({ hash: '2', title: 'Book 2' }),
      ];

      const result = createBookGroups(books, LibraryGroupByType.Group);

      // Group mode just returns filtered books - actual grouping is in generateBookshelfItems
      expect(result).toHaveLength(2);
    });
  });
});

describe('createWithinGroupSorter', () => {
  describe('series grouping', () => {
    it('should sort by seriesIndex ascending', () => {
      const books = [
        createMockBook({
          hash: '1',
          title: 'Book 3',
          metadata: { seriesIndex: 3 },
        }),
        createMockBook({
          hash: '2',
          title: 'Book 1',
          metadata: { seriesIndex: 1 },
        }),
        createMockBook({
          hash: '3',
          title: 'Book 2',
          metadata: { seriesIndex: 2 },
        }),
      ];

      const sorter = createWithinGroupSorter(
        LibraryGroupByType.Series,
        LibrarySortByType.Title,
        'en',
      );
      const sorted = [...books].sort(sorter);

      expect(sorted[0]!.metadata?.seriesIndex).toBe(1);
      expect(sorted[1]!.metadata?.seriesIndex).toBe(2);
      expect(sorted[2]!.metadata?.seriesIndex).toBe(3);
    });

    it('should place books without seriesIndex after those with index', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book A', metadata: {} }),
        createMockBook({ hash: '2', title: 'Book B', metadata: { seriesIndex: 1 } }),
      ];

      const sorter = createWithinGroupSorter(
        LibraryGroupByType.Series,
        LibrarySortByType.Title,
        'en',
      );
      const sorted = [...books].sort(sorter);

      expect(sorted[0]!.hash).toBe('2'); // Has index
      expect(sorted[1]!.hash).toBe('1'); // No index
    });

    it('should sort books without seriesIndex by global sort criteria', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Zebra', metadata: {} }),
        createMockBook({ hash: '2', title: 'Apple', metadata: {} }),
      ];

      const sorter = createWithinGroupSorter(
        LibraryGroupByType.Series,
        LibrarySortByType.Title,
        'en',
      );
      const sorted = [...books].sort(sorter);

      expect(sorted[0]!.title).toBe('Apple');
      expect(sorted[1]!.title).toBe('Zebra');
    });

    it('should handle decimal seriesIndex values', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 2', metadata: { seriesIndex: 2 } }),
        createMockBook({ hash: '2', title: 'Book 1.5', metadata: { seriesIndex: 1.5 } }),
        createMockBook({ hash: '3', title: 'Book 1', metadata: { seriesIndex: 1 } }),
      ];

      const sorter = createWithinGroupSorter(
        LibraryGroupByType.Series,
        LibrarySortByType.Title,
        'en',
      );
      const sorted = [...books].sort(sorter);

      expect(sorted[0]!.metadata?.seriesIndex).toBe(1);
      expect(sorted[1]!.metadata?.seriesIndex).toBe(1.5);
      expect(sorted[2]!.metadata?.seriesIndex).toBe(2);
    });
  });

  describe('series grouping with sort direction', () => {
    it('should always sort by seriesIndex ascending even when sortAscending is false', () => {
      const books = [
        createMockBook({
          hash: '1',
          title: 'Book 3',
          metadata: { seriesIndex: 3 },
        }),
        createMockBook({
          hash: '2',
          title: 'Book 1',
          metadata: { seriesIndex: 1 },
        }),
        createMockBook({
          hash: '3',
          title: 'Book 2',
          metadata: { seriesIndex: 2 },
        }),
      ];

      const sorter = createWithinGroupSorter(
        LibraryGroupByType.Series,
        LibrarySortByType.Title,
        'en',
        false, // descending
      );
      const sorted = [...books].sort(sorter);

      // Series index should always be ascending (1, 2, 3) regardless of sort direction
      expect(sorted[0]!.metadata?.seriesIndex).toBe(1);
      expect(sorted[1]!.metadata?.seriesIndex).toBe(2);
      expect(sorted[2]!.metadata?.seriesIndex).toBe(3);
    });

    it('should apply sort direction to fallback sort for books without seriesIndex', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Apple', metadata: {} }),
        createMockBook({ hash: '2', title: 'Zebra', metadata: {} }),
      ];

      const sorterDesc = createWithinGroupSorter(
        LibraryGroupByType.Series,
        LibrarySortByType.Title,
        'en',
        false, // descending
      );
      const sortedDesc = [...books].sort(sorterDesc);

      expect(sortedDesc[0]!.title).toBe('Zebra');
      expect(sortedDesc[1]!.title).toBe('Apple');
    });

    it('should place books with seriesIndex before those without regardless of sort direction', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Apple', metadata: {} }),
        createMockBook({ hash: '2', title: 'Book 1', metadata: { seriesIndex: 1 } }),
      ];

      const sorter = createWithinGroupSorter(
        LibraryGroupByType.Series,
        LibrarySortByType.Title,
        'en',
        false, // descending
      );
      const sorted = [...books].sort(sorter);

      expect(sorted[0]!.hash).toBe('2'); // Has index, comes first
      expect(sorted[1]!.hash).toBe('1'); // No index
    });
  });

  describe('author grouping', () => {
    it('should sort by global sort criteria (title)', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Zebra' }),
        createMockBook({ hash: '2', title: 'Apple' }),
      ];

      const sorter = createWithinGroupSorter(
        LibraryGroupByType.Author,
        LibrarySortByType.Title,
        'en',
      );
      const sorted = [...books].sort(sorter);

      expect(sorted[0]!.title).toBe('Apple');
      expect(sorted[1]!.title).toBe('Zebra');
    });

    it('should sort by global sort criteria (updated)', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1', updatedAt: 2000 }),
        createMockBook({ hash: '2', title: 'Book 2', updatedAt: 1000 }),
      ];

      const sorter = createWithinGroupSorter(
        LibraryGroupByType.Author,
        LibrarySortByType.Updated,
        'en',
      );
      const sorted = [...books].sort(sorter);

      expect(sorted[0]!.updatedAt).toBe(1000);
      expect(sorted[1]!.updatedAt).toBe(2000);
    });
  });
});

describe('getGroupSortValue', () => {
  const createMockGroup = (overrides: Partial<BooksGroup> = {}): BooksGroup => ({
    id: 'test-group',
    name: 'Test Group',
    displayName: 'Test Group',
    books: [],
    updatedAt: Date.now(),
    ...overrides,
  });

  it('should return group name for title sort', () => {
    const group = createMockGroup({ name: 'My Series' });
    expect(getGroupSortValue(group, LibrarySortByType.Title)).toBe('My Series');
  });

  it('should return last-name-first for author group sorted by author', () => {
    const group = createMockGroup({
      name: 'Terry Pratchett',
      books: [createMockBook({ author: 'Terry Pratchett' })],
    });
    expect(getGroupSortValue(group, LibrarySortByType.Author, LibraryGroupByType.Author)).toBe(
      'Pratchett, Terry',
    );
  });

  it('should return book author for series group sorted by author', () => {
    const group = createMockGroup({
      name: 'Discworld',
      books: [
        createMockBook({ author: 'Terry Pratchett', primaryLanguage: 'en' }),
        createMockBook({ author: 'Terry Pratchett', primaryLanguage: 'en' }),
      ],
    });
    expect(getGroupSortValue(group, LibrarySortByType.Author, LibraryGroupByType.Series)).toBe(
      'Pratchett, Terry',
    );
  });

  it('should fallback to group name for author sort without groupBy', () => {
    const group = createMockGroup({ name: 'John Smith' });
    expect(getGroupSortValue(group, LibrarySortByType.Author)).toBe('John Smith');
  });

  it('should return group name for format sort', () => {
    const group = createMockGroup({ name: 'Test Group' });
    expect(getGroupSortValue(group, LibrarySortByType.Format)).toBe('Test Group');
  });

  it('should return max updatedAt for date read sort', () => {
    const group = createMockGroup({
      books: [
        createMockBook({ updatedAt: 1000 }),
        createMockBook({ updatedAt: 3000 }),
        createMockBook({ updatedAt: 2000 }),
      ],
    });

    expect(getGroupSortValue(group, LibrarySortByType.Updated)).toBe(3000);
  });

  it('should return max createdAt for date added sort', () => {
    const group = createMockGroup({
      books: [
        createMockBook({ createdAt: 1000 }),
        createMockBook({ createdAt: 3000 }),
        createMockBook({ createdAt: 2000 }),
      ],
    });

    expect(getGroupSortValue(group, LibrarySortByType.Created)).toBe(3000);
  });

  it('should return max published date for published sort', () => {
    const group = createMockGroup({
      books: [
        createMockBook({ metadata: { published: '2020-01-01' } }),
        createMockBook({ metadata: { published: '2023-06-15' } }),
        createMockBook({ metadata: { published: '2021-12-31' } }),
      ],
    });

    const result = getGroupSortValue(group, LibrarySortByType.Published);
    expect(result).toBe(new Date('2023-06-15').getTime());
  });

  it('should handle missing published dates', () => {
    const group = createMockGroup({
      books: [createMockBook({ metadata: {} }), createMockBook({})],
    });

    expect(getGroupSortValue(group, LibrarySortByType.Published)).toBe(0);
  });

  it('should return group name for series sort', () => {
    const group = createMockGroup({ name: 'My Series' });
    expect(getGroupSortValue(group, LibrarySortByType.Series)).toBe('My Series');
  });

  it('should handle empty groups gracefully', () => {
    const group = createMockGroup({ books: [] });

    // Text-based sorts return group name
    expect(getGroupSortValue(group, LibrarySortByType.Title)).toBe('Test Group');
    // Numeric sorts return 0 for empty groups
    expect(getGroupSortValue(group, LibrarySortByType.Updated)).toBe(0);
  });
});

describe('createGroupSorter', () => {
  const createMockGroup = (overrides: Partial<BooksGroup> = {}): BooksGroup => ({
    id: 'test-group',
    name: 'Test Group',
    displayName: 'Test Group',
    books: [],
    updatedAt: Date.now(),
    ...overrides,
  });

  it('should sort groups alphabetically by name for title sort', () => {
    const groups = [
      createMockGroup({ name: 'Zebra Series' }),
      createMockGroup({ name: 'Apple Series' }),
      createMockGroup({ name: 'Mango Series' }),
    ];

    const sorter = createGroupSorter(LibrarySortByType.Title, 'en');
    const sorted = [...groups].sort(sorter);

    expect(sorted[0]!.name).toBe('Apple Series');
    expect(sorted[1]!.name).toBe('Mango Series');
    expect(sorted[2]!.name).toBe('Zebra Series');
  });

  it('should sort groups by most recent updatedAt for date read sort', () => {
    const groups = [
      createMockGroup({
        name: 'Group A',
        books: [createMockBook({ updatedAt: 1000 })],
      }),
      createMockGroup({
        name: 'Group B',
        books: [createMockBook({ updatedAt: 3000 })],
      }),
      createMockGroup({
        name: 'Group C',
        books: [createMockBook({ updatedAt: 2000 })],
      }),
    ];

    const sorter = createGroupSorter(LibrarySortByType.Updated, 'en');
    const sorted = [...groups].sort(sorter);

    expect(sorted[0]!.name).toBe('Group A');
    expect(sorted[1]!.name).toBe('Group C');
    expect(sorted[2]!.name).toBe('Group B');
  });

  it('should sort groups by most recent createdAt for date added sort', () => {
    const groups = [
      createMockGroup({
        name: 'Group A',
        books: [createMockBook({ createdAt: 3000 })],
      }),
      createMockGroup({
        name: 'Group B',
        books: [createMockBook({ createdAt: 1000 })],
      }),
    ];

    const sorter = createGroupSorter(LibrarySortByType.Created, 'en');
    const sorted = [...groups].sort(sorter);

    expect(sorted[0]!.name).toBe('Group B');
    expect(sorted[1]!.name).toBe('Group A');
  });

  it('should handle groups with single book', () => {
    const groups = [
      createMockGroup({
        name: 'Group A',
        books: [createMockBook({ updatedAt: 1000 })],
      }),
      createMockGroup({
        name: 'Group B',
        books: [createMockBook({ updatedAt: 2000 })],
      }),
    ];

    const sorter = createGroupSorter(LibrarySortByType.Updated, 'en');
    const sorted = [...groups].sort(sorter);

    expect(sorted[0]!.name).toBe('Group A');
    expect(sorted[1]!.name).toBe('Group B');
  });

  it('should sort series groups by book author when sorting by author', () => {
    const groups = [
      createMockGroup({
        name: 'Discworld',
        books: [createMockBook({ author: 'Terry Pratchett', primaryLanguage: 'en' })],
      }),
      createMockGroup({
        name: 'Foundation',
        books: [createMockBook({ author: 'Isaac Asimov', primaryLanguage: 'en' })],
      }),
    ];

    const sorter = createGroupSorter(LibrarySortByType.Author, 'en', LibraryGroupByType.Series);
    const sorted = [...groups].sort(sorter);

    // Asimov < Pratchett (by last name)
    expect(sorted[0]!.name).toBe('Foundation');
    expect(sorted[1]!.name).toBe('Discworld');
  });

  it('should sort author groups by last name when sorting by author', () => {
    const groups = [
      createMockGroup({
        name: 'Terry Pratchett',
        books: [createMockBook({ author: 'Terry Pratchett' })],
      }),
      createMockGroup({
        name: 'Umberto Eco',
        books: [createMockBook({ author: 'Umberto Eco' })],
      }),
      createMockGroup({
        name: 'Isaac Asimov',
        books: [createMockBook({ author: 'Isaac Asimov' })],
      }),
    ];

    const sorter = createGroupSorter(LibrarySortByType.Author, 'en', LibraryGroupByType.Author);
    const sorted = [...groups].sort(sorter);

    // Last names: Asimov, Eco, Pratchett
    expect(sorted[0]!.name).toBe('Isaac Asimov');
    expect(sorted[1]!.name).toBe('Umberto Eco');
    expect(sorted[2]!.name).toBe('Terry Pratchett');
  });
});

describe('createBookSorter', () => {
  it('should sort by title alphabetically', () => {
    const books = [
      createMockBook({ title: 'Zebra' }),
      createMockBook({ title: 'Apple' }),
      createMockBook({ title: 'Mango' }),
    ];

    const sorter = createBookSorter(LibrarySortByType.Title, 'en');
    const sorted = [...books].sort(sorter);

    expect(sorted[0]!.title).toBe('Apple');
    expect(sorted[1]!.title).toBe('Mango');
    expect(sorted[2]!.title).toBe('Zebra');
  });

  it('should sort by updatedAt for date read', () => {
    const books = [
      createMockBook({ title: 'Book A', updatedAt: 2000 }),
      createMockBook({ title: 'Book B', updatedAt: 1000 }),
      createMockBook({ title: 'Book C', updatedAt: 3000 }),
    ];

    const sorter = createBookSorter(LibrarySortByType.Updated, 'en');
    const sorted = [...books].sort(sorter);

    expect(sorted[0]!.title).toBe('Book B');
    expect(sorted[1]!.title).toBe('Book A');
    expect(sorted[2]!.title).toBe('Book C');
  });
});

describe('grouping and sorting integration', () => {
  it('should correctly group by series and sort groups by date read', () => {
    const books = [
      createMockBook({
        hash: '1',
        title: 'Old Series Book',
        metadata: { series: 'Old Series', seriesIndex: 1 },
        updatedAt: 1000,
      }),
      createMockBook({
        hash: '2',
        title: 'New Series Book 1',
        metadata: { series: 'New Series', seriesIndex: 1 },
        updatedAt: 3000,
      }),
      createMockBook({
        hash: '3',
        title: 'New Series Book 2',
        metadata: { series: 'New Series', seriesIndex: 2 },
        updatedAt: 2000,
      }),
    ];

    // Create groups
    const items = createBookGroups(books, LibraryGroupByType.Series);
    const groups = items.filter((item): item is BooksGroup => 'books' in item);

    // Sort groups by updated (descending - most recent first)
    const groupSorter = createGroupSorter(LibrarySortByType.Updated, 'en');
    groups.sort((a, b) => groupSorter(a, b) * -1); // Descending

    expect(groups[0]!.name).toBe('New Series'); // Most recent book at 3000
    expect(groups[1]!.name).toBe('Old Series'); // Most recent book at 1000

    // Sort within groups by seriesIndex
    const withinSorter = createWithinGroupSorter(
      LibraryGroupByType.Series,
      LibrarySortByType.Updated,
      'en',
    );
    groups.forEach((group) => group.books.sort(withinSorter));

    expect(groups[0]!.books[0]!.metadata?.seriesIndex).toBe(1);
    expect(groups[0]!.books[1]!.metadata?.seriesIndex).toBe(2);
  });

  it('should correctly group by author and sort within groups by title', () => {
    const books = [
      createMockBook({ hash: '1', title: 'Zebra', author: 'Author A' }),
      createMockBook({ hash: '2', title: 'Apple', author: 'Author A' }),
      createMockBook({ hash: '3', title: 'Mango', author: 'Author B' }),
    ];

    // Create groups
    const items = createBookGroups(books, LibraryGroupByType.Author);
    const groups = items.filter((item): item is BooksGroup => 'books' in item);

    // Sort groups alphabetically
    const groupSorter = createGroupSorter(LibrarySortByType.Title, 'en');
    groups.sort(groupSorter);

    expect(groups[0]!.name).toBe('Author A');
    expect(groups[1]!.name).toBe('Author B');

    // Sort within groups by title
    const withinSorter = createWithinGroupSorter(
      LibraryGroupByType.Author,
      LibrarySortByType.Title,
      'en',
    );
    groups.forEach((group) => group.books.sort(withinSorter));

    expect(groups[0]!.books[0]!.title).toBe('Apple');
    expect(groups[0]!.books[1]!.title).toBe('Zebra');
  });

  it('should handle ascending/descending sort order', () => {
    const books = [
      createMockBook({
        hash: '1',
        title: 'Series A Book',
        metadata: { series: 'Series A' },
        updatedAt: 1000,
      }),
      createMockBook({
        hash: '2',
        title: 'Series B Book',
        metadata: { series: 'Series B' },
        updatedAt: 2000,
      }),
    ];

    const items = createBookGroups(books, LibraryGroupByType.Series);
    const groups = items.filter((item): item is BooksGroup => 'books' in item);
    const groupSorter = createGroupSorter(LibrarySortByType.Updated, 'en');

    // Ascending (oldest first)
    const ascending = [...groups].sort((a, b) => groupSorter(a, b) * 1);
    expect(ascending[0]!.name).toBe('Series A');

    // Descending (newest first)
    const descending = [...groups].sort((a, b) => groupSorter(a, b) * -1);
    expect(descending[0]!.name).toBe('Series B');
  });
});

describe('ensureLibrarySortByType', () => {
  it('should return valid sort type when value is valid', () => {
    expect(ensureLibrarySortByType('title', LibrarySortByType.Updated)).toBe(
      LibrarySortByType.Title,
    );
    expect(ensureLibrarySortByType('author', LibrarySortByType.Updated)).toBe(
      LibrarySortByType.Author,
    );
    expect(ensureLibrarySortByType('updated', LibrarySortByType.Title)).toBe(
      LibrarySortByType.Updated,
    );
    expect(ensureLibrarySortByType('created', LibrarySortByType.Updated)).toBe(
      LibrarySortByType.Created,
    );
    expect(ensureLibrarySortByType('format', LibrarySortByType.Updated)).toBe(
      LibrarySortByType.Format,
    );
    expect(ensureLibrarySortByType('published', LibrarySortByType.Updated)).toBe(
      LibrarySortByType.Published,
    );
  });

  it('should return fallback when value is null', () => {
    expect(ensureLibrarySortByType(null, LibrarySortByType.Updated)).toBe(
      LibrarySortByType.Updated,
    );
  });

  it('should return fallback when value is undefined', () => {
    expect(ensureLibrarySortByType(undefined, LibrarySortByType.Title)).toBe(
      LibrarySortByType.Title,
    );
  });

  it('should return fallback when value is invalid', () => {
    expect(ensureLibrarySortByType('invalid', LibrarySortByType.Updated)).toBe(
      LibrarySortByType.Updated,
    );
    expect(ensureLibrarySortByType('random', LibrarySortByType.Title)).toBe(
      LibrarySortByType.Title,
    );
  });

  it('should return fallback when value is empty string', () => {
    expect(ensureLibrarySortByType('', LibrarySortByType.Updated)).toBe(LibrarySortByType.Updated);
  });
});

describe('ensureLibraryGroupByType', () => {
  it('should return valid group type when value is valid', () => {
    expect(ensureLibraryGroupByType('none', LibraryGroupByType.Group)).toBe(
      LibraryGroupByType.None,
    );
    expect(ensureLibraryGroupByType('group', LibraryGroupByType.None)).toBe(
      LibraryGroupByType.Group,
    );
    expect(ensureLibraryGroupByType('series', LibraryGroupByType.Group)).toBe(
      LibraryGroupByType.Series,
    );
    expect(ensureLibraryGroupByType('author', LibraryGroupByType.Group)).toBe(
      LibraryGroupByType.Author,
    );
  });

  it('should return fallback when value is null', () => {
    expect(ensureLibraryGroupByType(null, LibraryGroupByType.Group)).toBe(LibraryGroupByType.Group);
  });

  it('should return fallback when value is undefined', () => {
    expect(ensureLibraryGroupByType(undefined, LibraryGroupByType.Series)).toBe(
      LibraryGroupByType.Series,
    );
  });

  it('should return fallback when value is invalid', () => {
    expect(ensureLibraryGroupByType('invalid', LibraryGroupByType.Group)).toBe(
      LibraryGroupByType.Group,
    );
    expect(ensureLibraryGroupByType('random', LibraryGroupByType.Author)).toBe(
      LibraryGroupByType.Author,
    );
  });

  it('should return fallback when value is empty string', () => {
    expect(ensureLibraryGroupByType('', LibraryGroupByType.Group)).toBe(LibraryGroupByType.Group);
  });
});

describe('findGroupById', () => {
  const createMockGroup = (overrides: Partial<BooksGroup> = {}): BooksGroup => ({
    id: 'test-group',
    name: 'Test Group',
    displayName: 'Test Group',
    books: [],
    updatedAt: Date.now(),
    ...overrides,
  });

  it('should find group by id', () => {
    const items: (Book | BooksGroup)[] = [
      createMockBook({ hash: '1' }),
      createMockGroup({ id: 'group-1', name: 'Group 1' }),
      createMockGroup({ id: 'group-2', name: 'Group 2' }),
    ];

    const found = findGroupById(items, 'group-2');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Group 2');
  });

  it('should return undefined when group not found', () => {
    const items: (Book | BooksGroup)[] = [
      createMockBook({ hash: '1' }),
      createMockGroup({ id: 'group-1', name: 'Group 1' }),
    ];

    const found = findGroupById(items, 'non-existent');
    expect(found).toBeUndefined();
  });

  it('should not match books', () => {
    const items: (Book | BooksGroup)[] = [
      createMockBook({ hash: 'group-1' }), // Book with hash matching a group id
      createMockGroup({ id: 'group-2', name: 'Group 2' }),
    ];

    const found = findGroupById(items, 'group-1');
    expect(found).toBeUndefined();
  });
});

describe('getGroupDisplayName', () => {
  const createMockGroup = (overrides: Partial<BooksGroup> = {}): BooksGroup => ({
    id: 'test-group',
    name: 'Test Group',
    displayName: 'Test Display Name',
    books: [],
    updatedAt: Date.now(),
    ...overrides,
  });

  it('should return displayName when available', () => {
    const items: (Book | BooksGroup)[] = [
      createMockGroup({ id: 'group-1', name: 'Name', displayName: 'Display Name' }),
    ];

    expect(getGroupDisplayName(items, 'group-1')).toBe('Display Name');
  });

  it('should return name when displayName is empty', () => {
    const items: (Book | BooksGroup)[] = [
      createMockGroup({ id: 'group-1', name: 'Name', displayName: '' }),
    ];

    expect(getGroupDisplayName(items, 'group-1')).toBe('Name');
  });

  it('should return undefined when group not found', () => {
    const items: (Book | BooksGroup)[] = [createMockGroup({ id: 'group-1', name: 'Name' })];

    expect(getGroupDisplayName(items, 'non-existent')).toBeUndefined();
  });
});

describe('expandBookshelfSelection', () => {
  const createMockGroup = (overrides: Partial<BooksGroup> = {}): BooksGroup => ({
    id: 'test-group',
    name: 'Test Group',
    displayName: 'Test Display Name',
    books: [],
    updatedAt: Date.now(),
    ...overrides,
  });

  it('passes through standalone book hashes unchanged', () => {
    const items: (Book | BooksGroup)[] = [
      createMockBook({ hash: 'book-1' }),
      createMockBook({ hash: 'book-2' }),
    ];

    expect(expandBookshelfSelection(['book-1', 'book-2'], items)).toEqual(['book-1', 'book-2']);
  });

  it('expands a group id into every book hash in the rendered rollup', () => {
    // generateBookshelfItems rolls nested-folder books into the top-level
    // group, so the rendered BooksGroup.books already includes them. The
    // helper must rely on that rollup so deleting "MyDir" also catches
    // books whose own groupName is "MyDir/sub".
    const items: (Book | BooksGroup)[] = [
      createMockGroup({
        id: 'group-mydir',
        name: 'MyDir',
        books: [
          createMockBook({ hash: 'direct-book', groupName: 'MyDir', groupId: 'group-mydir' }),
          createMockBook({ hash: 'nested-book', groupName: 'MyDir/sub', groupId: 'group-sub' }),
        ],
      }),
    ];

    expect(expandBookshelfSelection(['group-mydir'], items).sort()).toEqual([
      'direct-book',
      'nested-book',
    ]);
  });

  it('deduplicates when a book hash and its parent group are both selected', () => {
    const items: (Book | BooksGroup)[] = [
      createMockGroup({
        id: 'group-1',
        books: [createMockBook({ hash: 'book-a' }), createMockBook({ hash: 'book-b' })],
      }),
    ];

    expect(expandBookshelfSelection(['book-a', 'group-1'], items).sort()).toEqual([
      'book-a',
      'book-b',
    ]);
  });

  it('skips soft-deleted books inside a group', () => {
    const items: (Book | BooksGroup)[] = [
      createMockGroup({
        id: 'group-1',
        books: [
          createMockBook({ hash: 'alive' }),
          createMockBook({ hash: 'gone', deletedAt: Date.now() }),
        ],
      }),
    ];

    expect(expandBookshelfSelection(['group-1'], items)).toEqual(['alive']);
  });

  it('returns an empty array when no ids are given', () => {
    expect(expandBookshelfSelection([], [])).toEqual([]);
  });

  it('preserves unknown ids so callers can surface stale selections', () => {
    // Defensive: if the rendered items no longer contain a selected id (e.g.
    // it was a hash from another view), the helper leaves it alone rather
    // than silently dropping it.
    expect(expandBookshelfSelection(['ghost-hash'], [])).toEqual(['ghost-hash']);
  });
});

describe('buildGroupNameUpdatedAt', () => {
  it('takes the max updatedAt across books in each direct group', () => {
    const books = [
      createMockBook({ groupName: 'Fiction', updatedAt: 100 }),
      createMockBook({ groupName: 'Fiction', updatedAt: 300 }),
      createMockBook({ groupName: 'Fiction', updatedAt: 200 }),
      createMockBook({ groupName: 'History', updatedAt: 50 }),
    ];
    const map = buildGroupNameUpdatedAt(books);
    expect(map.get('Fiction')).toBe(300);
    expect(map.get('History')).toBe(50);
  });

  it('propagates a descendant book up to all ancestor groups', () => {
    const books = [
      createMockBook({ groupName: 'Literature/Fiction/Sci-Fi', updatedAt: 500 }),
      createMockBook({ groupName: 'Literature', updatedAt: 100 }),
    ];
    const map = buildGroupNameUpdatedAt(books);
    expect(map.get('Literature/Fiction/Sci-Fi')).toBe(500);
    expect(map.get('Literature/Fiction')).toBe(500);
    expect(map.get('Literature')).toBe(500);
  });

  it('ignores books without groupName or updatedAt', () => {
    const books = [
      createMockBook({ groupName: undefined, updatedAt: 999 }),
      createMockBook({ groupName: 'A', updatedAt: 0 }),
      createMockBook({ groupName: 'A', updatedAt: 42 }),
    ];
    const map = buildGroupNameUpdatedAt(books);
    expect(map.get('A')).toBe(42);
    expect(map.size).toBe(1);
  });

  it('produces a desc-sort by group freshness when used as the sort key', () => {
    const books = [
      createMockBook({ groupName: 'Old', updatedAt: 1 }),
      createMockBook({ groupName: 'Newer', updatedAt: 10 }),
      createMockBook({ groupName: 'Newest', updatedAt: 100 }),
    ];
    const map = buildGroupNameUpdatedAt(books);
    const groups = [{ name: 'Old' }, { name: 'Newest' }, { name: 'Newer' }];
    groups.sort((a, b) => (map.get(b.name) ?? 0) - (map.get(a.name) ?? 0));
    expect(groups.map((g) => g.name)).toEqual(['Newest', 'Newer', 'Old']);
  });
});

describe('secondary sort - createBookSorter tiebreaker', () => {
  it('uses secondary key as tiebreaker when primary keys are equal', () => {
    const books = [
      createMockBook({ hash: 'a', title: 'Zebra', author: 'Same Author' }),
      createMockBook({ hash: 'b', title: 'Apple', author: 'Same Author' }),
    ];
    const sorter = createBookSorter(LibrarySortByType.Author, 'en', LibrarySortByType.Title);
    const sorted = [...books].sort(sorter);
    expect(sorted[0]!.title).toBe('Apple');
    expect(sorted[1]!.title).toBe('Zebra');
  });

  it('falls back to default when primary differs (secondary not used)', () => {
    const books = [
      createMockBook({ hash: 'a', title: 'Zebra', author: 'B Author' }),
      createMockBook({ hash: 'b', title: 'Apple', author: 'A Author' }),
    ];
    const sorter = createBookSorter(LibrarySortByType.Author, 'en', LibrarySortByType.Title);
    const sorted = [...books].sort(sorter);
    expect(sorted[0]!.author).toBe('A Author');
    expect(sorted[1]!.author).toBe('B Author');
  });

  it('ignores secondary when set to none', () => {
    const books = [
      createMockBook({ hash: 'a', title: 'Zebra', author: 'Same' }),
      createMockBook({ hash: 'b', title: 'Apple', author: 'Same' }),
    ];
    const sorter = createBookSorter(LibrarySortByType.Author, 'en', 'none');
    const sorted = [...books].sort(sorter);
    // Stable: both equal, original order preserved
    expect(sorted[0]!.hash).toBe('a');
    expect(sorted[1]!.hash).toBe('b');
  });
});

describe('secondary sort - createWithinGroupSorter (drilled-in group)', () => {
  it('inside an author group, sorts by series index when secondary is series', () => {
    const books = [
      createMockBook({
        hash: '1',
        title: 'Zebra Book',
        metadata: { series: 'Series A', seriesIndex: 3 },
      }),
      createMockBook({
        hash: '2',
        title: 'Apple Book',
        metadata: { series: 'Series A', seriesIndex: 1 },
      }),
      createMockBook({
        hash: '3',
        title: 'Mango Book',
        metadata: { series: 'Series A', seriesIndex: 2 },
      }),
    ];
    const sorter = createWithinGroupSorter(
      LibraryGroupByType.Author,
      LibrarySortByType.Title,
      'en',
      true,
      LibrarySortByType.Series,
    );
    const sorted = [...books].sort(sorter);
    expect(sorted.map((b) => b.metadata?.seriesIndex)).toEqual([1, 2, 3]);
  });

  it('keeps each series together (in series order) when an author has multiple series', () => {
    const books = [
      createMockBook({
        hash: 'b1',
        title: 'B One',
        metadata: { series: 'Series B', seriesIndex: 1 },
      }),
      createMockBook({
        hash: 'a2',
        title: 'A Two',
        metadata: { series: 'Series A', seriesIndex: 2 },
      }),
      createMockBook({
        hash: 'a1',
        title: 'A One',
        metadata: { series: 'Series A', seriesIndex: 1 },
      }),
      createMockBook({
        hash: 'b2',
        title: 'B Two',
        metadata: { series: 'Series B', seriesIndex: 2 },
      }),
    ];
    const sorter = createWithinGroupSorter(
      LibraryGroupByType.Author,
      LibrarySortByType.Title,
      'en',
      true,
      LibrarySortByType.Series,
    );
    const sorted = [...books].sort(sorter);
    // All of Series A consecutively in index order, then all of Series B —
    // not interleaved by index across series (#1s together, #2s together).
    expect(sorted.map((b) => `${b.metadata?.series} #${b.metadata?.seriesIndex}`)).toEqual([
      'Series A #1',
      'Series A #2',
      'Series B #1',
      'Series B #2',
    ]);
  });

  it('falls back to primary when secondary ties (same series index)', () => {
    const books = [
      createMockBook({
        hash: '1',
        title: 'Zebra',
        metadata: { seriesIndex: 1 },
      }),
      createMockBook({
        hash: '2',
        title: 'Apple',
        metadata: { seriesIndex: 1 },
      }),
    ];
    const sorter = createWithinGroupSorter(
      LibraryGroupByType.Author,
      LibrarySortByType.Title,
      'en',
      true,
      LibrarySortByType.Series,
    );
    const sorted = [...books].sort(sorter);
    expect(sorted[0]!.title).toBe('Apple');
    expect(sorted[1]!.title).toBe('Zebra');
  });

  it('without secondary, keeps existing primary behavior in author group', () => {
    const books = [
      createMockBook({ hash: '1', title: 'Zebra' }),
      createMockBook({ hash: '2', title: 'Apple' }),
    ];
    const sorter = createWithinGroupSorter(
      LibraryGroupByType.Author,
      LibrarySortByType.Title,
      'en',
      true,
      'none',
    );
    const sorted = [...books].sort(sorter);
    expect(sorted[0]!.title).toBe('Apple');
    expect(sorted[1]!.title).toBe('Zebra');
  });
});

describe('resolveEffectiveSecondarySort smart defaults', () => {
  it('returns explicit secondary when not none', () => {
    expect(resolveEffectiveSecondarySort(LibrarySortByType.Title, LibraryGroupByType.Author)).toBe(
      LibrarySortByType.Title,
    );
  });

  it('defaults to series when groupBy=Author and stored=none', () => {
    expect(resolveEffectiveSecondarySort('none', LibraryGroupByType.Author)).toBe(
      LibrarySortByType.Series,
    );
  });

  it('stays none for groupBy=Series (series-index handles ordering)', () => {
    expect(resolveEffectiveSecondarySort('none', LibraryGroupByType.Series)).toBe('none');
  });

  it('stays none for groupBy=None/Group', () => {
    expect(resolveEffectiveSecondarySort('none', LibraryGroupByType.None)).toBe('none');
    expect(resolveEffectiveSecondarySort('none', LibraryGroupByType.Group)).toBe('none');
  });
});

describe('resolveEffectivePrimarySort smart defaults', () => {
  it('returns stored when isAuto=false, regardless of groupBy', () => {
    expect(
      resolveEffectivePrimarySort(LibrarySortByType.Updated, LibraryGroupByType.Series, false),
    ).toBe(LibrarySortByType.Updated);
    expect(
      resolveEffectivePrimarySort(LibrarySortByType.Title, LibraryGroupByType.Author, false),
    ).toBe(LibrarySortByType.Title);
  });

  it('defaults to Series when isAuto=true and groupBy=Series', () => {
    expect(
      resolveEffectivePrimarySort(LibrarySortByType.Updated, LibraryGroupByType.Series, true),
    ).toBe(LibrarySortByType.Series);
  });

  it('returns stored for non-series groupBy when isAuto=true', () => {
    expect(
      resolveEffectivePrimarySort(LibrarySortByType.Updated, LibraryGroupByType.Author, true),
    ).toBe(LibrarySortByType.Updated);
    expect(
      resolveEffectivePrimarySort(LibrarySortByType.Updated, LibraryGroupByType.Group, true),
    ).toBe(LibrarySortByType.Updated);
    expect(
      resolveEffectivePrimarySort(LibrarySortByType.Updated, LibraryGroupByType.None, true),
    ).toBe(LibrarySortByType.Updated);
  });
});

describe('ensureLibrarySecondarySortByType', () => {
  it('accepts none', () => {
    expect(ensureLibrarySecondarySortByType('none', 'none')).toBe('none');
  });
  it('accepts any valid LibrarySortByType', () => {
    expect(ensureLibrarySecondarySortByType('series', 'none')).toBe(LibrarySortByType.Series);
  });
  it('falls back when invalid', () => {
    expect(ensureLibrarySecondarySortByType('bogus', LibrarySortByType.Title)).toBe(
      LibrarySortByType.Title,
    );
    expect(ensureLibrarySecondarySortByType(null, 'none')).toBe('none');
  });
});
