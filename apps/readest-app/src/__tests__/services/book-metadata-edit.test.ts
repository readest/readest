// @vitest-environment node
import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
  isWebAppPlatform: () => false,
}));

import { saveBookMetadataEdit, saveKOSyncFilename } from '@/services/bookMetadataEdit';
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

describe('saveKOSyncFilename (#7864)', () => {
  let appService: Partial<AppService>;
  let envConfig: EnvConfigType;
  const readerBook = makeBook({ metadata: { ...metadata, title: 'Reader Title' } });

  beforeEach(() => {
    appService = { saveLibraryBooks: vi.fn().mockResolvedValue(undefined) };
    envConfig = { getAppService: vi.fn().mockResolvedValue(appService as AppService) };
    useLibraryStore
      .getState()
      .setLibrary([makeBook({ metadata: { ...metadata }, updatedAt: 500 })]);
    useBookDataStore.setState({
      booksData: {
        h1: {
          id: 'h1',
          book: readerBook,
          file: null,
          config: null,
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });
  });

  test('stores the name in the synced metadata of the library and the open reader', async () => {
    await saveKOSyncFilename(envConfig, readerBook, 'Author - New Title.epub');

    const saved = useLibraryStore.getState().library[0]!;
    expect(saved.metadata).toEqual({ ...metadata, kosyncFilename: 'Author - New Title.epub' });
    expect(saved.metadataUpdatedAt).toBeGreaterThan(0);
    expect(saved.updatedAt).toBe(500);
    expect(appService.saveLibraryBooks).toHaveBeenCalledWith([saved]);
    const opened = useBookDataStore.getState().getBookData('h1')!.book!;
    expect(opened.metadata?.kosyncFilename).toBe('Author - New Title.epub');
    expect(opened.metadataUpdatedAt).toBe(saved.metadataUpdatedAt);
  });

  test('the open reader keeps the later of two overlapping saves', async () => {
    let finishFirstWrite!: () => void;
    appService.saveLibraryBooks = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirstWrite = resolve)))
      .mockResolvedValue(undefined);

    const first = saveKOSyncFilename(envConfig, readerBook, 'First.epub');
    const second = saveKOSyncFilename(envConfig, readerBook, 'Second.epub');
    await second;
    finishFirstWrite();
    await first;

    const opened = useBookDataStore.getState().getBookData('h1')!.book!;
    expect(opened.metadata?.kosyncFilename).toBe('Second.epub');
  });

  test('clears the name so the book follows the File Name Format again', async () => {
    await saveKOSyncFilename(envConfig, readerBook, 'Author - New Title.epub');
    await saveKOSyncFilename(envConfig, readerBook, undefined);

    const saved = useLibraryStore.getState().library[0]!;
    expect(saved.metadata).toEqual(metadata);
    expect(useBookDataStore.getState().getBookData('h1')!.book!.metadata).not.toHaveProperty(
      'kosyncFilename',
    );
  });
});
