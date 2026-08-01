import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SearchBar from '@/app/reader/components/sidebar/SearchBar';

const mocks = vi.hoisted(() => ({
  // getProgress returns null until the book emits its first relocate event.
  progress: null as { section: { current: number } } | null,
  searchLibraryBooks: vi.fn(),
  viewSearch: vi.fn(),
  // Stable like the real context value; a fresh object per render would
  // re-fire the [appService, isVisible] effect and double the search.
  appService: { deleteDir: vi.fn().mockResolvedValue(undefined) },
}));

// Reader search runs on the shared per-book search.db service; the view only
// replays resolved results for highlighting.
vi.mock('@/services/librarySearchService', () => ({
  createLibrarySearchSession: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
  resolveSearchResultCfis: vi.fn(async () => []),
  searchLibraryBooks: mocks.searchLibraryBooks,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: mocks.appService }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: { hash: 'book-hash', primaryLanguage: 'en' } }),
    getConfig: () => ({ searchConfig: { scope: 'section', mode: 'contains' } }),
    setConfig: vi.fn(),
    saveConfig: vi.fn(),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ search: mocks.viewSearch, clearSearch: vi.fn() }),
    getProgress: () => mocks.progress,
    getViewSettings: () => ({}),
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    setSearchTerm: vi.fn(),
    setSearchResults: vi.fn(),
    setSearchProgress: vi.fn(),
    setSearchError: vi.fn(),
    setSearchStatus: vi.fn(),
    getSearchStatus: () => 'searching',
    getSearchNavState: () => ({ searchTerm: 'alice', searchError: null }),
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

describe('SearchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.searchLibraryBooks.mockReset();
    mocks.searchLibraryBooks.mockImplementation(async function* () {
      yield { type: 'book-completed', book: { hash: 'book-hash' }, matchCount: 0 };
    });
    mocks.viewSearch.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderBar = async () => {
    render(<SearchBar isVisible bookKey='book-1' onHideSearchBar={vi.fn()} />);
    // The search term change is debounced by 500ms before handleSearch runs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
  };

  // A section-scoped search fired before the first relocate event used to
  // destructure `section` off a null progress and throw, so the search never
  // reached the service.
  it('searches the whole book when progress is not available yet', async () => {
    mocks.progress = null;
    await renderBar();

    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);
    const [, books, query, options] = mocks.searchLibraryBooks.mock.calls[0]!;
    expect(books).toMatchObject([{ hash: 'book-hash' }]);
    expect(query).toBe('alice');
    expect(options.sectionIndex).toBeUndefined();
  });

  it('scopes the search to the current section once progress is available', async () => {
    mocks.progress = { section: { current: 4 } };
    await renderBar();

    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);
    expect(mocks.searchLibraryBooks.mock.calls[0]![3].sectionIndex).toBe(4);
  });
});
