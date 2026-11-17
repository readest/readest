import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import type { LibrarySortByType } from '@/types/settings';
import { bookshelfSchema, createBookshelf } from '@/services/bookshelves/definitions';
import { presentBookshelf } from '@/services/bookshelves/presentation';
import {
  bookshelfItemId,
  groupDroppedBook,
  moveBookshelfItem,
  orderBookshelfItems,
  moveBookshelfItemToParent,
  renameBookshelfOrderTimes,
} from '@/services/bookshelves/ordering';
import { md5Fingerprint } from '@/utils/md5';

const books: Book[] = ['a', 'b', 'c'].map((hash, index) => ({
  hash,
  title: hash,
  author: '',
  format: 'EPUB',
  createdAt: index,
  updatedAt: index,
}));

describe('manual bookshelf order', () => {
  it('keeps the reading baseline when a group or nested scope is renamed', () => {
    expect(
      renameBookshelfOrderTimes(
        {
          'group:': 1,
          'group:A': 100,
          'group:A/B': 110,
          'group:Another': 120,
        },
        'A',
        'Renamed',
      ),
    ).toEqual({
      'group:': 1,
      'group:Renamed': 100,
      'group:Renamed/B': 110,
      'group:Another': 120,
    });
  });

  it('promotes books read after a manual reorder while retaining the other manual positions', () => {
    const definition = {
      ...createBookshelf('', 'default'),
      sort: {
        by: 'custom' as const,
        ascending: true,
        thenBy: 'none' as const,
        thenAscending: true,
      },
      manualOrder: { 'group:': ['b:b', 'b:c', 'b:a'] },
      manualOrderUpdatedAt: { 'group:': 100 },
    };
    const present = (input: Book[]) =>
      presentBookshelf(
        { definition, books: input, matching: input.length, excluded: 0 },
        { libraryGroupBy: 'group' },
        'en',
      ).map(bookshelfItemId);
    expect(present(books)).toEqual(['b:b', 'b:c', 'b:a']);
    const readA = books.map((book) => (book.hash === 'a' ? { ...book, updatedAt: 101 } : book));
    expect(present(readA)).toEqual(['b:a', 'b:b', 'b:c']);
    const readC = readA.map((book) => (book.hash === 'c' ? { ...book, updatedAt: 102 } : book));
    expect(present(readC)).toEqual(['b:c', 'b:a', 'b:b']);
    definition.manualOrder = { 'group:': ['b:c', 'b:b', 'b:a'] };
    definition.manualOrderUpdatedAt = { 'group:': 103 };
    expect(present(readC)).toEqual(['b:c', 'b:b', 'b:a']);
  });

  it('promotes the recently read group and its member without changing untouched manual positions', () => {
    const groupId = md5Fingerprint('Fiction');
    const grouped = books.map((book) => ({
      ...book,
      ...(book.hash !== 'a' && { groupName: 'Fiction', groupId }),
      ...(book.hash === 'c' && { updatedAt: 101 }),
    }));
    const definition = {
      ...createBookshelf('', 'default'),
      sort: {
        by: 'custom' as const,
        ascending: true,
        thenBy: 'none' as const,
        thenAscending: true,
      },
      manualOrder: { 'group:': ['b:a', `g:${groupId}`], 'group:Fiction': ['b:b', 'b:c'] },
      manualOrderUpdatedAt: { 'group:': 100, 'group:Fiction': 100 },
    };
    const result = { definition, books: grouped, matching: 3, excluded: 0 };
    expect(
      presentBookshelf(result, { libraryGroupBy: 'group' }, 'en').map(bookshelfItemId),
    ).toEqual([`g:${groupId}`, 'b:a']);
    expect(
      presentBookshelf(
        result,
        { libraryGroupBy: 'group' },
        'en',
        undefined,
        groupId,
        'Fiction',
      ).map(bookshelfItemId),
    ).toEqual(['b:c', 'b:b']);
  });

  it('starts the next drag from the visible order after a book has been promoted', () => {
    expect(moveBookshelfItem(books, ['b:b', 'b:c', 'b:a'], 'b:c', 'b:b', false)).toEqual([
      'b:a',
      'b:c',
      'b:b',
    ]);
  });

  it('moves books up exactly one level and ungroups books moved out of a top-level group', () => {
    const source = {
      ...books[0]!,
      groupName: 'Fiction/Nested',
      groupId: md5Fingerprint('Fiction/Nested'),
    };
    const oneLevel = moveBookshelfItemToParent(source, 'Fiction/Nested', [source])!;
    expect(oneLevel.books[0]).toMatchObject({
      hash: 'a',
      groupName: 'Fiction',
      groupId: md5Fingerprint('Fiction'),
      updatedAt: source.updatedAt,
    });
    const root = moveBookshelfItemToParent(oneLevel.books[0]!, 'Fiction', oneLevel.books)!;
    expect(root.books[0]?.groupName).toBeUndefined();
    expect(root.books[0]?.groupId).toBeUndefined();
    expect(root.books[0]?.groupUpdatedAt).toBeTruthy();
    expect(source.groupName).toBe('Fiction/Nested');
    expect(moveBookshelfItemToParent(source, '', [source])).toBeNull();
  });
  it('moves a complete subgroup without flattening descendants or merging a name collision', () => {
    const members = [
      { ...books[0]!, groupName: 'Fiction/History' },
      { ...books[1]!, groupName: 'Fiction/History/Ancient' },
      { ...books[2]!, groupName: 'History' },
    ];
    const group = {
      id: md5Fingerprint('Fiction/History'),
      name: 'Fiction/History',
      displayName: 'History',
      books: [members[0]!],
      updatedAt: 1,
    };
    const moved = moveBookshelfItemToParent(group, 'Fiction', members)!;
    expect(moved.books.map((book) => book.groupName)).toEqual([
      'History (2)',
      'History (2)/Ancient',
    ]);
    expect(moved.itemId).toBe(`g:${md5Fingerprint('History (2)')}`);
    expect(members.map((book) => book.groupName)).toEqual([
      'Fiction/History',
      'Fiction/History/Ancient',
      'History',
    ]);
  });

  it('retains the previous metadata sort in untouched groups and at the root', () => {
    const definition = {
      ...createBookshelf('', 'default'),
      sort: {
        by: 'custom' as LibrarySortByType,
        ascending: true,
        thenBy: 'none' as const,
        thenAscending: true,
      },
      customSortFallback: {
        by: 'title' as const,
        ascending: true,
        thenBy: 'none' as const,
        thenAscending: true,
      },
      manualOrder: { 'group:Fiction': ['b:b', 'b:a'] },
    };
    expect(
      presentBookshelf(
        { definition, books, matching: 3, excluded: 0 },
        { libraryGroupBy: 'group' },
        'en',
      ).map((i) => ('hash' in i ? i.hash : i.id)),
    ).toEqual(['a', 'b', 'c']);
  });

  it('moves in either direction while retaining hidden entries and appending newly imported books', () => {
    expect(moveBookshelfItem(books, undefined, 'b:a', 'b:c', true)).toEqual(['b:b', 'b:c', 'b:a']);
    expect(
      moveBookshelfItem(
        orderBookshelfItems(books, ['b:c', 'b:a', 'b:b']),
        ['b:c', 'b:hidden', 'b:a', 'b:b'],
        'b:b',
        'b:c',
        false,
      ),
    ).toEqual(['b:b', 'b:c', 'b:hidden', 'b:a']);
    expect(orderBookshelfItems(books, ['b:removed', 'b:b']).map(bookshelfItemId)).toEqual([
      'b:b',
      'b:a',
      'b:c',
    ]);
    expect(books.map((b) => b.hash)).toEqual(['a', 'b', 'c']);
  });

  it('groups two books with a unique nested name without changing reading dates or the originals', () => {
    const nested = books.map((book) => ({ ...book, groupName: 'Fiction' }));
    const result = groupDroppedBook(
      nested[0]!,
      nested[1]!,
      [...nested, { ...books[2]!, groupName: 'Fiction/Untitled Group 1/Nested' }],
      'Untitled Group',
      'Fiction',
    );
    expect(result.groupName).toBe('Fiction/Untitled Group 2');
    expect(result.groupId).toBe(md5Fingerprint(result.groupName));
    expect(result.books.map((book) => book.hash)).toEqual(['b', 'a']);
    expect(
      result.books.every((book) => book.groupName === result.groupName && book.groupUpdatedAt),
    ).toBe(true);
    expect(result.books.map((book) => book.updatedAt)).toEqual([1, 0]);
    expect(nested[0]!.groupName).toBe('Fiction');
  });

  it('adds only the dropped book to an existing group, retaining its nested subgroups', () => {
    const member = { ...books[1]!, groupName: 'Fiction/Nested' };
    const group = {
      id: md5Fingerprint('Fiction'),
      name: 'Fiction',
      displayName: 'Fiction',
      books: [member],
      updatedAt: 1,
    };
    const result = groupDroppedBook(books[0]!, group, [books[0]!, member], 'Untitled Group');
    expect(result.books).toHaveLength(1);
    expect(result.books[0]!.groupName).toBe('Fiction');
    expect(member.groupName).toBe('Fiction/Nested');
  });

  it('persists and presents a custom order independently inside each group', () => {
    const definition = {
      ...createBookshelf('', 'default'),
      sort: {
        by: 'custom' as LibrarySortByType,
        ascending: true,
        thenBy: 'none' as const,
        thenAscending: true,
      },
      manualOrder: { 'group:': ['b:b', 'b:a', 'b:c'], 'group:Fiction': ['b:c', 'b:a'] },
    };
    const result = { definition, books, matching: 3, excluded: 0 };
    expect(
      presentBookshelf(result, { libraryGroupBy: 'group' }, 'en').map((i) =>
        'hash' in i ? i.hash : i.id,
      ),
    ).toEqual(['b', 'a', 'c']);
    const { manualOrder: _order, ...serializedDefinition } = definition;
    expect(bookshelfSchema.safeParse(serializedDefinition).success).toBe(true);
    const grouped = { ...result, books: books.map((b) => ({ ...b, groupName: 'Fiction' })) };
    expect(
      presentBookshelf(
        grouped,
        { libraryGroupBy: 'group' },
        'en',
        undefined,
        'fiction',
        'Fiction',
      ).map((i) => ('hash' in i ? i.hash : i.id)),
    ).toEqual(['c', 'a', 'b']);
  });
});
