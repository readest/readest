import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
  isWebAppPlatform: () => false,
}));

import { saveBookMetadataEdit } from '@/services/bookMetadataEdit';
import { useLibraryStore } from '@/store/libraryStore';
import { useBookDataStore } from '@/store/bookDataStore';
import type { Book } from '@/types/book';
import type { BookMetadata } from '@/libs/document';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';

const makeBook = (overrides: Partial<Book> = {}): Book => ({
  hash: 'h1',
  format: 'EPUB',
  title: 'Old Title',
  author: 'Author',
  tags: ['obsidian-pending'],
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

const metadata: BookMetadata = { title: 'New Title', author: 'Author', language: 'en' };

describe('saveBookMetadataEdit (#6584)', () => {
  let appService: Partial<AppService>;
  let envConfig: EnvConfigType;

  beforeEach(() => {
    appService = {
      saveLibraryBooks: vi.fn().mockResolvedValue(undefined),
      updateCoverImage: vi.fn().mockResolvedValue(undefined),
      computeCoverHash: vi.fn().mockResolvedValue(null),
    };
    envConfig = { getAppService: vi.fn().mockResolvedValue(appService as AppService) };
    useLibraryStore.getState().setLibrary([makeBook()]);
    useBookDataStore.setState({ booksData: {} });
  });

  test('persists the edited tags and metadata to the library', async () => {
    await saveBookMetadataEdit(envConfig, makeBook(), { ...metadata }, ['read'], false);

    const saved = useLibraryStore.getState().library[0]!;
    expect(saved.tags).toEqual(['read']);
    expect(saved.title).toBe('New Title');
    expect(appService.saveLibraryBooks).toHaveBeenCalledWith([saved]);
  });

  test('edits the library entry, not the stale snapshot the reader holds', async () => {
    useLibraryStore.getState().setLibrary([makeBook({ updatedAt: 500, readingStatus: 'reading' })]);

    await saveBookMetadataEdit(envConfig, makeBook(), { ...metadata }, [], false);

    const saved = useLibraryStore.getState().library[0]!;
    expect(saved.updatedAt).toBe(500);
    expect(saved.readingStatus).toBe('reading');
  });

  test('refreshes the book held by an open reader', async () => {
    useBookDataStore.setState({
      booksData: {
        h1: {
          id: 'h1',
          book: makeBook(),
          file: null,
          config: null,
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });

    await saveBookMetadataEdit(envConfig, makeBook(), { ...metadata }, ['read'], false);

    const readerBook = useBookDataStore.getState().getBookData('h1')!.book!;
    expect(readerBook.tags).toEqual(['read']);
    expect(readerBook.title).toBe('New Title');
  });
});
