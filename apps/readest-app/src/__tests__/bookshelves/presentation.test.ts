import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { createBookshelf, defaultBookshelves } from '@/services/bookshelves/definitions';
import { evaluateBookshelves } from '@/services/bookshelves/evaluate';
import { presentBookshelf } from '@/services/bookshelves/presentation';
const books: Book[] = Array.from({ length: 30 }, (_, index) => ({
  hash: `${index}`,
  title: `Title ${index}`,
  author: 'Writer',
  groupName: index < 20 ? 'Fiction/Fantasy' : 'Other',
  format: 'EPUB',
  createdAt: index,
  updatedAt: index,
}));
describe('bookshelf presentation parity', () => {
  it('applies global grouping to every shelf and layout while retaining all books', () => {
    for (const layout of ['grid', 'list', 'carousel'] as const) {
      const definition = { ...createBookshelf('', 'default'), layout };
      const result = evaluateBookshelves(books, [definition])[0]!;
      const presented = presentBookshelf(result, { libraryGroupBy: 'group' }, 'en');
      expect(presented).toHaveLength(2);
      expect(presented.flatMap((i) => ('books' in i ? i.books : [i]))).toHaveLength(30);
      const custom = {
        ...result,
        definition: { ...definition, id: crypto.randomUUID(), name: 'Custom' },
      };
      expect(presentBookshelf(custom, { libraryGroupBy: 'group' }, 'en')).toEqual(presented);
    }
  });
  it('uses independent grouping and drills into only that shelf’s filtered results', () => {
    const definition = {
      ...createBookshelf('Authors'),
      useGlobalGrouping: false,
      groupBy: 'author' as const,
    };
    const result = evaluateBookshelves(books.slice(0, 5), [definition])[0]!;
    const presented = presentBookshelf(result, { libraryGroupBy: 'none' }, 'en');
    expect(presented).toHaveLength(1);
    const group = presented[0]!;
    expect('books' in group && group.books).toHaveLength(5);
    expect(
      presentBookshelf(
        result,
        { libraryGroupBy: 'none' },
        'en',
        undefined,
        'id' in group ? group.id : '',
      ),
    ).toHaveLength(5);
    expect(
      presentBookshelf(
        { ...result, definition: { ...definition, groupBy: 'none' } },
        { libraryGroupBy: 'author' },
        'en',
      ),
    ).toEqual(result.books);
  });
  it('honors an explicit Default sort independently of legacy auto sort', () => {
    const definition = {
      ...createBookshelf('', 'default'),
      layout: 'list' as const,
      sort: {
        by: 'title' as const,
        ascending: true,
        thenBy: 'none' as const,
        thenAscending: false,
      },
    };
    const result = evaluateBookshelves(books, [definition], 'en')[0]!;
    expect(
      presentBookshelf(result, { libraryGroupBy: 'none', librarySortByAuto: true }, 'en'),
    ).toEqual(result.books);
    expect(
      defaultBookshelves({ libraryGroupBy: 'series', librarySortByAuto: true }).find(
        (s) => s.id === 'default',
      )!.sort.by,
    ).toBe('series');
    expect(
      defaultBookshelves({ libraryGroupBy: 'author' }).find((s) => s.id === 'default')!.sort.thenBy,
    ).toBe('series');
  });
  it('leaves all books represented when Default is disabled and another list shelf is enabled', () => {
    const defs = defaultBookshelves({}).map((s) => ({ ...s, enabled: false }));
    const results = evaluateBookshelves(books, [
      { ...createBookshelf('Custom'), layout: 'list' },
      ...defs,
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]!.books).toHaveLength(30);
  });
});
