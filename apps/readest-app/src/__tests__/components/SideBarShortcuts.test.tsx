import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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
      getSearchNavState: () => ({ searchTerm: '', searchResults: null }),
      setSearchBarVisible: h.setSearchBarVisible,
      setSearchTerm: vi.fn(),
      setSideBarBookKey: vi.fn(),
    }),
    { getState: () => h.sidebarHook },
  ),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({
      book: { title: 'Book' },
      bookDoc: { metadata: { language: 'en' }, toc: [] },
    }),
    getConfig: () => ({ viewSettings: { sideBarTab: 'toc' } }),
  }),
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
vi.mock('@/app/reader/components/sidebar/Content', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/BookCard', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/SearchBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/SearchResults', () => ({ default: () => null }));

import SideBar from '@/app/reader/components/sidebar/SideBar';

describe('SideBar Escape shortcut', () => {
  beforeEach(() => {
    h.actions = null;
    h.sidebar.isSearchBarVisible = true;
    h.sidebar.sideBarBookKey = 'book-1';
    h.sidebarHook.isSideBarPinned = false;
    h.sidebarHook.isSideBarVisible = true;
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
