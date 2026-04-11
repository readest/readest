import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@/utils/md5', () => ({
  md5Fingerprint: (value: string) => `md5_${value}`,
}));

import { useBookDataStore } from '@/store/bookDataStore';
import type { BookData } from '@/store/bookDataStore';
import type { BookConfig, BookNote, Book } from '@/types/book';
import { useLibraryStore } from '@/store/libraryStore';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';

function makeEnvConfig(appService: Partial<AppService>): EnvConfigType {
  return {
    getAppService: vi.fn().mockResolvedValue(appService as AppService),
  };
}

const FAKE_SETTINGS = {} as unknown as SystemSettings;

function makeBookData(id: string, config?: Partial<BookConfig>): BookData {
  return {
    id,
    book: null,
    file: null,
    config: {
      updatedAt: 1000,
      ...config,
    },
    bookDoc: null,
    isFixedLayout: false,
  };
}

function makeBookNote(overrides: Partial<BookNote> = {}): BookNote {
  return {
    id: 'note1',
    type: 'annotation',
    cfi: 'epubcfi(/2/4)',
    note: 'Test note',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

describe('bookDataStore', () => {
  beforeEach(() => {
    useBookDataStore.setState({ booksData: {} });
  });

  describe('getBookData', () => {
    test('returns null for a missing book', () => {
      expect(useBookDataStore.getState().getBookData('nonexistent')).toBeNull();
    });

    test('returns data for an existing book', () => {
      const data = makeBookData('book1');
      useBookDataStore.setState({ booksData: { book1: data } });

      const result = useBookDataStore.getState().getBookData('book1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('book1');
    });

    test('extracts id from "id-suffix" key format', () => {
      const data = makeBookData('abc123');
      useBookDataStore.setState({ booksData: { abc123: data } });

      const result = useBookDataStore.getState().getBookData('abc123-view0');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('abc123');
    });

    test('handles key with multiple hyphens by using first segment', () => {
      const data = makeBookData('hash42');
      useBookDataStore.setState({ booksData: { hash42: data } });

      const result = useBookDataStore.getState().getBookData('hash42-view0-extra');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('hash42');
    });
  });

  describe('clearBookData', () => {
    test('removes the book data entry', () => {
      const data = makeBookData('book1');
      useBookDataStore.setState({ booksData: { book1: data } });

      useBookDataStore.getState().clearBookData('book1');
      expect(useBookDataStore.getState().getBookData('book1')).toBeNull();
    });

    test('extracts id from "id-suffix" key before clearing', () => {
      const data = makeBookData('book1');
      useBookDataStore.setState({ booksData: { book1: data } });

      useBookDataStore.getState().clearBookData('book1-view0');
      expect(useBookDataStore.getState().getBookData('book1')).toBeNull();
    });

    test('does not affect other book data entries', () => {
      const data1 = makeBookData('book1');
      const data2 = makeBookData('book2');
      useBookDataStore.setState({ booksData: { book1: data1, book2: data2 } });

      useBookDataStore.getState().clearBookData('book1');
      expect(useBookDataStore.getState().getBookData('book1')).toBeNull();
      expect(useBookDataStore.getState().getBookData('book2')).not.toBeNull();
    });

    test('is a no-op when the id does not exist', () => {
      const data = makeBookData('book1');
      useBookDataStore.setState({ booksData: { book1: data } });

      useBookDataStore.getState().clearBookData('nonexistent');
      expect(useBookDataStore.getState().getBookData('book1')).not.toBeNull();
    });
  });

  describe('getConfig', () => {
    test('returns null when key is null', () => {
      expect(useBookDataStore.getState().getConfig(null)).toBeNull();
    });

    test('returns null when book data does not exist', () => {
      expect(useBookDataStore.getState().getConfig('nonexistent')).toBeNull();
    });

    test('returns the config for an existing book', () => {
      const data = makeBookData('book1', { location: 'epubcfi(/2/4)' });
      useBookDataStore.setState({ booksData: { book1: data } });

      const config = useBookDataStore.getState().getConfig('book1');
      expect(config).not.toBeNull();
      expect(config!.location).toBe('epubcfi(/2/4)');
    });

    test('extracts id from "id-suffix" key format', () => {
      const data = makeBookData('book1', { location: 'loc1' });
      useBookDataStore.setState({ booksData: { book1: data } });

      const config = useBookDataStore.getState().getConfig('book1-view0');
      expect(config).not.toBeNull();
      expect(config!.location).toBe('loc1');
    });

    test('returns null when book exists but has no config', () => {
      const data: BookData = {
        id: 'book1',
        book: null,
        file: null,
        config: null,
        bookDoc: null,
        isFixedLayout: false,
      };
      useBookDataStore.setState({ booksData: { book1: data } });

      expect(useBookDataStore.getState().getConfig('book1')).toBeNull();
    });
  });

  describe('setConfig', () => {
    test('updates partial config on an existing book', () => {
      const data = makeBookData('book1', { location: 'old-loc' });
      useBookDataStore.setState({ booksData: { book1: data } });

      useBookDataStore.getState().setConfig('book1', { location: 'new-loc' });

      const config = useBookDataStore.getState().getConfig('book1');
      expect(config!.location).toBe('new-loc');
    });

    test('preserves existing config fields when updating', () => {
      const data = makeBookData('book1', {
        location: 'loc1',
        progress: [5, 100],
      });
      useBookDataStore.setState({ booksData: { book1: data } });

      useBookDataStore.getState().setConfig('book1', { location: 'new-loc' });

      const config = useBookDataStore.getState().getConfig('book1');
      expect(config!.location).toBe('new-loc');
      expect(config!.progress).toEqual([5, 100]);
    });

    test('extracts id from "id-suffix" key format', () => {
      const data = makeBookData('book1', { location: 'old-loc' });
      useBookDataStore.setState({ booksData: { book1: data } });

      useBookDataStore.getState().setConfig('book1-view0', { location: 'new-loc' });

      const config = useBookDataStore.getState().getConfig('book1');
      expect(config!.location).toBe('new-loc');
    });

    test('does nothing and warns when book data does not exist', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      useBookDataStore.getState().setConfig('nonexistent', { location: 'loc' });
      expect(useBookDataStore.getState().getConfig('nonexistent')).toBeNull();

      warnSpy.mockRestore();
    });
  });

  describe('updateBooknotes', () => {
    test('deduplicates booknotes by id-type-cfi', () => {
      const data = makeBookData('book1', { booknotes: [] });
      useBookDataStore.setState({ booksData: { book1: data } });

      const notes: BookNote[] = [
        makeBookNote({ id: 'n1', type: 'annotation', cfi: 'cfi1', note: 'first' }),
        makeBookNote({ id: 'n1', type: 'annotation', cfi: 'cfi1', note: 'duplicate' }),
        makeBookNote({ id: 'n2', type: 'bookmark', cfi: 'cfi2', note: 'second' }),
      ];

      useBookDataStore.getState().updateBooknotes('book1', notes);

      const config = useBookDataStore.getState().getConfig('book1');
      expect(config!.booknotes).toHaveLength(2);
    });

    test('keeps the last duplicate when deduplicating', () => {
      const data = makeBookData('book1', { booknotes: [] });
      useBookDataStore.setState({ booksData: { book1: data } });

      const notes: BookNote[] = [
        makeBookNote({ id: 'n1', type: 'annotation', cfi: 'cfi1', note: 'first' }),
        makeBookNote({ id: 'n1', type: 'annotation', cfi: 'cfi1', note: 'last' }),
      ];

      useBookDataStore.getState().updateBooknotes('book1', notes);

      const config = useBookDataStore.getState().getConfig('book1');
      expect(config!.booknotes![0]!.note).toBe('last');
    });

    test('returns the updated config', () => {
      const data = makeBookData('book1');
      useBookDataStore.setState({ booksData: { book1: data } });

      const notes = [makeBookNote()];
      const result = useBookDataStore.getState().updateBooknotes('book1', notes);
      expect(result).toBeDefined();
      expect(result!.booknotes).toHaveLength(1);
    });

    test('returns undefined when book does not exist', () => {
      const result = useBookDataStore.getState().updateBooknotes('nonexistent', [makeBookNote()]);
      expect(result).toBeUndefined();
    });

    test('extracts id from "id-suffix" key format', () => {
      const data = makeBookData('book1', { booknotes: [] });
      useBookDataStore.setState({ booksData: { book1: data } });

      const notes = [makeBookNote({ id: 'n1' })];
      useBookDataStore.getState().updateBooknotes('book1-view0', notes);

      const config = useBookDataStore.getState().getConfig('book1');
      expect(config!.booknotes).toHaveLength(1);
    });

    test('treats different type or cfi as unique even with same id', () => {
      const data = makeBookData('book1', { booknotes: [] });
      useBookDataStore.setState({ booksData: { book1: data } });

      const notes: BookNote[] = [
        makeBookNote({ id: 'n1', type: 'annotation', cfi: 'cfi1' }),
        makeBookNote({ id: 'n1', type: 'bookmark', cfi: 'cfi1' }),
        makeBookNote({ id: 'n1', type: 'annotation', cfi: 'cfi2' }),
      ];

      useBookDataStore.getState().updateBooknotes('book1', notes);

      const config = useBookDataStore.getState().getConfig('book1');
      expect(config!.booknotes).toHaveLength(3);
    });
  });

  describe('saveConfig', () => {
    function makeLibraryBook(overrides: Partial<Book> = {}): Book {
      return {
        hash: 'h1',
        format: 'EPUB',
        title: 'Book',
        author: 'Author',
        createdAt: 1000,
        updatedAt: 1000,
        ...overrides,
      };
    }

    test('creates a new library array reference (Zustand change-detection)', async () => {
      const saveBookConfig = vi.fn().mockResolvedValue(undefined);
      const saveLibraryBooks = vi.fn().mockResolvedValue(undefined);
      const envConfig = makeEnvConfig({ saveBookConfig, saveLibraryBooks });

      const book = makeLibraryBook({ hash: 'h1' });
      useLibraryStore.getState().setLibrary([book]);
      const before = useLibraryStore.getState().library;

      const data = makeBookData('h1', { progress: [10, 100] });
      useBookDataStore.setState({ booksData: { h1: data } });

      await useBookDataStore.getState().saveConfig(envConfig, 'h1', data.config!, FAKE_SETTINGS);

      const after = useLibraryStore.getState().library;
      expect(after).not.toBe(before);
    });

    test('moves the saved book to the front of the library', async () => {
      const saveBookConfig = vi.fn().mockResolvedValue(undefined);
      const saveLibraryBooks = vi.fn().mockResolvedValue(undefined);
      const envConfig = makeEnvConfig({ saveBookConfig, saveLibraryBooks });

      useLibraryStore
        .getState()
        .setLibrary([
          makeLibraryBook({ hash: 'a' }),
          makeLibraryBook({ hash: 'b' }),
          makeLibraryBook({ hash: 'c' }),
        ]);

      const data = makeBookData('c', { progress: [5, 100] });
      useBookDataStore.setState({ booksData: { c: data } });

      await useBookDataStore.getState().saveConfig(envConfig, 'c', data.config!, FAKE_SETTINGS);

      const library = useLibraryStore.getState().library;
      expect(library.map((b) => b.hash)).toEqual(['c', 'a', 'b']);
      // hashIndex should be rebuilt to match the new order
      expect(useLibraryStore.getState().hashIndex.get('c')).toBe(0);
      expect(useLibraryStore.getState().hashIndex.get('a')).toBe(1);
      expect(useLibraryStore.getState().hashIndex.get('b')).toBe(2);
    });

    test('updates visibleLibrary to match the new library order', async () => {
      const saveBookConfig = vi.fn().mockResolvedValue(undefined);
      const saveLibraryBooks = vi.fn().mockResolvedValue(undefined);
      const envConfig = makeEnvConfig({ saveBookConfig, saveLibraryBooks });

      useLibraryStore
        .getState()
        .setLibrary([
          makeLibraryBook({ hash: 'a' }),
          makeLibraryBook({ hash: 'b', deletedAt: 999 }),
          makeLibraryBook({ hash: 'c' }),
        ]);

      const data = makeBookData('c', { progress: [5, 100] });
      useBookDataStore.setState({ booksData: { c: data } });

      await useBookDataStore.getState().saveConfig(envConfig, 'c', data.config!, FAKE_SETTINGS);

      const visible = useLibraryStore.getState().getVisibleLibrary();
      expect(visible.map((b) => b.hash)).toEqual(['c', 'a']);
    });

    test('persists progress and writes the library', async () => {
      const saveBookConfig = vi.fn().mockResolvedValue(undefined);
      const saveLibraryBooks = vi.fn().mockResolvedValue(undefined);
      const envConfig = makeEnvConfig({ saveBookConfig, saveLibraryBooks });

      useLibraryStore.getState().setLibrary([makeLibraryBook({ hash: 'h1' })]);

      const data = makeBookData('h1', { progress: [42, 100] });
      useBookDataStore.setState({ booksData: { h1: data } });

      await useBookDataStore.getState().saveConfig(envConfig, 'h1', data.config!, FAKE_SETTINGS);

      const stored = useLibraryStore.getState().getBookByHash('h1');
      expect(stored?.progress).toEqual([42, 100]);
      expect(saveBookConfig).toHaveBeenCalledOnce();
      expect(saveLibraryBooks).toHaveBeenCalledOnce();
    });

    test('does nothing for unknown book hash', async () => {
      const saveBookConfig = vi.fn().mockResolvedValue(undefined);
      const saveLibraryBooks = vi.fn().mockResolvedValue(undefined);
      const envConfig = makeEnvConfig({ saveBookConfig, saveLibraryBooks });

      useLibraryStore.getState().setLibrary([makeLibraryBook({ hash: 'h1' })]);

      const data = makeBookData('nonexistent', { progress: [1, 100] });
      useBookDataStore.setState({ booksData: { nonexistent: data } });

      await useBookDataStore
        .getState()
        .saveConfig(envConfig, 'nonexistent', data.config!, FAKE_SETTINGS);

      expect(saveBookConfig).not.toHaveBeenCalled();
      expect(saveLibraryBooks).not.toHaveBeenCalled();
    });
  });
});
