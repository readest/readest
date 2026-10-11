// A book streamed from Audiobookshelf keeps `format: 'ABS'` in the library, so
// the reader store records the format the document parsed as next to bookDoc.
import { beforeEach, describe, expect, test, vi } from 'vitest';

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

const open = async () => {
  vi.mocked(DocumentLoader).mockImplementation(function () {
    const bookDoc = { metadata: { title: 'Streamed' }, sections: [], toc: [] };
    return { open: async () => ({ book: bookDoc, format: 'EPUB' }) };
  } as never);
  vi.mocked(useLibraryStore.getState().getBookByHash).mockReturnValue(book as never);
  const appService = {
    loadBookContent: async () => ({ file: new File([], 'streamed.epub') }),
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
});
