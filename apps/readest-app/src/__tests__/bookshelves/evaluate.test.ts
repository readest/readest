import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import {
  createBookshelf,
  defaultBookshelves,
  bookshelfSchema,
  bookshelfName,
} from '@/services/bookshelves/definitions';
import { evaluateBookshelves, matchBookshelfFilter } from '@/services/bookshelves/evaluate';

const book = (hash: string, tags: string[] = []): Book => ({
  hash,
  tags,
  title: hash,
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
});
const filter = {
  type: 'group' as const,
  match: 'all' as const,
  children: [
    {
      type: 'rule' as const,
      field: 'tags',
      kind: 'collection' as const,
      operator: 'contains' as const,
      value: 'fiction',
    },
  ],
};
const shelf = (name: string) => createBookshelf(name);

describe('bookshelf evaluation', () => {
  it('provides exclusive Audiobooks and Podcasts carousels before Default', () => {
    const defaults = defaultBookshelves({});
    expect(defaults.map((s) => s.id)).toEqual([
      'recent',
      'audiobooks',
      'podcasts',
      'default',
      'finished',
    ]);
    for (const id of ['audiobooks', 'podcasts']) {
      expect(defaults.find((s) => s.id === id)).toMatchObject({
        enabled: true,
        layout: 'carousel',
        exclusive: true,
        includeExclusiveBooks: false,
        hideCovers: false,
        coverFit: 'crop',
        useGlobalGrouping: true,
        useGlobalSort: true,
      });
    }
    const results = evaluateBookshelves(
      [
        { ...book('audio'), format: 'ABS' },
        { ...book('podcast'), format: 'ABS', absMediaType: 'podcast' },
        book('ebook'),
      ],
      defaults,
    );
    expect(results.find((s) => s.definition.id === 'audiobooks')?.books.map((b) => b.hash)).toEqual(
      ['audio'],
    );
    expect(results.find((s) => s.definition.id === 'podcasts')?.books.map((b) => b.hash)).toEqual([
      'podcast',
    ]);
    expect(results.find((s) => s.definition.id === 'default')?.books.map((b) => b.hash)).toEqual([
      'ebook',
    ]);
  });
  it('gives exclusive Finished books priority over other exclusive shelves regardless of order or name', () => {
    const finished = {
      ...defaultBookshelves({}).find((s) => s.id === 'finished')!,
      name: 'Completed',
      enabled: true,
      exclusive: true,
    };
    const audio = {
      ...shelf('Audio'),
      exclusive: true,
      filters: {
        type: 'group' as const,
        match: 'all' as const,
        children: [
          {
            type: 'rule' as const,
            field: 'audio',
            kind: 'boolean' as const,
            operator: 'equals' as const,
            value: true,
          },
        ],
      },
    };
    const ordinary = shelf('Ordinary');
    const inclusive = { ...shelf('Inclusive'), includeExclusiveBooks: true };
    const books: Book[] = [
      { ...book('finished-audio'), format: 'ABS', readingStatus: 'finished' },
      { ...book('finished-ebook'), readingStatus: 'finished' },
      { ...book('reading-audio'), format: 'ABS', readingStatus: 'reading' },
      { ...book('reading-ebook'), readingStatus: 'reading' },
    ];
    for (const definitions of [
      [audio, ordinary, inclusive, finished],
      [finished, audio, ordinary, inclusive],
    ]) {
      const results = evaluateBookshelves(books, definitions);
      expect(results.find((s) => s.definition.id === audio.id)!.books.map((b) => b.hash)).toEqual([
        'reading-audio',
      ]);
      expect(
        results.find((s) => s.definition.id === ordinary.id)!.books.map((b) => b.hash),
      ).toEqual(['reading-ebook']);
      expect(results.find((s) => s.definition.id === inclusive.id)!.books).toHaveLength(4);
      expect(
        results.find((s) => s.definition.id === finished.id)!.books.map((b) => b.hash),
      ).toEqual(['finished-audio', 'finished-ebook']);
    }
    for (const inactive of [
      { ...finished, enabled: false },
      { ...finished, exclusive: false },
    ]) {
      expect(evaluateBookshelves(books, [audio, inactive])[0]!.books.map((b) => b.hash)).toEqual([
        'finished-audio',
        'reading-audio',
      ]);
    }
  });
  it('excludes Finished books from ordinary shelves regardless of order unless inclusion is enabled', () => {
    const finished = {
      ...defaultBookshelves({}).find((s) => s.id === 'finished')!,
      enabled: true,
      exclusive: true,
    };
    const ordinary = shelf('Ordinary');
    const inclusive = { ...shelf('Inclusive'), includeExclusiveBooks: true };
    const books: Book[] = [
      { ...book('finished-audio'), format: 'ABS', readingStatus: 'finished' },
      { ...book('finished-ebook'), readingStatus: 'finished' },
      { ...book('reading-audio'), format: 'ABS', readingStatus: 'reading' },
    ];
    for (const definitions of [
      [ordinary, inclusive, finished],
      [finished, inclusive, ordinary],
    ]) {
      const results = evaluateBookshelves(books, definitions);
      expect(
        results.find((s) => s.definition.id === ordinary.id)!.books.map((b) => b.hash),
      ).toEqual(['reading-audio']);
      expect(results.find((s) => s.definition.id === inclusive.id)!.books).toHaveLength(3);
      expect(
        results.find((s) => s.definition.id === finished.id)!.books.map((b) => b.hash),
      ).toEqual(['finished-audio', 'finished-ebook']);
    }
  });
  it('includes exclusive books in Recently read by default without changing ownership', () => {
    const defaults = defaultBookshelves({});
    const owner = { ...shelf('Exclusive'), filters: filter, exclusive: true };
    const books: Book[] = [
      { ...book('exclusive', ['fiction']), progress: [1, 100] },
      { ...book('ordinary'), progress: [1, 100] },
      book('unread'),
    ];
    for (const definitions of [
      [owner, ...defaults],
      [...defaults, owner],
    ]) {
      const results = evaluateBookshelves(books, definitions);
      expect(
        results
          .find((s) => s.definition.id === 'recent')!
          .books.map((b) => b.hash)
          .sort(),
      ).toEqual(['exclusive', 'ordinary']);
      expect(results.find((s) => s.definition.id === owner.id)!.books.map((b) => b.hash)).toEqual([
        'exclusive',
      ]);
      expect(
        results.find((s) => s.definition.id === 'default')!.books.map((b) => b.hash),
      ).not.toContain('exclusive');
    }
    const optedOut = defaults.map((s) =>
      s.id === 'recent' ? { ...s, includeExclusiveBooks: false } : s,
    );
    expect(
      evaluateBookshelves(books, [owner, ...optedOut])
        .find((s) => s.definition.id === 'recent')!
        .books.map((b) => b.hash),
    ).toEqual(['ordinary']);
  });
  it('provides a disabled Finished books carousel after Default that matches only finished books', () => {
    const defaults = defaultBookshelves({});
    expect(defaults.map((s) => s.id)).toEqual([
      'recent',
      'audiobooks',
      'podcasts',
      'default',
      'finished',
    ]);
    const finished = defaults.find((s) => s.id === 'finished')!;
    expect(finished).toMatchObject({ enabled: false, layout: 'carousel' });
    expect(bookshelfName(finished)).toBe('Finished books');
    expect(bookshelfSchema.safeParse(finished).success).toBe(true);
    const books: Book[] = [
      { ...book('older'), readingStatus: 'finished', updatedAt: 1 },
      { ...book('reading'), readingStatus: 'reading', progress: [50, 100] },
      { ...book('newer'), readingStatus: 'finished', updatedAt: 2 },
      { ...book('on-hold'), readingStatus: 'abandoned' },
      book('unread'),
    ];
    expect(evaluateBookshelves(books, defaults).some((s) => s.definition.id === 'finished')).toBe(
      false,
    );
    expect(
      evaluateBookshelves(books, [{ ...finished, enabled: true }])[0]!.books.map((b) => b.hash),
    ).toEqual(['newer', 'older']);
    const enabledResults = evaluateBookshelves(
      books,
      defaults.map((s) => (s.id === 'finished' ? { ...s, enabled: true } : s)),
    );
    expect(
      enabledResults.find((s) => s.definition.id === 'default')!.books.map((b) => b.hash),
    ).toEqual(['on-hold', 'reading', 'unread']);
    expect(
      enabledResults.find((s) => s.definition.id === 'finished')!.books.map((b) => b.hash),
    ).toEqual(['newer', 'older']);
  });
  it('classifies an ABS podcast known only from its metadata mirror as a podcast', () => {
    const podcast: Book = {
      ...book('show'),
      format: 'ABS',
      metadata: { title: 'Show', author: 'Host', language: 'en', absMediaType: 'podcast' },
    };
    const results = evaluateBookshelves([podcast], defaultBookshelves({}));
    expect(results.find((s) => s.definition.id === 'podcasts')!.books.map((b) => b.hash)).toEqual([
      'show',
    ]);
    expect(results.find((s) => s.definition.id === 'audiobooks')!.books).toEqual([]);
  });
  it('uses the moved Default bookshelf position for exclusive ownership', () => {
    const main = {
      ...defaultBookshelves({}).find((s) => s.id === 'default')!,
      filters: filter,
      exclusive: true,
    };
    const other = { ...shelf('other'), filters: filter, exclusive: true };
    const books = [book('a', ['fiction'])];
    const first = evaluateBookshelves(books, [main, other]);
    expect(first.map((s) => s.definition.id)).toEqual(['default', other.id]);
    expect(first.map((s) => s.books.length)).toEqual([1, 0]);
    expect(evaluateBookshelves(books, [other, main]).map((s) => s.books.length)).toEqual([1, 0]);
  });
  it('includes all carousel matches and resolves exclusive ownership in order', () => {
    const books = Array.from({ length: 20 }, (_, i) => book(`${i}`, ['fiction']));
    const first = { ...shelf('first'), filters: filter, exclusive: true };
    const second = { ...shelf('second'), filters: filter, exclusive: true };
    const results = evaluateBookshelves(books, [first, second, shelf('ordinary')]);
    expect(results.map((s) => [s.books.length, s.matching, s.excluded])).toEqual([
      [20, 20, 0],
      [0, 20, 20],
      [0, 20, 20],
    ]);
    expect(evaluateBookshelves(books, [second, first])[0]!.books).toHaveLength(20);
  });
  it('disabled owners claim nothing, inclusion overrides exclusions, and grid/list have no limit', () => {
    const books = Array.from({ length: 30 }, (_, i) => book(`${i}`, ['fiction']));
    const owner = { ...shelf('owner'), filters: filter, exclusive: true };
    expect(
      evaluateBookshelves(books, [
        { ...owner, enabled: false },
        { ...shelf('grid'), layout: 'grid' },
      ])[0]!.books,
    ).toHaveLength(30);
    expect(
      evaluateBookshelves(books, [
        owner,
        { ...shelf('list'), layout: 'list', includeExclusiveBooks: true },
      ])[1]!.books,
    ).toHaveLength(30);
  });
  it('rejects empty exclusivity, incomplete conditions, wrong field types and empty nested groups', () => {
    expect(bookshelfSchema.safeParse({ ...shelf('bad'), exclusive: true }).success).toBe(false);
    expect(
      bookshelfSchema.safeParse({
        ...shelf('bad'),
        filters: { ...filter, children: [{ ...filter.children[0], value: '' }] },
      }).success,
    ).toBe(false);
    expect(
      bookshelfSchema.safeParse({
        ...shelf('bad'),
        filters: { ...filter, children: [{ type: 'group', match: 'any', children: [] }] },
      }).success,
    ).toBe(false);
    expect(
      bookshelfSchema.safeParse({
        ...shelf('bad'),
        filters: { ...filter, children: [{ ...filter.children[0], kind: 'number' }] },
      }).success,
    ).toBe(false);
    expect(
      evaluateBookshelves([book('one')], [{ ...shelf('bad'), exclusive: true }, shelf('good')])[1]!
        .books,
    ).toHaveLength(1);
  });
  it('keeps unavailable Calibre columns, handles nested groups and missing values', () => {
    const rule = {
      type: 'rule' as const,
      field: 'calibre:#rating',
      kind: 'number' as const,
      operator: 'gt' as const,
      value: 3,
    };
    const nested = {
      ...filter,
      children: [
        { type: 'group' as const, match: 'any' as const, children: [rule, ...filter.children] },
      ],
    };
    expect(bookshelfSchema.safeParse({ ...shelf('custom'), filters: nested }).success).toBe(true);
    expect(matchBookshelfFilter(book('a'), nested)).toBe(false);
    expect(matchBookshelfFilter(book('b', ['fiction']), nested)).toBe(true);
  });
  it('uses independent sorting directions and ignores legacy carousel limits', () => {
    const books = [
      { ...book('a'), title: 'A', createdAt: 1 },
      { ...book('b'), title: 'A', createdAt: 2 },
      { ...book('c'), title: 'B', createdAt: 3 },
    ];
    const definition = {
      ...shelf('sort'),
      layout: 'list' as const,
      sort: {
        by: 'title' as const,
        ascending: true,
        thenBy: 'created' as const,
        thenAscending: false,
      },
      limit: 1,
    };
    expect(evaluateBookshelves(books, [definition])[0]!.books.map((b) => b.hash)).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(
      evaluateBookshelves(books, [{ ...definition, layout: 'carousel' }])[0]!.books.map(
        (b) => b.hash,
      ),
    ).toEqual(['b', 'a', 'c']);
  });
  it('migrates legacy preferences and falls back to Default when none are enabled', () => {
    const defaults = defaultBookshelves({
      libraryViewMode: 'list',
      librarySortBy: 'title',
      librarySortAscending: true,
      libraryRecentShelfEnabled: false,
    });
    expect(defaults.find((s) => s.id === 'default')).toMatchObject({
      id: 'default',
      layout: 'list',
      sort: { by: 'title', ascending: true },
    });
    expect(
      evaluateBookshelves(
        [book('a')],
        defaults.map((s) => ({ ...s, enabled: false })),
      )[0]!.definition.id,
    ).toBe('default');
  });
});

describe('field operators', () => {
  const sample: Book = {
    ...book('Test'),
    title: 'The Journey',
    tags: ['Fiction', 'Travel'],
    progress: [25, 100],
    hasNarration: true,
    createdAt: Date.parse('2025-06-15T18:00:00Z'),
    metadata: {
      title: 'The Journey',
      author: 'Author',
      language: ['en', 'fr'],
      published: '2020-01-02',
      calibreColumns: [{ label: '#rating', name: 'Rating', datatype: 'int', value: 4 }],
    },
  };
  it.each([
    ['title', 'text', 'contains', 'JOURNEY', true],
    ['title', 'text', 'notContains', 'Sea', true],
    ['title', 'text', 'equals', 'the journey', true],
    ['title', 'text', 'notEquals', 'Other', true],
    ['title', 'text', 'startsWith', 'the', true],
    ['tags', 'collection', 'contains', 'fiction', true],
    ['tags', 'collection', 'contains', 'Fict', false],
    ['tags', 'collection', 'notContains', 'Science', true],
    ['progress', 'number', 'gt', 24, true],
    ['progress', 'number', 'gte', 25, true],
    ['progress', 'number', 'lt', 25, false],
    ['progress', 'number', 'lte', 25, true],
    ['created', 'date', 'equals', '2025-06-15', true],
    ['created', 'date', 'gt', '2025-06-14', true],
    ['created', 'date', 'lte', '2025-06-15', true],
    ['narration', 'boolean', 'equals', true, true],
    ['publisher', 'text', 'unset', undefined, true],
    ['publisher', 'text', 'set', undefined, false],
    ['calibre:#rating', 'number', 'gte', 4, true],
    ['calibre:#missing', 'boolean', 'equals', false, false],
  ] as const)('%s %s %s %s', (field, kind, operator, value, expected) => {
    expect(
      matchBookshelfFilter(sample, {
        type: 'group',
        match: 'all',
        children: [{ type: 'rule', field, kind, operator, value }],
      }),
    ).toBe(expected);
  });
  // A book without the field satisfies a negated condition: "Tags does not
  // contain kids" must keep untagged books rather than hide them.
  const missing = book('Missing');
  it.each([
    ['publisher', 'text', 'notEquals', 'Penguin', true],
    ['publisher', 'text', 'notContains', 'Penguin', true],
    ['publisher', 'text', 'equals', 'Penguin', false],
    ['publisher', 'text', 'contains', 'Penguin', false],
    ['publisher', 'text', 'startsWith', 'Pen', false],
    ['series', 'text', 'notEquals', 'Dune', true],
    ['tags', 'collection', 'notContains', 'kids', true],
    ['tags', 'collection', 'contains', 'kids', false],
    ['publisher', 'text', 'set', undefined, false],
    ['publisher', 'text', 'unset', undefined, true],
    ['tags', 'collection', 'unset', undefined, true],
  ] as const)('unset %s %s %s %s', (field, kind, operator, value, expected) => {
    expect(missing.tags).toEqual([]);
    expect(
      matchBookshelfFilter(missing, {
        type: 'group',
        match: 'all',
        children: [{ type: 'rule', field, kind, operator, value }],
      }),
    ).toBe(expected);
  });
});
