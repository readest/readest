import { describe, it, expect } from 'vitest';
import {
  parseAuthors,
  createBookGroups,
  createWithinGroupSorter,
  createGroupSorter,
  getGroupSortValue,
  createBookSorter,
  ensureLibrarySortByType,
  ensureLibraryGroupByType,
  findGroupById,
  getGroupDisplayName,
} from '../../app/library/utils/libraryUtils';
import { Book, BooksGroup } from '../../types/book';

// Helper to create mock books with minimal required fields
const createMockBook = (overrides: Partial<Book> = {}): Book => ({
  hash: `hash-${Math.random().toString(36).substr(2, 9)}`,
  format: 'EPUB',
  title: 'Test Book',
  author: 'Test Author',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
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

      const result = createBookGroups(books, 'none');

      expect(result).toHaveLength(2);
      expect(result.every((item) => 'format' in item)).toBe(true);
    });

    it('should filter out deleted books', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1' }),
        createMockBook({ hash: '2', title: 'Book 2', deletedAt: Date.now() }),
      ];

      const result = createBookGroups(books, 'none');

      expect(result).toHaveLength(1);
    });
  });

  describe('groupBy: series', () => {
    it('should group books by series name', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1', metadata: { series: 'Series A' } as any }),
        createMockBook({ hash: '2', title: 'Book 2', metadata: { series: 'Series A' } as any }),
        createMockBook({ hash: '3', title: 'Book 3', metadata: { series: 'Series B' } as any }),
      ];

      const result = createBookGroups(books, 'series');

      const groups = result.filter((item): item is BooksGroup => 'books' in item);
      expect(groups).toHaveLength(2);

      const seriesA = groups.find((g) => g.name === 'Series A');
      expect(seriesA?.books).toHaveLength(2);

      const seriesB = groups.find((g) => g.name === 'Series B');
      expect(seriesB?.books).toHaveLength(1);
    });

    it('should leave books without series as ungrouped items', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1', metadata: { series: 'Series A' } as any }),
        createMockBook({ hash: '2', title: 'Book 2' }), // No series
        createMockBook({ hash: '3', title: 'Book 3', metadata: {} as any }), // Empty metadata
      ];

      const result = createBookGroups(books, 'series');

      const groups = result.filter((item): item is BooksGroup => 'books' in item);
      const ungrouped = result.filter((item): item is Book => 'format' in item);

      expect(groups).toHaveLength(1);
      expect(ungrouped).toHaveLength(2);
    });

    it('should handle empty series string as ungrouped', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1', metadata: { series: '' } as any }),
        createMockBook({ hash: '2', title: 'Book 2', metadata: { series: '  ' } as any }),
      ];

      const result = createBookGroups(books, 'series');

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
          metadata: { series: 'Series A' } as any,
          updatedAt: 1000,
        }),
        createMockBook({
          hash: '2',
          title: 'Book 2',
          metadata: { series: 'Series A' } as any,
          updatedAt: 2000,
        }),
      ];

      const result = createBookGroups(books, 'series');
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

      const result = createBookGroups(books, 'author');

      const groups = result.filter((item): item is BooksGroup => 'books' in item);
      expect(groups).toHaveLength(2);

      const authorA = groups.find((g) => g.name === 'Author A');
      expect(authorA?.books).toHaveLength(2);
    });

    it('should place book in multiple groups for multiple authors', () => {
      const books = [createMockBook({ hash: '1', title: 'Book 1', author: 'John Smith, Jane Doe' })];

      const result = createBookGroups(books, 'author');

      const groups = result.filter((item): item is BooksGroup => 'books' in item);
      expect(groups).toHaveLength(2);

      const john = groups.find((g) => g.name === 'John Smith');
      const jane = groups.find((g) => g.name === 'Jane Doe');

      expect(john?.books).toHaveLength(1);
      expect(jane?.books).toHaveLength(1);
      expect(john?.books[0]!.hash).toBe(jane?.books[0]!.hash);
    });

    it('should leave books without author as ungrouped', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1', author: 'Author A' }),
        createMockBook({ hash: '2', title: 'Book 2', author: '' }),
        createMockBook({ hash: '3', title: 'Book 3', author: '   ' }),
      ];

      const result = createBookGroups(books, 'author');

      const groups = result.filter((item): item is BooksGroup => 'books' in item);
      const ungrouped = result.filter((item): item is Book => 'format' in item);

      expect(groups).toHaveLength(1);
      expect(ungrouped).toHaveLength(2);
    });
  });

  describe('groupBy: manual', () => {
    it('should return books as-is (manual mode handled elsewhere)', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1' }),
        createMockBook({ hash: '2', title: 'Book 2' }),
      ];

      const result = createBookGroups(books, 'manual');

      // Manual mode just returns filtered books - actual grouping is in generateBookshelfItems
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
          metadata: { seriesIndex: 3 } as any,
        }),
        createMockBook({
          hash: '2',
          title: 'Book 1',
          metadata: { seriesIndex: 1 } as any,
        }),
        createMockBook({
          hash: '3',
          title: 'Book 2',
          metadata: { seriesIndex: 2 } as any,
        }),
      ];

      const sorter = createWithinGroupSorter('series', 'title', 'en');
      const sorted = [...books].sort(sorter);

      expect(sorted[0]!.metadata?.seriesIndex).toBe(1);
      expect(sorted[1]!.metadata?.seriesIndex).toBe(2);
      expect(sorted[2]!.metadata?.seriesIndex).toBe(3);
    });

    it('should place books without seriesIndex after those with index', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book A', metadata: {} as any }),
        createMockBook({ hash: '2', title: 'Book B', metadata: { seriesIndex: 1 } as any }),
      ];

      const sorter = createWithinGroupSorter('series', 'title', 'en');
      const sorted = [...books].sort(sorter);

      expect(sorted[0]!.hash).toBe('2'); // Has index
      expect(sorted[1]!.hash).toBe('1'); // No index
    });

    it('should sort books without seriesIndex by global sort criteria', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Zebra', metadata: {} as any }),
        createMockBook({ hash: '2', title: 'Apple', metadata: {} as any }),
      ];

      const sorter = createWithinGroupSorter('series', 'title', 'en');
      const sorted = [...books].sort(sorter);

      expect(sorted[0]!.title).toBe('Apple');
      expect(sorted[1]!.title).toBe('Zebra');
    });

    it('should handle decimal seriesIndex values', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 2', metadata: { seriesIndex: 2 } as any }),
        createMockBook({ hash: '2', title: 'Book 1.5', metadata: { seriesIndex: 1.5 } as any }),
        createMockBook({ hash: '3', title: 'Book 1', metadata: { seriesIndex: 1 } as any }),
      ];

      const sorter = createWithinGroupSorter('series', 'title', 'en');
      const sorted = [...books].sort(sorter);

      expect(sorted[0]!.metadata?.seriesIndex).toBe(1);
      expect(sorted[1]!.metadata?.seriesIndex).toBe(1.5);
      expect(sorted[2]!.metadata?.seriesIndex).toBe(2);
    });
  });

  describe('author grouping', () => {
    it('should sort by global sort criteria (title)', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Zebra' }),
        createMockBook({ hash: '2', title: 'Apple' }),
      ];

      const sorter = createWithinGroupSorter('author', 'title', 'en');
      const sorted = [...books].sort(sorter);

      expect(sorted[0]!.title).toBe('Apple');
      expect(sorted[1]!.title).toBe('Zebra');
    });

    it('should sort by global sort criteria (updated)', () => {
      const books = [
        createMockBook({ hash: '1', title: 'Book 1', updatedAt: 2000 }),
        createMockBook({ hash: '2', title: 'Book 2', updatedAt: 1000 }),
      ];

      const sorter = createWithinGroupSorter('author', 'updated', 'en');
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
    expect(getGroupSortValue(group, 'title')).toBe('My Series');
  });

  it('should return group name for author sort', () => {
    const group = createMockGroup({ name: 'John Smith' });
    expect(getGroupSortValue(group, 'author')).toBe('John Smith');
  });

  it('should return group name for format sort', () => {
    const group = createMockGroup({ name: 'Test Group' });
    expect(getGroupSortValue(group, 'format')).toBe('Test Group');
  });

  it('should return max updatedAt for date read sort', () => {
    const group = createMockGroup({
      books: [
        createMockBook({ updatedAt: 1000 }),
        createMockBook({ updatedAt: 3000 }),
        createMockBook({ updatedAt: 2000 }),
      ],
    });

    expect(getGroupSortValue(group, 'updated')).toBe(3000);
  });

  it('should return max createdAt for date added sort', () => {
    const group = createMockGroup({
      books: [
        createMockBook({ createdAt: 1000 }),
        createMockBook({ createdAt: 3000 }),
        createMockBook({ createdAt: 2000 }),
      ],
    });

    expect(getGroupSortValue(group, 'created')).toBe(3000);
  });

  it('should return max published date for published sort', () => {
    const group = createMockGroup({
      books: [
        createMockBook({ metadata: { published: '2020-01-01' } as any }),
        createMockBook({ metadata: { published: '2023-06-15' } as any }),
        createMockBook({ metadata: { published: '2021-12-31' } as any }),
      ],
    });

    const result = getGroupSortValue(group, 'published');
    expect(result).toBe(new Date('2023-06-15').getTime());
  });

  it('should handle missing published dates', () => {
    const group = createMockGroup({
      books: [createMockBook({ metadata: {} as any }), createMockBook({})],
    });

    expect(getGroupSortValue(group, 'published')).toBe(0);
  });

  it('should handle empty groups gracefully', () => {
    const group = createMockGroup({ books: [] });

    // Text-based sorts return group name
    expect(getGroupSortValue(group, 'title')).toBe('Test Group');
    // Numeric sorts return 0 for empty groups
    expect(getGroupSortValue(group, 'updated')).toBe(0);
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

    const sorter = createGroupSorter('title', 'en');
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

    const sorter = createGroupSorter('updated', 'en');
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

    const sorter = createGroupSorter('created', 'en');
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

    const sorter = createGroupSorter('updated', 'en');
    const sorted = [...groups].sort(sorter);

    expect(sorted[0]!.name).toBe('Group A');
    expect(sorted[1]!.name).toBe('Group B');
  });
});

describe('createBookSorter', () => {
  it('should sort by title alphabetically', () => {
    const books = [
      createMockBook({ title: 'Zebra' }),
      createMockBook({ title: 'Apple' }),
      createMockBook({ title: 'Mango' }),
    ];

    const sorter = createBookSorter('title', 'en');
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

    const sorter = createBookSorter('updated', 'en');
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
        metadata: { series: 'Old Series', seriesIndex: 1 } as any,
        updatedAt: 1000,
      }),
      createMockBook({
        hash: '2',
        title: 'New Series Book 1',
        metadata: { series: 'New Series', seriesIndex: 1 } as any,
        updatedAt: 3000,
      }),
      createMockBook({
        hash: '3',
        title: 'New Series Book 2',
        metadata: { series: 'New Series', seriesIndex: 2 } as any,
        updatedAt: 2000,
      }),
    ];

    // Create groups
    const items = createBookGroups(books, 'series');
    const groups = items.filter((item): item is BooksGroup => 'books' in item);

    // Sort groups by updated (descending - most recent first)
    const groupSorter = createGroupSorter('updated', 'en');
    groups.sort((a, b) => groupSorter(a, b) * -1); // Descending

    expect(groups[0]!.name).toBe('New Series'); // Most recent book at 3000
    expect(groups[1]!.name).toBe('Old Series'); // Most recent book at 1000

    // Sort within groups by seriesIndex
    const withinSorter = createWithinGroupSorter('series', 'updated', 'en');
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
    const items = createBookGroups(books, 'author');
    const groups = items.filter((item): item is BooksGroup => 'books' in item);

    // Sort groups alphabetically
    const groupSorter = createGroupSorter('title', 'en');
    groups.sort(groupSorter);

    expect(groups[0]!.name).toBe('Author A');
    expect(groups[1]!.name).toBe('Author B');

    // Sort within groups by title
    const withinSorter = createWithinGroupSorter('author', 'title', 'en');
    groups.forEach((group) => group.books.sort(withinSorter));

    expect(groups[0]!.books[0]!.title).toBe('Apple');
    expect(groups[0]!.books[1]!.title).toBe('Zebra');
  });

  it('should handle ascending/descending sort order', () => {
    const books = [
      createMockBook({
        hash: '1',
        title: 'Series A Book',
        metadata: { series: 'Series A' } as any,
        updatedAt: 1000,
      }),
      createMockBook({
        hash: '2',
        title: 'Series B Book',
        metadata: { series: 'Series B' } as any,
        updatedAt: 2000,
      }),
    ];

    const items = createBookGroups(books, 'series');
    const groups = items.filter((item): item is BooksGroup => 'books' in item);
    const groupSorter = createGroupSorter('updated', 'en');

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
    expect(ensureLibrarySortByType('title', 'updated')).toBe('title');
    expect(ensureLibrarySortByType('author', 'updated')).toBe('author');
    expect(ensureLibrarySortByType('updated', 'title')).toBe('updated');
    expect(ensureLibrarySortByType('created', 'updated')).toBe('created');
    expect(ensureLibrarySortByType('format', 'updated')).toBe('format');
    expect(ensureLibrarySortByType('published', 'updated')).toBe('published');
  });

  it('should return fallback when value is null', () => {
    expect(ensureLibrarySortByType(null, 'updated')).toBe('updated');
  });

  it('should return fallback when value is undefined', () => {
    expect(ensureLibrarySortByType(undefined, 'title')).toBe('title');
  });

  it('should return fallback when value is invalid', () => {
    expect(ensureLibrarySortByType('invalid', 'updated')).toBe('updated');
    expect(ensureLibrarySortByType('random', 'title')).toBe('title');
  });

  it('should return fallback when value is empty string', () => {
    expect(ensureLibrarySortByType('', 'updated')).toBe('updated');
  });
});

describe('ensureLibraryGroupByType', () => {
  it('should return valid group type when value is valid', () => {
    expect(ensureLibraryGroupByType('none', 'manual')).toBe('none');
    expect(ensureLibraryGroupByType('manual', 'none')).toBe('manual');
    expect(ensureLibraryGroupByType('series', 'manual')).toBe('series');
    expect(ensureLibraryGroupByType('author', 'manual')).toBe('author');
  });

  it('should return fallback when value is null', () => {
    expect(ensureLibraryGroupByType(null, 'manual')).toBe('manual');
  });

  it('should return fallback when value is undefined', () => {
    expect(ensureLibraryGroupByType(undefined, 'series')).toBe('series');
  });

  it('should return fallback when value is invalid', () => {
    expect(ensureLibraryGroupByType('invalid', 'manual')).toBe('manual');
    expect(ensureLibraryGroupByType('random', 'author')).toBe('author');
  });

  it('should return fallback when value is empty string', () => {
    expect(ensureLibraryGroupByType('', 'manual')).toBe('manual');
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
    const items: (Book | BooksGroup)[] = [
      createMockGroup({ id: 'group-1', name: 'Name' }),
    ];

    expect(getGroupDisplayName(items, 'non-existent')).toBeUndefined();
  });
});
