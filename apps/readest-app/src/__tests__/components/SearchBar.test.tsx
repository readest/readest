// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SearchBar from '@/app/reader/components/sidebar/SearchBar';
import { eventDispatcher } from '@/utils/event';

const mocks = vi.hoisted(() => ({
  // getProgress returns null until the book emits its first relocate event.
  progress: null as { section: { current: number } } | null,
  searchTerm: 'alice',
  searchLibraryBooks: vi.fn(),
  viewSearch: vi.fn(),
  viewAvailable: true,
  setSearchResults: vi.fn(),
  setSearchError: vi.fn(),
  resolveSearchResultCfis: vi.fn(),
  // Stable like the real context value; a fresh object per render would
  // re-fire the [appService, isVisible] effect and double the search.
  appService: { deleteDir: vi.fn().mockResolvedValue(undefined) },
}));

// Reader search runs on the shared per-book search.db service; the view only
// replays resolved results for highlighting.
vi.mock('@/services/librarySearchService', () => ({
  createLibrarySearchSession: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
  resolveSearchResultCfis: mocks.resolveSearchResultCfis,
  searchLibraryBooks: mocks.searchLibraryBooks,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: mocks.appService }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({
    getBookData: () => ({ book: { hash: 'book-hash', primaryLanguage: 'en' } }),
    getConfig: () => ({ searchConfig: { scope: 'section', mode: 'contains' } }),
    setConfig: vi.fn(),
    saveConfig: vi.fn(),
  })),
}));

vi.mock('@/store/readerProgressStore', () => ({
  getBookProgress: () => mocks.progress,
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () =>
      mocks.viewAvailable ? { search: mocks.viewSearch, clearSearch: vi.fn() } : null,
    getViewSettings: () => ({}),
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    setSearchTerm: vi.fn(),
    setSearchResults: mocks.setSearchResults,
    setSearchProgress: vi.fn(),
    setSearchError: mocks.setSearchError,
    setSearchStatus: vi.fn(),
    getSearchStatus: () => 'searching',
    getSearchNavState: () => ({ searchTerm: mocks.searchTerm, searchError: null }),
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
    mocks.viewAvailable = true;
    mocks.searchTerm = 'alice';
    mocks.searchLibraryBooks.mockReset();
    mocks.searchLibraryBooks.mockImplementation(async function* () {
      yield { type: 'book-completed', book: { hash: 'book-hash' }, matchCount: 0 };
    });
    mocks.viewSearch.mockReset();
    mocks.viewSearch.mockImplementation(async function* () {
      yield 'done';
    });
    mocks.setSearchResults.mockClear();
    mocks.setSearchError.mockClear();
    mocks.resolveSearchResultCfis.mockReset().mockResolvedValue([]);
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

  it('searches without a mounted reader view', async () => {
    mocks.viewAvailable = false;
    await renderBar();
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);
    expect(mocks.viewSearch).not.toHaveBeenCalled();
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
  ])('keeps results when view availability changes from %s to %s', async (initial, final) => {
    mocks.viewAvailable = initial;
    mocks.resolveSearchResultCfis.mockResolvedValue([{ cfi: 'test-cfi' }]);
    mocks.searchLibraryBooks.mockImplementation(async function* () {
      yield {
        type: 'result',
        result: { index: 0, label: 'Chapter', subitems: [{ locator: {}, excerpt: 'Match' }] },
      };
      mocks.viewAvailable = final;
      yield { type: 'book-completed', book: { hash: 'book-hash' }, matchCount: 1 };
    });

    await renderBar();

    expect(mocks.setSearchResults).toHaveBeenLastCalledWith('book-1', [
      { index: 0, label: 'Chapter', subitems: [{ cfi: 'test-cfi', excerpt: 'Match' }] },
    ]);
    expect(mocks.viewSearch).toHaveBeenCalledTimes(final ? 1 : 0);
    expect(mocks.setSearchError).toHaveBeenLastCalledWith('book-1', null);
  });

  // Every publish re-renders the reader and the results list, which redo work
  // over all results so far; publishing each chapter's results as it arrived
  // made a repeated search in a long book take minutes (#7584).
  it('publishes chapters that arrive together in one update', async () => {
    mocks.resolveSearchResultCfis.mockImplementation(async (_s, _b, locators: unknown[]) =>
      locators.map((_, i) => ({ cfi: `cfi-${i}` })),
    );
    mocks.searchLibraryBooks.mockImplementation(async function* () {
      for (let index = 0; index < 50; index++) {
        yield { type: 'progress', bookProgress: index / 50 };
        yield {
          type: 'result',
          result: { index, label: `Chapter ${index}`, subitems: [{ locator: {}, excerpt: 'm' }] },
        };
      }
      yield { type: 'progress', bookProgress: 1 };
      yield { type: 'book-completed', book: { hash: 'book-hash' }, matchCount: 50 };
    });

    await renderBar();

    expect(mocks.setSearchResults.mock.calls.length).toBeLessThanOrEqual(3);
    expect(mocks.setSearchResults.mock.lastCall![1]).toHaveLength(50);
  });

  // A hit held back by the interval must not wait for the next chapter, which
  // can take seconds to search.
  it('shows a held-back hit when the interval ends, before the search completes', async () => {
    let finish!: () => void;
    const nextChapter = new Promise<void>((resolve) => (finish = resolve));
    mocks.resolveSearchResultCfis.mockResolvedValue([{ cfi: 'cfi-0' }]);
    mocks.searchLibraryBooks.mockImplementation(async function* () {
      yield { type: 'progress', bookProgress: 0.5 };
      yield {
        type: 'result',
        result: { index: 0, label: 'Chapter 0', subitems: [{ locator: {}, excerpt: 'm' }] },
      };
      await nextChapter;
      yield { type: 'book-completed', book: { hash: 'book-hash' }, matchCount: 1 };
    });

    await renderBar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mocks.setSearchResults).toHaveBeenCalledWith('book-1', [
      { index: 0, label: 'Chapter 0', subitems: [{ cfi: 'cfi-0', excerpt: 'm' }] },
    ]);

    finish();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mocks.setSearchResults.mock.lastCall![1]).toHaveLength(1);
  });

  it('drops a held-back hit when the search fails before the interval ends', async () => {
    mocks.resolveSearchResultCfis.mockResolvedValue([{ cfi: 'cfi-0' }]);
    mocks.searchLibraryBooks.mockImplementation(async function* () {
      yield { type: 'progress', bookProgress: 0.5 };
      yield {
        type: 'result',
        result: { index: 0, label: 'Chapter 0', subitems: [{ locator: {}, excerpt: 'm' }] },
      };
      yield { type: 'book-error', book: { hash: 'book-hash' }, error: 'broken' };
    });

    await renderBar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mocks.setSearchResults).toHaveBeenCalledTimes(1);
    expect(mocks.setSearchResults).toHaveBeenLastCalledWith('book-1', []);
  });

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

  // The library scan caps each book at 500 matches; in-book search must not
  // inherit that cap and silently stop at 500 results.
  it('searches the book without a result cap', async () => {
    mocks.progress = null;
    await renderBar();

    expect(mocks.searchLibraryBooks.mock.calls[0]![3].maxResultsPerBook).toBe(Infinity);
  });

  // An empty or too-short term runs no search. Its results must be cleared to
  // null, not []: the sidebar reads an empty array as a finished search and
  // shows "No results found" in place of the table of contents.
  it.each(['', 'x'])('clears the results to null for the term "%s"', async (term) => {
    mocks.searchTerm = term;
    await renderBar();

    expect(mocks.searchLibraryBooks).not.toHaveBeenCalled();
    expect(mocks.setSearchResults).toHaveBeenLastCalledWith('book-1', null);
  });

  // Repeated Ctrl+F must let typing replace the old term instead of
  // appending to it, on every path that re-opens the search bar. Both tests
  // park the caret at the end of the term first so the full-selection
  // assertion can only pass through the re-select handlers.
  it('re-selects the term when the bar is re-opened via a null-term search-term event', async () => {
    await renderBar();
    const input = document.querySelector('input.search-input') as HTMLInputElement;
    expect(input.value).toBe('alice');
    input.blur();
    input.setSelectionRange(input.value.length, input.value.length);

    await act(async () => {
      eventDispatcher.dispatch('search-term', { term: null, bookKey: 'book-1' });
    });

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('re-selects the term when Ctrl+F is pressed while the input is focused', async () => {
    await renderBar();
    const input = document.querySelector('input.search-input') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          code: 'KeyF',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  // In the field only the standard Find chord re-selects: a rebound Search in
  // Book key may be a character typed into the field, which is also why the
  // shortcut layer skips text fields.
  it('re-selects on Ctrl+F in the field but types a rebound printable key', async () => {
    localStorage.setItem('customShortcuts', JSON.stringify({ onShowSearchBar: ['x'] }));
    try {
      await renderBar();
      const input = document.querySelector('input.search-input') as HTMLInputElement;
      input.focus();
      const press = async (init: KeyboardEventInit) => {
        input.setSelectionRange(input.value.length, input.value.length);
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        await act(async () => {
          input.dispatchEvent(event);
        });
        return {
          selection: [input.selectionStart, input.selectionEnd],
          prevented: event.defaultPrevented,
        };
      };

      expect(await press({ key: 'x' })).toEqual({ selection: [5, 5], prevented: false });
      expect(await press({ key: 'f', ctrlKey: true })).toEqual({
        selection: [0, 5],
        prevented: true,
      });
    } finally {
      localStorage.removeItem('customShortcuts');
    }
  });

  // Only the exact Find chord re-selects: a chord that adds Shift or Alt is
  // another shortcut and must reach whatever handles it.
  it.each<[string, KeyboardEventInit]>([
    ['Ctrl+Shift+F', { ctrlKey: true, shiftKey: true }],
    ['Cmd+Shift+F', { metaKey: true, shiftKey: true }],
    ['Ctrl+Alt+F', { ctrlKey: true, altKey: true }],
  ])('leaves %s alone in the field', async (_name, modifiers) => {
    await renderBar();
    const input = document.querySelector('input.search-input') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    const event = new KeyboardEvent('keydown', {
      key: modifiers.shiftKey ? 'F' : 'f',
      bubbles: true,
      cancelable: true,
      ...modifiers,
    });
    await act(async () => {
      input.dispatchEvent(event);
    });

    expect([input.selectionStart, input.selectionEnd]).toEqual([5, 5]);
    expect(event.defaultPrevented).toBe(false);
  });
});
