/**
 * On e-ink the sidebar and notebook are the page's white, so each draws an ink
 * rule on the edge that faces the page (#7817). The sidebar always sits on the
 * left and the notebook on the right, but each takes the book's `dir`, so a
 * logical `border-e`/`border-s` put the rule on the screen edge for an RTL
 * book. Render both for an Arabic RTL book and an English one and check the
 * physical edge.
 */

import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ language: 'ar', rtl: true }));

vi.mock('@/hooks/useShortcuts', () => ({ default: vi.fn() }));
vi.mock('@/app/reader/hooks/useSidebar', () => ({
  default: () => ({
    sideBarWidth: '320px',
    getSideBarWidth: () => '320px',
    setSideBarVisible: vi.fn(),
    handleSideBarResize: vi.fn(),
    handleSideBarTogglePin: vi.fn(),
    isSideBarPinned: true,
    isSideBarVisible: true,
  }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(
    () => ({
      isSearchBarVisible: false,
      sideBarBookKey: 'book-1',
      clearSearch: vi.fn(),
      getSearchNavState: () => ({ searchTerm: '', searchResults: null }),
      setSearchBarVisible: vi.fn(),
      setSearchTerm: vi.fn(),
      setSideBarBookKey: vi.fn(),
      setSideBarVisible: vi.fn(),
      clearBooknotesNav: vi.fn(),
    }),
    { getState: () => ({ sideBarBookKey: 'book-1' }) },
  ),
}));
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({
    getBookData: () => ({
      book: { title: 'Book' },
      bookDoc: { metadata: { language: h.language }, toc: [] },
    }),
    getConfig: () => ({ viewSettings: { sideBarTab: 'toc' }, booknotes: [] }),
    setConfig: vi.fn(),
    updateBooknotes: vi.fn(),
    saveConfig: vi.fn(),
  })),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ clearSearch: vi.fn() }),
    getViewSettings: () => ({ isEink: true, rtl: h.rtl }),
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: {
        isSideBarPinned: true,
        sideBarWidth: '320px',
        notebookWidth: '320px',
        isNotebookPinned: true,
        notebookActiveTab: 'notes',
      },
    },
  }),
}));
vi.mock('@/store/aiChatStore', () => ({
  useAIChatStore: () => ({ activeConversationId: null }),
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
  useEnv: () => ({ envConfig: {}, appService: {} }),
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
vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
  useDefaultIconSize: () => 20,
}));
vi.mock('@/helpers/settings', () => ({ saveSysSettings: vi.fn() }));
vi.mock('@/app/reader/hooks/useNotebookDocumentCoordinator', () => ({
  flushNotebookDocument: vi.fn(),
  useNotebookDocumentCoordinator: vi.fn(),
}));
vi.mock('@/components/Overlay', () => ({ Overlay: () => null }));
vi.mock('@/app/reader/components/sidebar/Header', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/Content', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/BookCard', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/SearchBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/SearchResults', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/NotebookEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/NotebookTabNavigation', () => ({
  default: () => null,
}));
vi.mock('@/app/reader/components/notebook/AIAssistant', () => ({ default: () => null }));

const { default: SideBar } = await import('@/app/reader/components/sidebar/SideBar');
const { default: Notebook } = await import('@/app/reader/components/notebook/Notebook');
const { useNotebookStore } = await import('@/store/notebookStore');
await import('@/styles/globals.css');

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
});

const edges = (selector: string) => {
  const style = getComputedStyle(document.querySelector(selector)!);
  return { left: style.borderLeftWidth, right: style.borderRightWidth };
};

const renderPanels = () => {
  document.documentElement.setAttribute('data-eink', 'true');
  render(
    <div className='flex' style={{ width: 1200, height: 600 }}>
      <SideBar />
      <div className='flex-1' />
      <Notebook />
    </div>,
  );
  act(() => {
    useNotebookStore.setState({ isNotebookVisible: true, isNotebookPinned: true });
  });
};

describe.each([
  { book: 'an Arabic RTL book', language: 'ar', rtl: true },
  { book: 'an English book', language: 'en', rtl: false },
])('e-ink panel edge for $book', ({ language, rtl }) => {
  it('rules the sidebar on its right edge and the notebook on its left', () => {
    h.language = language;
    h.rtl = rtl;
    renderPanels();

    expect(edges('.sidebar-container')).toEqual({ left: '0px', right: '1px' });
    expect(edges('.notebook-container')).toEqual({ left: '1px', right: '0px' });
  });
});
