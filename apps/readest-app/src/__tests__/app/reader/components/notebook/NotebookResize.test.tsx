// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isMobile: false,
  resize: null as null | ((width: string) => void),
  settings: {
    globalReadSettings: {
      notebookWidth: '30%',
      isNotebookPinned: false,
      notebookActiveTab: 'notes' as const,
    },
  },
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: h.settings }),
}));

vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({
    getBookData: () => ({ bookDoc: { metadata: { language: 'en' } } }),
    getConfig: () => ({ booknotes: [] }),
    setConfig: vi.fn(),
    updateBooknotes: vi.fn(),
    saveConfig: vi.fn(),
  })),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => ({ rtl: false, isEink: false }) }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    sideBarBookKey: 'book-1',
    setSideBarVisible: vi.fn(),
    setSearchBarVisible: vi.fn(),
    clearBooknotesNav: vi.fn(),
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
  useEnv: () => ({ envConfig: {}, appService: { isMobile: h.isMobile } }),
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
  usePanelResize: ({ onResize }: { onResize: (width: string) => void }) => {
    h.resize = onResize;
    return { handleResizeStart: vi.fn(), handleResizeKeyDown: vi.fn() };
  },
}));

vi.mock('@/hooks/useShortcuts', () => ({ default: vi.fn() }));
vi.mock('@/helpers/settings', () => ({ saveSysSettings: vi.fn() }));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/app/reader/hooks/useNotebookDocumentCoordinator', () => ({
  flushNotebookDocument: vi.fn(),
  useNotebookDocumentCoordinator: vi.fn(),
}));
vi.mock('@/components/Overlay', () => ({ Overlay: () => null }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/app/reader/components/notebook/NotebookEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/NotebookTabNavigation', () => ({
  default: () => null,
}));
vi.mock('@/app/reader/components/notebook/AIAssistant', () => ({ default: () => null }));

import { flushNotebookDocument } from '@/app/reader/hooks/useNotebookDocumentCoordinator';
import Notebook from '@/app/reader/components/notebook/Notebook';
import { useNotebookStore } from '@/store/notebookStore';

const { innerWidth, innerHeight } = window;
const setWindow = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
};

describe('Notebook resizing', () => {
  beforeEach(() => {
    h.resize = null;
    h.isMobile = false;
    h.settings.globalReadSettings.notebookWidth = '30%';
    useNotebookStore.setState({
      notebookWidth: '',
      isNotebookVisible: false,
      isNotebookPinned: false,
      notebookActiveTab: 'notes',
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setWindow(innerWidth, innerHeight);
  });

  test('saves and dismisses the mobile notebook when Close is pressed', () => {
    h.isMobile = true;
    setWindow(390, 844);
    render(<Notebook />);
    act(() => useNotebookStore.getState().setNotebookVisible(true));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(flushNotebookDocument).toHaveBeenCalledWith('book-1');
    expect(useNotebookStore.getState().isNotebookVisible).toBe(false);
    expect(screen.queryByRole('group', { name: 'Notebook' })).toBeNull();
  });

  test('keeps an unpinned Notebook open while its width changes', () => {
    render(<Notebook />);

    act(() => useNotebookStore.getState().setNotebookVisible(true));
    expect(screen.getByRole('group', { name: 'Notebook' })).toBeTruthy();

    act(() => h.resize?.('35%'));

    expect(screen.getByRole('group', { name: 'Notebook' })).toBeTruthy();
    expect(useNotebookStore.getState().notebookWidth).toBe('35%');
  });
});

// The Notebook mirrors the sidebar on the other side (#7730): a sheet only on a
// phone-width window, and on a tablet a panel that pins beside the page, which
// is where a docked dictionary has to sit while the reader keeps reading.
describe('Notebook layout', () => {
  beforeEach(() => {
    h.isMobile = false;
    h.settings.globalReadSettings.notebookWidth = '30%';
    useNotebookStore.setState({
      notebookWidth: '30%',
      isNotebookVisible: false,
      isNotebookPinned: false,
      notebookActiveTab: 'notes',
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setWindow(innerWidth, innerHeight);
  });

  const panel = () => screen.getByRole('group', { name: 'Notebook' });

  test('pins beside the page on an iPad, as the sidebar does', () => {
    h.isMobile = true;
    setWindow(834, 1194);
    h.settings.globalReadSettings.isNotebookPinned = true;
    try {
      render(<Notebook />);

      expect(panel().style.position).toBe('relative');
      expect(panel().style.width).toBe('30%');
    } finally {
      h.settings.globalReadSettings.isNotebookPinned = false;
    }
  });

  test('stays a sheet on a phone', () => {
    h.isMobile = true;
    setWindow(390, 844);
    render(<Notebook />);
    act(() => useNotebookStore.getState().setNotebookVisible(true));

    expect(panel().style.position).toBe('fixed');
    expect(panel().style.width).toBe('100%');
  });

  // A pin saved at tablet or desktop width doesn't open a sheet over the book
  // on a phone, as the sidebar's doesn't.
  test('opens closed on a phone even when pinned', () => {
    h.isMobile = true;
    setWindow(390, 844);
    h.settings.globalReadSettings.isNotebookPinned = true;
    try {
      render(<Notebook />);

      expect(screen.queryByRole('group', { name: 'Notebook' })).toBeNull();
      expect(useNotebookStore.getState().isNotebookPinned).toBe(false);
    } finally {
      h.settings.globalReadSettings.isNotebookPinned = false;
    }
  });

  // An unpinned Notebook floats over the page, so unpinning closes it, as
  // unpinning the sidebar does (#7788).
  test('closes when unpinned, and stays open when pinned', () => {
    setWindow(1280, 800);
    render(<Notebook />);
    act(() => useNotebookStore.getState().setNotebookVisible(true));

    fireEvent.click(screen.getByRole('button', { name: 'Pin Notebook' }));
    expect(useNotebookStore.getState().isNotebookPinned).toBe(true);
    expect(panel()).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Unpin Notebook' }));
    expect(useNotebookStore.getState().isNotebookPinned).toBe(false);
    expect(flushNotebookDocument).toHaveBeenCalledWith('book-1');
    expect(screen.queryByRole('group', { name: 'Notebook' })).toBeNull();
  });

  test('shows the Dictionary tab', () => {
    render(<Notebook />);
    act(() => {
      useNotebookStore.getState().setNotebookVisible(true);
      useNotebookStore.getState().setNotebookActiveTab('dictionary');
    });

    expect(screen.getByText('Look up a word to see its definitions here.')).toBeTruthy();
  });
});
