// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isEink: true,
  isSideBarVisible: true,
  isNotebookVisible: true,
  updateAppTheme: vi.fn(),
}));

vi.mock('@/store/bookDataStore', async () => {
  const { bookDataStoreHooks } = await import('@/__tests__/helpers/book-data-store-mock');
  const bookDoc = { metadata: { language: 'en' } };
  const state = {
    getBookData: () => ({ book: { title: 'Book' }, bookDoc }),
    getConfig: () => ({ booknotes: [], viewSettings: { sideBarTab: 'toc' } }),
    updateBooknotes: vi.fn(),
    saveConfig: vi.fn(),
  };
  return bookDataStoreHooks((selector?: (store: typeof state) => unknown) =>
    selector ? selector(state) : state,
  );
});

vi.mock('@/store/readerStore', () => {
  // One store object, so its getters keep their identity across renders the
  // way zustand's do.
  const store = {
    getView: () => ({ clearSearch: vi.fn() }),
    getViewSettings: () => ({ isEink: h.isEink, rtl: false }),
  };
  return { useReaderStore: () => store };
});

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { sideBarWidth: '25%', isSideBarPinned: false } },
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    sideBarBookKey: 'book-1',
    setSideBarBookKey: vi.fn(),
    getSearchNavState: () => null,
    setSearchTerm: vi.fn(),
    clearSearch: vi.fn(),
    isSearchBarVisible: false,
    setSearchBarVisible: vi.fn(),
    setSideBarVisible: vi.fn(),
    clearBooknotesNav: vi.fn(),
  }),
}));

vi.mock('@/app/reader/hooks/useSidebar', () => ({
  default: () => ({
    sideBarWidth: '25%',
    isSideBarPinned: false,
    isSideBarVisible: h.isSideBarVisible,
    getSideBarWidth: () => '25%',
    setSideBarVisible: vi.fn(),
    handleSideBarResize: vi.fn(),
    handleSideBarTogglePin: vi.fn(),
  }),
}));

vi.mock('@/store/notebookStore', () => ({
  NotebookTab: {},
  useNotebookStore: () => ({
    notebookWidth: '25%',
    isNotebookVisible: h.isNotebookVisible,
    isNotebookPinned: false,
    notebookActiveTab: 'notes',
    getNotebookWidth: () => '25%',
    setNotebookWidth: vi.fn(),
    setNotebookVisible: vi.fn(),
    setNotebookPin: vi.fn(),
    toggleNotebookPin: vi.fn(),
    setNotebookActiveTab: vi.fn(),
  }),
}));

vi.mock('@/store/aiChatStore', () => ({
  useAIChatStore: () => ({ activeConversationId: null }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    updateAppTheme: h.updateAppTheme,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    systemUIVisible: false,
    statusBarHeight: 0,
    isIPhoneDuo: false,
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: {} }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));
vi.mock('@/hooks/useSwipeToDismiss', () => {
  // Refs keep their identity across renders, as useRef's do.
  const swipe = {
    panelRef: { current: null },
    overlayRef: { current: null },
    panelHeight: { current: 0 },
    handleVerticalDragStart: vi.fn(),
  };
  return { useSwipeToDismiss: () => swipe };
});
vi.mock('@/hooks/usePanelResize', () => ({
  usePanelResize: () => ({ handleResizeStart: vi.fn(), handleResizeKeyDown: vi.fn() }),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
  useDefaultIconSize: () => 20,
}));
vi.mock('@/hooks/useShortcuts', () => ({ default: vi.fn() }));
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
vi.mock('@/app/reader/components/notebook/NotebookTabNavigation', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/AIAssistant', () => ({ default: () => null }));

import SideBar from '@/app/reader/components/sidebar/SideBar';
import Notebook from '@/app/reader/components/notebook/Notebook';

beforeEach(() => {
  h.isEink = true;
  h.isSideBarVisible = true;
  h.isNotebookVisible = true;
  h.updateAppTheme.mockClear();
});

afterEach(cleanup);

describe('Reader SideBar and Notebook e-ink app theme sync', () => {
  it('uses base-100 instead of base-200 when SideBar opens in e-ink mode', () => {
    render(<SideBar />);
    expect(h.updateAppTheme).toHaveBeenCalledWith('base-100');
    expect(h.updateAppTheme).not.toHaveBeenCalledWith('base-200');
  });

  it('uses base-200 when SideBar opens outside e-ink mode', () => {
    h.isEink = false;
    render(<SideBar />);
    expect(h.updateAppTheme).toHaveBeenCalledWith('base-200');
  });

  it('uses base-100 instead of base-200 when Notebook opens in e-ink mode', () => {
    render(<Notebook />);
    expect(h.updateAppTheme).toHaveBeenCalledWith('base-100');
    expect(h.updateAppTheme).not.toHaveBeenCalledWith('base-200');
  });

  it('uses base-200 when Notebook opens outside e-ink mode', () => {
    h.isEink = false;
    render(<Notebook />);
    expect(h.updateAppTheme).toHaveBeenCalledWith('base-200');
  });

  it('follows an e-ink change while SideBar stays open', () => {
    h.isEink = false;
    const { rerender } = render(<SideBar />);
    expect(h.updateAppTheme).toHaveBeenLastCalledWith('base-200');
    h.isEink = true;
    rerender(<SideBar />);
    expect(h.updateAppTheme).toHaveBeenLastCalledWith('base-100');
  });

  it('keeps the open SideBar color when e-ink changes with Notebook hidden', () => {
    h.isNotebookVisible = false;
    // ReaderContent mounts SideBar before Notebook, so Notebook's effects run last.
    const panels = () => (
      <>
        <SideBar />
        <Notebook />
      </>
    );
    const { rerender } = render(panels());
    h.isEink = false;
    rerender(panels());
    expect(h.updateAppTheme).toHaveBeenLastCalledWith('base-200');
  });

  it('follows an e-ink change while Notebook stays open', () => {
    h.isEink = false;
    const { rerender } = render(<Notebook />);
    expect(h.updateAppTheme).toHaveBeenLastCalledWith('base-200');
    h.isEink = true;
    rerender(<Notebook />);
    expect(h.updateAppTheme).toHaveBeenLastCalledWith('base-100');
  });
});
