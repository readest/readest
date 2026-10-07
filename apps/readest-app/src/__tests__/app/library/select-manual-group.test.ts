import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { generateBookshelfItems } from '@/services/bookshelves/presentation';
import { createBookGroups, findSelectedManualGroup } from '@/app/library/utils/libraryUtils';
import { LibraryGroupByType } from '@/types/settings';

const book = (hash: string, groupName?: string, author = 'Author'): Book => ({
  hash,
  title: hash,
  author,
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  groupName,
});

const library = [
  book('a1', 'Fiction'),
  book('a2', 'Fiction/Sci-Fi'),
  book('a3', 'Fiction/Fantasy/Epic'),
  book('b1', 'Shelf/Inner'),
  book('loose'),
];

describe('findSelectedManualGroup', () => {
  it('finds a selected group with nested groups inside it', () => {
    const items = generateBookshelfItems(library, '');
    expect(findSelectedManualGroup(['a1', 'a2', 'a3'], items)?.name).toBe('Fiction');
  });

  it('finds a group whose books all live in its subgroups', () => {
    const items = generateBookshelfItems(library, '');
    expect(findSelectedManualGroup(['b1'], items)?.name).toBe('Shelf');
  });

  it('finds a nested group while browsing inside its parent', () => {
    const items = generateBookshelfItems(library, 'Fiction');
    expect(findSelectedManualGroup(['a3'], items)?.name).toBe('Fiction/Fantasy');
  });

  it('ignores a partial group, a group plus a book, and a lone book', () => {
    const items = generateBookshelfItems(library, '');
    expect(findSelectedManualGroup(['a1', 'a2'], items)).toBeUndefined();
    expect(findSelectedManualGroup(['b1', 'loose'], items)).toBeUndefined();
    expect(findSelectedManualGroup(['loose'], items)).toBeUndefined();
  });

  it('ignores a lone nested book shown flat in another shelf', () => {
    expect(findSelectedManualGroup(['b1'], library)).toBeUndefined();
  });

  it('ignores author groups', () => {
    const items = createBookGroups([book('c1', 'Fiction', 'Fiction')], LibraryGroupByType.Author);
    expect(findSelectedManualGroup(['c1'], items)).toBeUndefined();
  });
});
