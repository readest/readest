import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { BookData } from '@/store/bookDataStore';
import { buildFeedBookUrl } from '@/services/rss/feedBookUrl';

const mocks = vi.hoisted(() => ({
  computeBookNav: vi.fn(),
  hydrateBookNav: vi.fn((bookDoc, nav) => {
    bookDoc.toc = nav.toc;
  }),
  isBookNavCacheCurrent: vi.fn((nav) => nav !== null),
  openFeedBookDoc: vi.fn(),
}));

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
  computeBookNav: mocks.computeBookNav,
  hydrateBookNav: mocks.hydrateBookNav,
  isBookNavCacheCurrent: mocks.isBookNavCacheCurrent,
  updateToc: vi.fn(),
}));
vi.mock('@/utils/book', () => ({
  formatTitle: vi.fn((title: string) => title),
  getMetadataHash: vi.fn(() => 'hash'),
  getPrimaryLanguage: vi.fn(() => 'en'),
}));
vi.mock('@/utils/path', () => ({ getBaseFilename: vi.fn((name: string) => name) }));
vi.mock('@/services/constants', () => ({ SUPPORTED_LANGNAMES: {} }));
vi.mock('@/libs/document', () => ({ DocumentLoader: vi.fn() }));
vi.mock('@/services/opds/pseStream', () => ({
  isPseStreamFileName: () => false,
  openPseStreamBook: vi.fn(),
  parsePseStreamFileName: vi.fn(),
}));
vi.mock('@/services/rss/feedReader', () => ({ openFeedBookDoc: mocks.openFeedBookDoc }));

import { DocumentLoader } from '@/libs/document';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';

const book = {
  hash: 'feed',
  format: 'EPUB',
  title: 'Feed',
  url: buildFeedBookUrl('https://example.com/feed.xml'),
};
const regularBook = { hash: 'epub', format: 'EPUB', title: 'EPUB' };
const freshNav = {
  version: 4,
  toc: [{ label: 'Fresh article', href: 'fresh.xhtml' }],
  sections: {},
};
const cachedNav = {
  version: 4,
  toc: [{ label: 'Stale article', href: 'stale.xhtml' }],
  sections: {},
};

const open = async (id = 'feed') => {
  const appService = {
    loadBookConfig: vi.fn(async () => ({ viewSettings: {}, updatedAt: 0 })),
    loadBookContent: vi.fn(async () => ({ file: new File([], 'book.epub') })),
    loadBookNav: vi.fn(async () => cachedNav),
    resolveNativeBookFilePath: vi.fn(async () => null),
    saveBookNav: vi.fn(),
  };
  await useReaderStore
    .getState()
    .initViewState({ getAppService: async () => appService } as never, id, `${id}-1`);
  return appService;
};

const bookData = (id = 'feed') =>
  (useBookDataStore.getState().booksData as Record<string, BookData>)[id]!;

describe('readerStore feed book navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    useBookDataStore.setState({ booksData: {} });
    vi.mocked(useLibraryStore.getState().getBookByHash).mockReturnValue(book as never);
    mocks.openFeedBookDoc.mockResolvedValue({
      metadata: { title: 'Feed' },
      rendition: { layout: 'reflowable' },
      sections: [],
      toc: [{ label: 'Fresh article', href: 'fresh.xhtml' }],
    });
    mocks.computeBookNav.mockResolvedValue(freshNav);
  });

  afterEach(() => vi.unstubAllEnvs());

  test('rebuilds navigation instead of using or saving a current cached feed nav', async () => {
    const appService = await open();

    expect(appService.loadBookNav).not.toHaveBeenCalled();
    expect(mocks.computeBookNav).toHaveBeenCalled();
    expect(bookData().bookDoc?.toc).toEqual(freshNav.toc);
    expect(appService.saveBookNav).not.toHaveBeenCalled();
  });

  test('uses the current nav cache for a regular EPUB', async () => {
    vi.mocked(useLibraryStore.getState().getBookByHash).mockReturnValue(regularBook as never);
    vi.mocked(DocumentLoader).mockImplementation(function () {
      return {
        open: async () => ({
          book: {
            metadata: { title: 'EPUB' },
            rendition: { layout: 'reflowable' },
            sections: [],
            toc: freshNav.toc,
          },
          format: 'EPUB',
        }),
      };
    } as never);

    const appService = await open('epub');

    expect(appService.loadBookNav).toHaveBeenCalledWith(regularBook);
    expect(mocks.computeBookNav).not.toHaveBeenCalled();
    expect(bookData('epub').bookDoc?.toc).toEqual(cachedNav.toc);
    expect(appService.saveBookNav).not.toHaveBeenCalled();
  });
});
