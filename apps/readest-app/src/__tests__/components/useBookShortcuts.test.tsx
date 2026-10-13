import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useBookShortcuts from '@/app/reader/hooks/useBookShortcuts';
import { eventDispatcher } from '@/utils/event';

const shortcutState = {
  actions: null as Record<
    string,
    ((event?: KeyboardEvent | MessageEvent) => void) | undefined
  > | null,
};

const mockView = {
  book: { dir: 'ltr' },
  prev: vi.fn(),
  next: vi.fn(),
  pan: vi.fn(),
  goToFraction: vi.fn(),
  renderer: {
    scrolled: false,
    setAttribute: vi.fn(),
  },
  history: {
    back: vi.fn(),
    forward: vi.fn(),
  },
};

const currentViewState = {
  ttsEnabled: false,
  inited: true,
};

const currentBookData = {
  isFixedLayout: false,
};

const currentViewSettings = {
  defaultFontSize: 16,
  zoomLevel: 100,
  lineHeight: 1.5,
  readingRulerEnabled: true,
  writingMode: 'horizontal-tb',
  vertical: false,
  rtl: false,
  paragraphMode: { enabled: false },
};

const sideBarState = {
  isSideBarPinned: false,
  isSideBarVisible: false,
  sideBarBookKey: 'book-1',
};
let currentSideBarTab = 'toc';
const mockSetHoveredBookKey = vi.fn();
const mockSetSideBarBookKey = vi.fn();
const mockSetSideBarVisible = vi.fn();
const mockSetSearchBarVisible = vi.fn();
const mockToggleSideBar = vi.fn();
const mockGetConfig = vi.fn(() => ({
  viewSettings: { sideBarTab: currentSideBarTab },
}));
const mockSetConfig = vi.fn();

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => mockView,
    getViewState: () => currentViewState,
    getViewSettings: () => currentViewSettings,
    setViewSettings: vi.fn(),
    setHoveredBookKey: mockSetHoveredBookKey,
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(
    () => ({
      toggleSideBar: mockToggleSideBar,
      setSideBarBookKey: mockSetSideBarBookKey,
      setSideBarVisible: mockSetSideBarVisible,
      setSearchBarVisible: mockSetSearchBarVisible,
    }),
    { getState: () => sideBarState },
  ),
}));

const mockSetSettingsDialogOpen = vi.fn();
const mockSetSettingsDialogBookKey = vi.fn();
const globalViewSettings = { defaultFontSize: 16 };
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalViewSettings },
    setSettingsDialogOpen: mockSetSettingsDialogOpen,
    setSettingsDialogBookKey: mockSetSettingsDialogBookKey,
  }),
}));

const mockSaveViewSettings = vi.fn();
vi.mock('@/helpers/settings', () => ({
  saveViewSettings: (...args: unknown[]) => mockSaveViewSettings(...args),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { appPlatform: 'web' } }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => currentBookData,
    getConfig: mockGetConfig,
    setConfig: mockSetConfig,
  }),
}));

vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({
    toggleNotebook: vi.fn(),
  }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    safeAreaInsets: null,
  }),
}));

vi.mock('@/components/command-palette', () => ({
  useCommandPalette: () => ({
    open: vi.fn(),
  }),
}));

vi.mock('@/hooks/useShortcuts', () => ({
  default: (actions: typeof shortcutState.actions) => {
    shortcutState.actions = actions;
  },
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@/utils/window', () => ({
  tauriHandleClose: vi.fn(),
  tauriHandleToggleFullScreen: vi.fn(),
  tauriQuitApp: vi.fn(),
}));

vi.mock('@/utils/style', () => ({
  getStyles: vi.fn(),
}));

vi.mock('@/services/constants', () => ({
  MAX_ZOOM_LEVEL: 200,
  MIN_ZOOM_LEVEL: 50,
  ZOOM_STEP: 10,
  MAX_FONT_SIZE: 120,
  MIN_FONT_SIZE: 8,
  FONT_SIZE_STEP: 1,
  DEFAULT_BOOK_FONT: { defaultFontSize: 16 },
}));

vi.mock('@/app/reader/hooks/useBooksManager', () => ({
  default: () => ({
    getNextBookKey: () => 'book-1',
  }),
}));

const Harness = () => {
  useBookShortcuts({ sideBarBookKey: 'book-1', bookKeys: ['book-1'] });
  return null;
};

describe('useBookShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shortcutState.actions = null;
    currentViewSettings.readingRulerEnabled = true;
    currentViewSettings.writingMode = 'horizontal-tb';
    currentViewSettings.vertical = false;
    currentViewSettings.rtl = false;
    currentViewSettings.paragraphMode.enabled = false;
    currentViewState.inited = true;
    currentBookData.isFixedLayout = false;
    currentViewSettings.defaultFontSize = 16;
    currentViewSettings.zoomLevel = 100;
    globalViewSettings.defaultFontSize = 16;
    mockView.book.dir = 'ltr';
    sideBarState.isSideBarPinned = false;
    sideBarState.isSideBarVisible = false;
    sideBarState.sideBarBookKey = 'book-1';
    currentSideBarTab = 'toc';
  });

  afterEach(() => {
    cleanup();
  });

  it('routes page-turn shortcuts to reading ruler movement when enabled', () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatchSync').mockReturnValue(true);

    render(<Harness />);
    shortcutState.actions?.['onGoNext']?.();

    expect(dispatchSpy).toHaveBeenCalledWith('reading-ruler-move', {
      bookKey: 'book-1',
      direction: 'forward',
    });
    expect(mockView.next).not.toHaveBeenCalled();
  });

  it('uses reading order when directional shortcuts are handled in rtl books', () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatchSync').mockReturnValue(true);
    mockView.book.dir = 'rtl';

    render(<Harness />);
    shortcutState.actions?.['onGoRight']?.();

    expect(dispatchSpy).toHaveBeenCalledWith('reading-ruler-move', {
      bookKey: 'book-1',
      direction: 'backward',
    });
  });

  it('falls back to normal page navigation when the ruler is disabled', () => {
    currentViewSettings.readingRulerEnabled = false;

    render(<Harness />);
    shortcutState.actions?.['onGoNext']?.();

    expect(mockView.next).toHaveBeenCalledWith(72);
  });

  it('falls back to normal page navigation when the ruler cannot move further', () => {
    vi.spyOn(eventDispatcher, 'dispatchSync').mockReturnValue(false);

    render(<Harness />);
    shortcutState.actions?.['onGoNext']?.();

    expect(mockView.next).toHaveBeenCalledWith(72);
  });

  it('jumps to the start of the book on Home, ignoring the reading ruler (#5660)', () => {
    vi.spyOn(eventDispatcher, 'dispatchSync').mockReturnValue(true);

    render(<Harness />);
    shortcutState.actions?.['onGoBookStart']?.();

    expect(mockView.goToFraction).toHaveBeenCalledWith(0);
  });

  it('jumps to the end of the book on End (#5660)', () => {
    render(<Harness />);
    shortcutState.actions?.['onGoBookEnd']?.();

    expect(mockView.goToFraction).toHaveBeenCalledWith(1);
  });

  it('ignores book start/end jumps until the view finished initializing (#5660)', () => {
    currentViewState.inited = false;

    render(<Harness />);
    shortcutState.actions?.['onGoBookStart']?.();
    shortcutState.actions?.['onGoBookEnd']?.();

    expect(mockView.goToFraction).not.toHaveBeenCalled();
  });

  it('dispatches rsvp-start for the current book when the RSVP shortcut fires', () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    render(<Harness />);
    shortcutState.actions?.['onStartRSVP']?.();

    expect(dispatchSpy).toHaveBeenCalledWith('rsvp-start', { bookKey: 'book-1' });
  });

  it('targets the active book when the settings shortcut opens the dialog (#5591)', () => {
    render(<Harness />);
    shortcutState.actions?.['onOpenFontLayoutSettings']?.();

    expect(mockSetSettingsDialogBookKey).toHaveBeenCalledWith('book-1');
    expect(mockSetSettingsDialogOpen).toHaveBeenCalledWith(true);
  });

  it.each([
    {
      name: 'opens a hidden table of contents',
      state: { isSideBarVisible: false, sideBarBookKey: 'book-1', tab: 'toc' },
      expectedVisibility: true,
      writesTab: true,
    },
    {
      name: 'switches another sidebar tab to the table of contents',
      state: { isSideBarVisible: true, sideBarBookKey: 'book-1', tab: 'search' },
      expectedVisibility: true,
      writesTab: true,
    },
    {
      name: "switches another book's sidebar to the table of contents",
      state: { isSideBarVisible: true, sideBarBookKey: 'book-2', tab: 'toc' },
      expectedVisibility: true,
      writesTab: true,
    },
    {
      name: 'closes the current unpinned table of contents',
      state: { isSideBarVisible: true, sideBarBookKey: 'book-1', tab: 'toc' },
      expectedVisibility: false,
      writesTab: false,
    },
    {
      name: 'keeps the current pinned table of contents open',
      state: {
        isSideBarPinned: true,
        isSideBarVisible: true,
        sideBarBookKey: 'book-1',
        tab: 'toc',
      },
      expectedVisibility: undefined,
      writesTab: false,
    },
  ])('$name', ({ state, expectedVisibility, writesTab }) => {
    Object.assign(sideBarState, state);
    currentSideBarTab = state.tab;
    render(<Harness />);

    shortcutState.actions?.['onOpenTableOfContents']?.();

    if (expectedVisibility === undefined) {
      expect(mockSetSideBarVisible).not.toHaveBeenCalled();
      expect(mockSetSideBarBookKey).not.toHaveBeenCalled();
      expect(mockSetHoveredBookKey).not.toHaveBeenCalled();
    } else {
      expect(mockSetSideBarVisible).toHaveBeenCalledWith(expectedVisibility);
    }
    if (writesTab) {
      expect(mockSetConfig).toHaveBeenCalledWith('book-1', {
        viewSettings: { sideBarTab: 'toc' },
      });
    } else {
      expect(mockSetConfig).not.toHaveBeenCalled();
    }
  });

  describe('zoom shortcuts on reflowable books (#5694)', () => {
    it('steps the font size up and keeps the change on the book', () => {
      render(<Harness />);
      shortcutState.actions?.['onZoomIn']?.();

      expect(mockSaveViewSettings).toHaveBeenCalledWith(
        { appPlatform: 'web' },
        'book-1',
        'defaultFontSize',
        17,
        true,
      );
      expect(mockView.renderer.setAttribute).not.toHaveBeenCalled();
    });

    it('steps the font size down', () => {
      render(<Harness />);
      shortcutState.actions?.['onZoomOut']?.();

      expect(mockSaveViewSettings).toHaveBeenCalledWith(
        { appPlatform: 'web' },
        'book-1',
        'defaultFontSize',
        15,
        true,
      );
    });

    it('scales the step with the pinch factor', () => {
      render(<Harness />);
      eventDispatcher.dispatch('zoom-in', { factor: 4 });

      expect(mockSaveViewSettings).toHaveBeenCalledWith(
        { appPlatform: 'web' },
        'book-1',
        'defaultFontSize',
        20,
        true,
      );
    });

    it('clamps the font size to the allowed range', () => {
      currentViewSettings.defaultFontSize = 8;
      render(<Harness />);
      shortcutState.actions?.['onZoomOut']?.();

      expect(mockSaveViewSettings).not.toHaveBeenCalled();
    });

    it('restores the global default font size on reset zoom', () => {
      currentViewSettings.defaultFontSize = 24;
      globalViewSettings.defaultFontSize = 18;
      render(<Harness />);
      shortcutState.actions?.['onResetZoom']?.();

      expect(mockSaveViewSettings).toHaveBeenCalledWith(
        { appPlatform: 'web' },
        'book-1',
        'defaultFontSize',
        18,
        true,
      );
    });

    it('keeps scaling fixed-layout books instead of resizing text', () => {
      currentBookData.isFixedLayout = true;
      render(<Harness />);
      shortcutState.actions?.['onZoomIn']?.();

      expect(mockView.renderer.setAttribute).toHaveBeenCalledWith('scale-factor', 110);
      expect(mockSaveViewSettings).not.toHaveBeenCalled();
    });
  });
});
