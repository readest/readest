import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@/utils/md5', () => ({
  md5Fingerprint: (value: string) => `md5_${value.replace(/[^a-zA-Z0-9]/g, '_')}`,
}));

import { useLibraryStore } from '@/store/libraryStore';
import type { Book, BooksGroup } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';

function makeEnvConfig(appService: Partial<AppService>): EnvConfigType {
  return {
    getAppService: vi.fn().mockResolvedValue(appService as AppService),
  };
}

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'hash1',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Author',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

describe('libraryStore', () => {
  beforeEach(() => {
    useLibraryStore.setState({
      library: [],
      libraryLoaded: false,
      isSyncing: false,
      syncProgress: 0,
      currentBookshelf: [],
      selectedBooks: new Set(),
      groups: {},
      hashIndex: new Map(),
      visibleLibrary: [],
    });
  });

  describe('setLibrary', () => {
    test('sets the library and marks it as loaded', () => {
      const books = [makeBook({ hash: 'a' }), makeBook({ hash: 'b' })];
      useLibraryStore.getState().setLibrary(books);

      const state = useLibraryStore.getState();
      expect(state.library).toHaveLength(2);
      expect(state.libraryLoaded).toBe(true);
    });

    test('builds hash index on setLibrary', () => {
      const books = [makeBook({ hash: 'a' }), makeBook({ hash: 'b' })];
      useLibraryStore.getState().setLibrary(books);

      const state = useLibraryStore.getState();
      expect(state.hashIndex.get('a')).toBe(0);
      expect(state.hashIndex.get('b')).toBe(1);
      expect(state.hashIndex.size).toBe(2);
    });

    test('calls refreshGroups after setting library', () => {
      const book = makeBook({ hash: 'a', groupName: 'Fiction' });
      useLibraryStore.getState().setLibrary([book]);

      const groups = useLibraryStore.getState().getGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0]!.name).toBe('Fiction');
    });
  });

  describe('getBookByHash', () => {
    test('returns the book for a known hash', () => {
      const books = [makeBook({ hash: 'a', title: 'Book A' }), makeBook({ hash: 'b' })];
      useLibraryStore.getState().setLibrary(books);

      expect(useLibraryStore.getState().getBookByHash('a')?.title).toBe('Book A');
    });

    test('returns undefined for unknown hash', () => {
      useLibraryStore.getState().setLibrary([makeBook({ hash: 'a' })]);
      expect(useLibraryStore.getState().getBookByHash('nonexistent')).toBeUndefined();
    });
  });

  describe('updateBookProgress', () => {
    test('updates progress and explicitly clears readingStatus when undefined is passed', () => {
      const books = [makeBook({ hash: 'a', progress: [1, 100], readingStatus: 'unread' })];
      useLibraryStore.getState().setLibrary(books);

      useLibraryStore.getState().updateBookProgress('a', [50, 100], undefined);

      const book = useLibraryStore.getState().getBookByHash('a');
      expect(book?.progress).toEqual([50, 100]);
      expect(book?.readingStatus).toBeUndefined();
      expect(book?.updatedAt).toBeGreaterThan(0);
    });

    test('does nothing for unknown hash', () => {
      useLibraryStore.getState().setLibrary([makeBook({ hash: 'a' })]);
      useLibraryStore.getState().updateBookProgress('nonexistent', [1, 1], undefined);
      expect(useLibraryStore.getState().library).toHaveLength(1);
    });

    test('marks book as finished at 100%', () => {
      const books = [makeBook({ hash: 'a' })];
      useLibraryStore.getState().setLibrary(books);

      useLibraryStore.getState().updateBookProgress('a', [100, 100], 'finished');

      expect(useLibraryStore.getState().getBookByHash('a')?.readingStatus).toBe('finished');
    });

    test('creates a new library array reference (Zustand change-detection)', () => {
      useLibraryStore.getState().setLibrary([makeBook({ hash: 'a' })]);
      const before = useLibraryStore.getState().library;

      useLibraryStore.getState().updateBookProgress('a', [50, 100], undefined);

      const after = useLibraryStore.getState().library;
      expect(after).not.toBe(before);
    });

    test('replaces the book entry with a new object (no in-place mutation)', () => {
      const original = makeBook({ hash: 'a', progress: [1, 100] });
      useLibraryStore.getState().setLibrary([original]);

      useLibraryStore.getState().updateBookProgress('a', [50, 100], undefined);

      // Original reference must NOT be mutated
      expect(original.progress).toEqual([1, 100]);
      // Store should have a new book object
      expect(useLibraryStore.getState().getBookByHash('a')).not.toBe(original);
    });

    test('updates visibleLibrary cache so callers see fresh progress', () => {
      useLibraryStore.getState().setLibrary([makeBook({ hash: 'a', progress: [1, 100] })]);

      useLibraryStore.getState().updateBookProgress('a', [42, 100], undefined);

      const visible = useLibraryStore.getState().getVisibleLibrary();
      expect(visible).toHaveLength(1);
      expect(visible[0]?.progress).toEqual([42, 100]);
    });

    test('does not include deleted books in visibleLibrary after update', () => {
      const books = [
        makeBook({ hash: 'a' }),
        makeBook({ hash: 'b', deletedAt: 12345 }),
        makeBook({ hash: 'c' }),
      ];
      useLibraryStore.getState().setLibrary(books);

      useLibraryStore.getState().updateBookProgress('a', [10, 100], undefined);

      const visible = useLibraryStore.getState().getVisibleLibrary();
      expect(visible.map((b) => b.hash)).toEqual(['a', 'c']);
    });
  });

  describe('updateBooks', () => {
    test('persists by default', async () => {
      const saveLibraryBooks = vi.fn().mockResolvedValue(undefined);
      const envConfig = makeEnvConfig({ saveLibraryBooks });

      await useLibraryStore.getState().updateBooks(envConfig, [makeBook({ hash: 'a' })]);

      expect(saveLibraryBooks).toHaveBeenCalledTimes(1);
    });

    test('skips persistence when skipSave: true', async () => {
      const saveLibraryBooks = vi.fn().mockResolvedValue(undefined);
      const envConfig = makeEnvConfig({ saveLibraryBooks });

      await useLibraryStore
        .getState()
        .updateBooks(envConfig, [makeBook({ hash: 'a' })], { skipSave: true });

      expect(saveLibraryBooks).not.toHaveBeenCalled();
    });

    test('still updates store state when skipSave: true', async () => {
      const saveLibraryBooks = vi.fn().mockResolvedValue(undefined);
      const envConfig = makeEnvConfig({ saveLibraryBooks });

      await useLibraryStore
        .getState()
        .updateBooks(envConfig, [makeBook({ hash: 'a' })], { skipSave: true });

      expect(useLibraryStore.getState().library).toHaveLength(1);
      expect(useLibraryStore.getState().getBookByHash('a')).toBeDefined();
    });
  });

  describe('rebuildHashIndex', () => {
    test('rebuilds index after manual array mutation', () => {
      const books = [makeBook({ hash: 'a' }), makeBook({ hash: 'b' })];
      useLibraryStore.getState().setLibrary(books);

      // Simulate manual splice + unshift (like saveConfig does)
      const { library } = useLibraryStore.getState();
      const [book] = library.splice(1, 1);
      library.unshift(book!);
      useLibraryStore.getState().rebuildHashIndex();

      const state = useLibraryStore.getState();
      expect(state.hashIndex.get('b')).toBe(0);
      expect(state.hashIndex.get('a')).toBe(1);
    });
  });

  describe('getVisibleLibrary', () => {
    test('filters out books with deletedAt set', () => {
      const bookA = makeBook({ hash: 'a', deletedAt: null });
      const bookB = makeBook({ hash: 'b', deletedAt: 12345 });
      const bookC = makeBook({ hash: 'c' });
      const books = [bookA, bookB, bookC];
      useLibraryStore.setState({ library: books, visibleLibrary: [bookA, bookC] });

      const visible = useLibraryStore.getState().getVisibleLibrary();
      expect(visible).toHaveLength(2);
      expect(visible.map((b) => b.hash)).toEqual(['a', 'c']);
    });

    test('returns all books when none are deleted', () => {
      const books = [makeBook({ hash: 'a' }), makeBook({ hash: 'b' })];
      useLibraryStore.setState({ library: books, visibleLibrary: books });

      const visible = useLibraryStore.getState().getVisibleLibrary();
      expect(visible).toHaveLength(2);
    });

    test('returns empty array for empty library', () => {
      expect(useLibraryStore.getState().getVisibleLibrary()).toEqual([]);
    });
  });

  describe('setSelectedBooks / getSelectedBooks', () => {
    test('sets and retrieves selected book ids', () => {
      useLibraryStore.getState().setSelectedBooks(['id1', 'id2', 'id3']);
      const selected = useLibraryStore.getState().getSelectedBooks();
      expect(selected).toHaveLength(3);
      expect(new Set(selected)).toEqual(new Set(['id1', 'id2', 'id3']));
    });

    test('returns empty array when no books are selected', () => {
      expect(useLibraryStore.getState().getSelectedBooks()).toEqual([]);
    });

    test('replaces previous selection', () => {
      useLibraryStore.getState().setSelectedBooks(['id1']);
      useLibraryStore.getState().setSelectedBooks(['id2', 'id3']);

      const selected = useLibraryStore.getState().getSelectedBooks();
      expect(new Set(selected)).toEqual(new Set(['id2', 'id3']));
    });
  });

  describe('toggleSelectedBook', () => {
    test('adds a book if not selected', () => {
      useLibraryStore.getState().toggleSelectedBook('id1');

      const selected = useLibraryStore.getState().getSelectedBooks();
      expect(selected).toEqual(['id1']);
    });

    test('removes a book if already selected', () => {
      useLibraryStore.getState().setSelectedBooks(['id1', 'id2']);
      useLibraryStore.getState().toggleSelectedBook('id1');

      const selected = useLibraryStore.getState().getSelectedBooks();
      expect(selected).toEqual(['id2']);
    });

    test('toggling twice returns to original state', () => {
      useLibraryStore.getState().toggleSelectedBook('id1');
      useLibraryStore.getState().toggleSelectedBook('id1');

      expect(useLibraryStore.getState().getSelectedBooks()).toEqual([]);
    });
  });

  describe('refreshGroups', () => {
    test('extracts groups from library books', () => {
      const books = [
        makeBook({ hash: 'a', groupName: 'Fiction' }),
        makeBook({ hash: 'b', groupName: 'Science' }),
      ];
      useLibraryStore.setState({ library: books });
      useLibraryStore.getState().refreshGroups();

      const groups = useLibraryStore.getState().getGroups();
      expect(groups).toHaveLength(2);
      const names = groups.map((g) => g.name);
      expect(names).toContain('Fiction');
      expect(names).toContain('Science');
    });

    test('ignores deleted books', () => {
      const books = [makeBook({ hash: 'a', groupName: 'Fiction', deletedAt: 999 })];
      useLibraryStore.setState({ library: books });
      useLibraryStore.getState().refreshGroups();

      expect(useLibraryStore.getState().getGroups()).toHaveLength(0);
    });

    test('ignores ungrouped books (empty groupName)', () => {
      const books = [makeBook({ hash: 'a', groupName: '' })];
      useLibraryStore.setState({ library: books });
      useLibraryStore.getState().refreshGroups();

      expect(useLibraryStore.getState().getGroups()).toHaveLength(0);
    });

    test('extracts parent group paths from nested groups', () => {
      const books = [makeBook({ hash: 'a', groupName: 'Fiction/Sci-Fi' })];
      useLibraryStore.setState({ library: books });
      useLibraryStore.getState().refreshGroups();

      const groups = useLibraryStore.getState().getGroups();
      const names = groups.map((g) => g.name);
      expect(names).toContain('Fiction');
      expect(names).toContain('Fiction/Sci-Fi');
    });
  });

  describe('addGroup', () => {
    test('adds a new group and returns it', () => {
      const result = useLibraryStore.getState().addGroup('New Group');
      expect(result.name).toBe('New Group');
      expect(result.id).toBe('md5_New_Group');

      const groups = useLibraryStore.getState().getGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0]!.name).toBe('New Group');
    });

    test('trims whitespace from group name', () => {
      const result = useLibraryStore.getState().addGroup('  Trimmed  ');
      expect(result.name).toBe('Trimmed');
    });

    test('throws on empty group name', () => {
      expect(() => useLibraryStore.getState().addGroup('')).toThrow('Group name cannot be empty');
    });

    test('throws on whitespace-only group name', () => {
      expect(() => useLibraryStore.getState().addGroup('   ')).toThrow(
        'Group name cannot be empty',
      );
    });
  });

  describe('getGroups', () => {
    test('returns groups sorted by name', () => {
      useLibraryStore.getState().addGroup('Zebra');
      useLibraryStore.getState().addGroup('Alpha');
      useLibraryStore.getState().addGroup('Middle');

      const groups = useLibraryStore.getState().getGroups();
      expect(groups.map((g) => g.name)).toEqual(['Alpha', 'Middle', 'Zebra']);
    });

    test('returns empty array when no groups exist', () => {
      expect(useLibraryStore.getState().getGroups()).toEqual([]);
    });
  });

  describe('getGroupId', () => {
    test('returns the id for a known group path', () => {
      useLibraryStore.getState().addGroup('Fiction');
      const id = useLibraryStore.getState().getGroupId('Fiction');
      expect(id).toBe('md5_Fiction');
    });

    test('returns md5 fingerprint for unknown group path', () => {
      const id = useLibraryStore.getState().getGroupId('Unknown');
      expect(id).toBe('md5_Unknown');
    });
  });

  describe('getGroupName', () => {
    test('returns the name for a known group id', () => {
      useLibraryStore.getState().addGroup('Fiction');
      const name = useLibraryStore.getState().getGroupName('md5_Fiction');
      expect(name).toBe('Fiction');
    });

    test('returns undefined for an unknown group id', () => {
      expect(useLibraryStore.getState().getGroupName('nonexistent')).toBeUndefined();
    });
  });

  describe('getParentPath', () => {
    test('returns parent path for nested path', () => {
      expect(useLibraryStore.getState().getParentPath('Fiction/Sci-Fi')).toBe('Fiction');
    });

    test('returns empty string for top-level path', () => {
      expect(useLibraryStore.getState().getParentPath('Fiction')).toBe('');
    });

    test('returns grandparent for deeply nested path', () => {
      expect(useLibraryStore.getState().getParentPath('A/B/C')).toBe('A/B');
    });
  });

  describe('getGroupsByParent', () => {
    test('returns top-level groups when parentPath is undefined', () => {
      useLibraryStore.getState().addGroup('Fiction');
      useLibraryStore.getState().addGroup('Science');

      const groups = useLibraryStore.getState().getGroupsByParent();
      expect(groups).toHaveLength(2);
    });

    test('returns top-level groups when parentPath is empty string', () => {
      useLibraryStore.getState().addGroup('Fiction');
      useLibraryStore.getState().addGroup('Science');

      const groups = useLibraryStore.getState().getGroupsByParent('');
      expect(groups).toHaveLength(2);
    });

    test('returns child groups of a given parent', () => {
      useLibraryStore.getState().addGroup('Fiction');
      useLibraryStore.getState().addGroup('Fiction/Sci-Fi');
      useLibraryStore.getState().addGroup('Fiction/Fantasy');
      useLibraryStore.getState().addGroup('Science');

      const children = useLibraryStore.getState().getGroupsByParent('Fiction');
      expect(children).toHaveLength(2);
      const names = children.map((g) => g.name);
      expect(names).toContain('Fiction/Sci-Fi');
      expect(names).toContain('Fiction/Fantasy');
    });

    test('returns empty array when no children exist', () => {
      useLibraryStore.getState().addGroup('Fiction');

      const children = useLibraryStore.getState().getGroupsByParent('Nonexistent');
      expect(children).toEqual([]);
    });
  });

  describe('setCurrentBookshelf', () => {
    test('sets the current bookshelf with books', () => {
      const books: Book[] = [makeBook({ hash: 'a' }), makeBook({ hash: 'b' })];
      useLibraryStore.getState().setCurrentBookshelf(books);

      expect(useLibraryStore.getState().currentBookshelf).toHaveLength(2);
    });

    test('sets the current bookshelf with mixed books and groups', () => {
      const book = makeBook({ hash: 'a' });
      const group: BooksGroup = {
        id: 'g1',
        name: 'Fiction',
        displayName: 'Fiction',
        books: [],
        updatedAt: 1000,
      };
      useLibraryStore.getState().setCurrentBookshelf([book, group]);

      expect(useLibraryStore.getState().currentBookshelf).toHaveLength(2);
    });

    test('replaces previous bookshelf', () => {
      useLibraryStore.getState().setCurrentBookshelf([makeBook({ hash: 'a' })]);
      useLibraryStore.getState().setCurrentBookshelf([makeBook({ hash: 'b' })]);

      const shelf = useLibraryStore.getState().currentBookshelf;
      expect(shelf).toHaveLength(1);
    });
  });
});
