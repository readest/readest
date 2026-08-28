import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({
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
  useBookDataStore: () => ({
    getBookData: () => ({ bookDoc: { metadata: { language: 'en' } } }),
    getConfig: () => ({ booknotes: [] }),
    setConfig: vi.fn(),
    updateBooknotes: vi.fn(),
    saveConfig: vi.fn(),
  }),
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
vi.mock('@/app/reader/components/notebook/Header', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/NotebookEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/NotebookTabNavigation', () => ({
  default: () => null,
}));
vi.mock('@/app/reader/components/notebook/AIAssistant', () => ({ default: () => null }));

import Notebook from '@/app/reader/components/notebook/Notebook';
import { useNotebookStore } from '@/store/notebookStore';

describe('Notebook resizing', () => {
  beforeEach(() => {
    h.resize = null;
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
