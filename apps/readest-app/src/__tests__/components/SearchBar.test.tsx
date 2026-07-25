import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SearchBar from '@/app/reader/components/sidebar/SearchBar';

const mocks = vi.hoisted(() => ({
  // getProgress returns null until the book emits its first relocate event.
  progress: null as { section: { current: number } } | null,
  search: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: { primaryLanguage: 'en' } }),
    getConfig: () => ({ searchConfig: { scope: 'section', mode: 'text' } }),
    setConfig: vi.fn(),
    saveConfig: vi.fn(),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ search: mocks.search, clearSearch: vi.fn() }),
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
    mocks.search.mockReset();
    mocks.search.mockImplementation(async function* () {
      yield 'done';
    });
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
  // reached the view.
  it('searches the whole book when progress is not available yet', async () => {
    mocks.progress = null;
    await renderBar();

    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.search.mock.calls[0]![0]).toMatchObject({ query: 'alice', index: undefined });
  });

  it('scopes the search to the current section once progress is available', async () => {
    mocks.progress = { section: { current: 4 } };
    await renderBar();

    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.search.mock.calls[0]![0]).toMatchObject({ query: 'alice', index: 4 });
  });
});
