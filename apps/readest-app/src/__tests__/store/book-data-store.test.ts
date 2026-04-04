import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@/utils/md5', () => ({
  md5Fingerprint: (value: string) => `md5_${value}`,
}));

import { useBookDataStore } from '@/store/bookDataStore';
import type { BookData } from '@/store/bookDataStore';
import type { BookConfig, BookNote } from '@/types/book';

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
});
