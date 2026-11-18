// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { eventDispatcher } from '@/utils/event';

const h = vi.hoisted(() => ({
  actions: null as null | Record<string, () => boolean>,
  clearSearch: vi.fn(),
  clearViewSearch: vi.fn(),
  setSearchBarVisible: vi.fn(),
  setSideBarVisible: vi.fn(),
  sidebar: {
    isSearchBarVisible: true,
    sideBarBookKey: 'book-1',
  },
  sidebarHook: {
    isSideBarPinned: false,
    isSideBarVisible: true,
  },
  searchNav: { searchTerm: '', searchResults: null } as {
    searchTerm: string;
    searchResults: unknown[] | null;
  },
}));

vi.mock('@/hooks/useShortcuts', () => ({
  default: (actions: Record<string, () => boolean>) => {
    h.actions = actions;
  },
}));

vi.mock('@/app/reader/hooks/useSidebar', () => ({
  default: () => ({
    sideBarWidth: '320px',
    getSideBarWidth: () => '320px',
    setSideBarVisible: h.setSideBarVisible,
    handleSideBarResize: vi.fn(),
    handleSideBarTogglePin: vi.fn(),
    ...h.sidebarHook,
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(
    () => ({
      ...h.sidebar,
      clearSearch: h.clearSearch,
      getSearchNavState: () => h.searchNav,
      setSearchBarVisible: h.setSearchBarVisible,
      setSearchTerm: vi.fn(),
      setSideBarBookKey: vi.fn(),
    }),
    // The store snapshot must carry the book key too: handleShowSearchBar
    // reads it via getState() to dispatch the null-term 'search-term' event.
    { getState: () => ({ ...h.sidebarHook, sideBarBookKey: h.sidebar.sideBarBookKey }) },
  ),
}));

vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({
    getBookData: () => ({
      book: { title: 'Book' },
      bookDoc: { metadata: { language: 'en' }, toc: [] },
    }),
    getConfig: () => ({ viewSettings: { sideBarTab: 'toc' } }),
  })),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ clearSearch: h.clearViewSearch }),
    getViewSettings: () => ({ isEink: false, rtl: false }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { isSideBarPinned: false, sideBarWidth: '320px' } },
  }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    updateAppTheme: vi.fn(),
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    systemUIVisible: false,
    statusBarHeight: 0,
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({
    panelRef: { current: null },
    overlayRef: { current: null },
    panelHeight: { current: 0 },
    handleVerticalDragStart: vi.fn(),
  }),
}));

vi.mock('@/hooks/usePanelResize', () => ({
  usePanelResize: () => ({ handleResizeStart: vi.fn(), handleResizeKeyDown: vi.fn() }),
}));

vi.mock('@/components/Overlay', () => ({ Overlay: () => null }));
vi.mock('@/app/reader/components/sidebar/Header', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/Content', () => ({
  default: () => <div data-testid='sidebar-content-panel' />,
}));
vi.mock('@/app/reader/components/sidebar/BookCard', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/SearchBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/SearchResults', () => ({
  default: () => <div data-testid='search-results-panel' />,
}));

import SideBar from '@/app/reader/components/sidebar/SideBar';

describe('SideBar Escape shortcut', () => {
  beforeEach(() => {
    h.actions = null;
    h.sidebar.isSearchBarVisible = true;
    h.sidebar.sideBarBookKey = 'book-1';
    h.sidebarHook.isSideBarPinned = false;
    h.sidebarHook.isSideBarVisible = true;
    h.searchNav = { searchTerm: '', searchResults: null };
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test.each([false, true])('closes an empty search bar before a pinned=%s sidebar', (pinned) => {
    h.sidebarHook.isSideBarPinned = pinned;
    render(<SideBar />);

    const handled = h.actions?.['onEscape']?.();

    expect(handled).toBe(true);
    expect(h.setSearchBarVisible).toHaveBeenCalledWith(false);
    expect(h.setSideBarVisible).not.toHaveBeenCalled();
  });

  test('closes the search bar before checking whether the sidebar is visible', () => {
    h.sidebarHook.isSideBarVisible = false;
    render(<SideBar />);

    const handled = h.actions?.['onEscape']?.();

    expect(handled).toBe(true);
    expect(h.setSearchBarVisible).toHaveBeenCalledWith(false);
    expect(h.setSideBarVisible).not.toHaveBeenCalled();
  });

  test('lets a second Escape close an unpinned sidebar', () => {
    const { rerender } = render(<SideBar />);

    expect(h.actions?.['onEscape']?.()).toBe(true);
    h.sidebar.isSearchBarVisible = false;
    rerender(<SideBar />);
    vi.clearAllMocks();

    expect(h.actions?.['onEscape']?.()).toBe(true);
    expect(h.setSideBarVisible).toHaveBeenCalledWith(false);
  });
});

describe('SideBar search behavior', () => {
  beforeEach(() => {
    h.actions = null;
    h.sidebar.isSearchBarVisible = true;
    h.sidebar.sideBarBookKey = 'book-1';
    h.sidebarHook.isSideBarPinned = false;
    h.sidebarHook.isSideBarVisible = true;
    h.searchNav = { searchTerm: '', searchResults: null };
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // On the iframe-forwarded keydown path this action may be the first (and
  // only) consumer of the Ctrl+F shortcut, so it must emit the same null-term
  // event the book shortcut emits; SearchBar relies on it to re-select the
  // current term.
  test('onShowSearchBar also emits a null-term search-term event', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    render(<SideBar />);

    await act(async () => {
      h.actions!['onShowSearchBar']!();
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(dispatchSpy).toHaveBeenCalledWith('search-term', { term: null, bookKey: 'book-1' });
    expect(h.setSideBarVisible).toHaveBeenCalledWith(true);
    expect(h.setSearchBarVisible).toHaveBeenCalledWith(true);
  });

  // Clearing the field must show the TOC at once: the results are reset to
  // null only after the 500 ms debounce and hold the last search's list until then.
  test('keeps the TOC as soon as the term is emptied', () => {
    h.searchNav = { searchTerm: '', searchResults: [] };
    render(<SideBar />);

    expect(screen.queryByTestId('search-results-panel')).toBeNull();
    expect(screen.getByTestId('sidebar-content-panel')).toBeDefined();
  });

  test('mounts the results panel once a term is set', () => {
    h.searchNav = { searchTerm: 'alice', searchResults: [{ label: 'Chapter' }] };
    render(<SideBar />);

    expect(screen.getByTestId('search-results-panel')).toBeDefined();
    expect(screen.queryByTestId('sidebar-content-panel')).toBeNull();
  });

  // A completed search with no hits must still show the panel, otherwise the
  // "No results found" message would be replaced by the TOC.
  test('keeps the results panel for a completed search with no hits', () => {
    h.searchNav = { searchTerm: 'alice', searchResults: [] };
    render(<SideBar />);

    expect(screen.getByTestId('search-results-panel')).toBeDefined();
    expect(screen.queryByTestId('sidebar-content-panel')).toBeNull();
  });

  test('keeps the TOC before any search has run at all', () => {
    h.searchNav = { searchTerm: '', searchResults: null };
    render(<SideBar />);

    expect(screen.queryByTestId('search-results-panel')).toBeNull();
    expect(screen.getByTestId('sidebar-content-panel')).toBeDefined();
  });
});
