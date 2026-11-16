// @vitest-environment node
// An EPUB opened before restores what its first open parsed (the container, package and
// navigation documents) from the snapshot kept with the book, instead of parsing them again.
import { beforeEach, describe, expect, test, vi } from 'vitest';

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
vi.mock('@/services/nav', () => ({
  updateToc: vi.fn(),
  computeBookNav: vi.fn(async () => ({})),
  hydrateBookNav: vi.fn(),
  isBookNavCacheCurrent: () => false,
}));
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

const epub = { hash: 'h1', format: 'EPUB', title: 'Dune Messiah' };

const open = async ({
  book = epub as object,
  stored = null as string | null,
  parsed = undefined as string | undefined,
} = {}) => {
  vi.mocked(DocumentLoader).mockImplementation(function () {
    const bookDoc = { metadata: { title: 'Dune Messiah' }, sections: [], toc: [] };
    return { open: async () => ({ book: bookDoc, format: 'EPUB', epubSnapshot: parsed }) };
  } as never);
  vi.mocked(useLibraryStore.getState().getBookByHash).mockReturnValue(book as never);
  const appService = {
    loadBookContent: async () => ({ file: new File(['PK'], 'book.epub') }),
    resolveNativeBookFilePath: async () => null,
    loadBookConfig: async () => ({ viewSettings: {}, updatedAt: 0 }),
    loadBookNav: async () => null,
    saveBookNav: async () => {},
    loadBookCache: vi.fn(async () => stored),
    saveBookCache: vi.fn(async () => {}),
  };
  await useReaderStore
    .getState()
    .initViewState({ getAppService: async () => appService } as never, 'h1', 'h1-1');
  const options = vi.mocked(DocumentLoader).mock.calls.at(-1)?.[1];
  return { appService, options };
};

describe('readerStore and the parsed-EPUB snapshot', () => {
  beforeEach(() => {
    useBookDataStore.setState({ booksData: {} });
    vi.mocked(DocumentLoader).mockClear();
  });

  test('keeps the snapshot of a first open', async () => {
    const { appService, options } = await open({ parsed: '{"version":1}' });
    expect(options?.epubSnapshot).toBeNull();
    expect(appService.saveBookCache).toHaveBeenCalledWith(epub, 'epub.json', '{"version":1}');
  });

  test('restores a kept snapshot, and keeps nothing new', async () => {
    const { appService, options } = await open({ stored: '{"version":1}' });
    expect(appService.loadBookCache).toHaveBeenCalledWith(epub, 'epub.json');
    expect(options?.epubSnapshot).toBe('{"version":1}');
    expect(appService.saveBookCache).not.toHaveBeenCalled();
  });

  // The server can replace an Audiobookshelf item's file under the same abs:// path.
  test('neither restores nor keeps one for an Audiobookshelf ebook', async () => {
    const ebook = {
      ...epub,
      format: 'ABS',
      metadata: { title: 'Dune Messiah', absMediaType: 'ebook' },
    };
    const { appService, options } = await open({
      book: ebook,
      stored: '{"version":1}',
      parsed: '{"version":1}',
    });
    expect(appService.loadBookCache).not.toHaveBeenCalled();
    expect(options?.epubSnapshot).toBeUndefined();
    expect(appService.saveBookCache).not.toHaveBeenCalled();
  });
});
