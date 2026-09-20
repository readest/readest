// The wide pages of a comic (double-page spreads laid out on their own) are
// cached in the book config: an open that finds them saves measuring them on
// the next, and a streamed comic, which can only measure a page as it loads,
// keeps what earlier reading found.
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { BookConfig } from '@/types/book';
import type { DocumentLoaderOptions } from '@/libs/document';

vi.mock('@/store/bookDataStore', async () => {
  const { create } = await import('zustand');
  type Data = { config: Partial<BookConfig> };
  return {
    useBookDataStore: create<{
      booksData: Record<string, Data>;
      setConfig: (key: string, config: Partial<BookConfig>) => void;
    }>((set) => ({
      booksData: {},
      setConfig: (key, config) =>
        set((state) => {
          const id = key.split('-')[0]!;
          const data = state.booksData[id];
          if (!data) return state;
          return {
            booksData: {
              ...state.booksData,
              [id]: { ...data, config: { ...data.config, ...config } },
            },
          };
        }),
    })),
  };
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

const book = { hash: 'comic', format: 'CBZ', title: 'Comic' };

// Opens the comic with `cached` in its config; the loader finds page a wide.
const open = async (cached?: string[]) => {
  let options: DocumentLoaderOptions = {};
  vi.mocked(DocumentLoader).mockImplementation(function (_file: File, opts: DocumentLoaderOptions) {
    options = opts;
    const sections = [{ id: 'a.jpg', pageSpread: 'center' }, { id: 'b.jpg' }];
    const bookDoc = {
      metadata: { title: 'Comic' },
      rendition: { layout: 'pre-paginated' },
      sections,
    };
    return { open: async () => ({ book: bookDoc, format: 'CBZ' }) };
  } as never);
  vi.mocked(useLibraryStore.getState().getBookByHash).mockReturnValue(book as never);
  const appService = {
    loadBookContent: async () => ({ file: new File([], 'comic.cbz') }),
    resolveNativeBookFilePath: async () => '/books/comic.cbz',
    loadBookConfig: async () => ({ widePages: cached, viewSettings: {}, updatedAt: 0 }),
  };
  await useReaderStore
    .getState()
    .initViewState({ getAppService: async () => appService } as never, 'comic', 'comic-1');
  return options;
};

const cachedWidePages = () =>
  (useBookDataStore.getState().booksData as Record<string, { config: BookConfig }>)['comic']!.config
    .widePages;

describe('readerStore caches the wide pages of a comic', () => {
  beforeEach(() => useBookDataStore.setState({ booksData: {} }));

  test('hands the cached pages to the loader', async () => {
    const options = await open(['a.jpg']);
    expect(options.widePages?.known).toEqual(['a.jpg']);
  });

  test('caches the pages an open measured', async () => {
    const options = await open();
    expect(options.widePages?.known).toBeUndefined();
    expect(cachedWidePages()).toEqual(['a.jpg']);
  });

  test('caches a page found wide while reading', async () => {
    const options = await open();
    options.widePages?.onFound?.(['a.jpg', 'b.jpg']);
    expect(cachedWidePages()).toEqual(['a.jpg', 'b.jpg']);
  });
});
