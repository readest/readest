// A book streamed from Audiobookshelf keeps `format: 'ABS'` in the library, so
// the reader store records the format the document parsed as next to bookDoc.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { md5 } from 'js-md5';

import type { BookData } from '@/store/bookDataStore';

vi.mock('@/store/bookDataStore', async () => {
  const { create } = await import('zustand');
  return { useBookDataStore: create(() => ({ booksData: {} })) };
});
vi.mock('@/store/settingsStore', () => {
  const { create } = require('zustand');
  return { useSettingsStore: create(() => ({ settings: {} })) };
});
vi.mock('@/store/libraryStore', () => {
  const { create } = require('zustand');
  return { useLibraryStore: create(() => ({ library: [], getBookByHash: vi.fn() })) };
});
vi.mock('@/utils/misc', () => ({ uniqueId: vi.fn(() => 'uid') }));
vi.mock('@/services/nav', () => ({ updateToc: vi.fn() }));
vi.mock('@/utils/book', () => ({
  formatTitle: vi.fn((t: string) => t),
  getMetadataHash: vi.fn(() => 'hash'),
  getPrimaryLanguage: vi.fn(() => 'en'),
}));
vi.mock('@/utils/path', () => ({ getBaseFilename: vi.fn((n: string) => n) }));
vi.mock('@/services/constants', () => ({ SUPPORTED_LANGNAMES: {} }));
vi.mock('@/libs/document', () => ({ DocumentLoader: vi.fn() }));
vi.mock('@/services/opds/pseStream', () => ({
  isPseStreamFileName: () => false,
  openPseStreamBook: vi.fn(),
  parsePseStreamFileName: vi.fn(),
}));
vi.mock('@/services/rss/feedBookUrl', () => ({ isFeedBookUrl: () => false }));
vi.mock('@/services/rss/feedReader', () => ({ openFeedBookDoc: vi.fn() }));

import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { DocumentLoader } from '@/libs/document';

const book = { hash: 'stub', format: 'ABS', title: 'Streamed' };

const open = async (libraryBook: object = book, file = new File([], 'streamed.epub')) => {
  vi.mocked(DocumentLoader).mockImplementation(function () {
    const bookDoc = { metadata: { title: 'Streamed' }, sections: [], toc: [] };
    return { open: async () => ({ book: bookDoc, format: 'EPUB' }) };
  } as never);
  vi.mocked(useLibraryStore.getState().getBookByHash).mockReturnValue(libraryBook as never);
  const appService = {
    loadBookContent: async () => ({ file }),
    resolveNativeBookFilePath: async () => null,
    loadBookConfig: async () => ({ viewSettings: {}, updatedAt: 0 }),
  };
  await useReaderStore
    .getState()
    .initViewState({ getAppService: async () => appService } as never, 'stub', 'stub-1');
};

const bookData = () => (useBookDataStore.getState().booksData as Record<string, BookData>)['stub']!;

describe('readerStore records the parsed document format', () => {
  beforeEach(() => useBookDataStore.setState({ booksData: {} }));

  test('keeps the parsed format when the library entry is an Audiobookshelf stub', async () => {
    await open();
    expect(bookData().book?.format).toBe('ABS');
    expect(bookData().docFormat).toBe('EPUB');
  });

  test('carries it over when a cached document is reused', async () => {
    await open();
    vi.mocked(DocumentLoader).mockClear();
    await open();
    expect(DocumentLoader).not.toHaveBeenCalled();
    expect(bookData().docFormat).toBe('EPUB');
  });

  // KOReader Sync needs the id KOReader computes for the same file (#7088).
  test("keeps an Audiobookshelf ebook's partial MD5 with the book", async () => {
    // A file under 1 KiB is a single partialMD5 chunk: the md5 of all of it.
    const bytes = 'PK epub bytes';
    const ebook = { ...book, metadata: { title: 'Streamed', absMediaType: 'ebook' } };
    await open(ebook, new File([bytes], 'streamed.epub'));
    expect(bookData().book?.metadata?.absFileHash).toBe(md5(bytes));
  });
});
