import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ViewMenu from '@/app/reader/components/ViewMenu';

const mockView = {
  book: { dir: undefined as string | undefined },
  renderer: {
    setAttribute: vi.fn(),
    setStyles: undefined,
  },
};

const mockBookData = {
  isFixedLayout: true,
  book: { format: 'PDF' },
  bookDoc: {
    dir: undefined as string | undefined,
    rendition: { layout: 'pre-paginated' },
    sections: [{ pageSpread: '' }],
  },
};

const currentViewSettings = {
  scrolled: false,
  scrolledDirection: 'vertical',
  webtoonMode: false,
  paragraphMode: { enabled: false },
  zoomLevel: 100,
  contrast: 100,
  zoomMode: 'fit-page',
  spreadMode: 'auto',
  keepCoverSpread: true,
  invertImgColorInDark: false,
  applyThemeToPDF: false,
  vertical: false,
  writingMode: 'auto',
};

const mockRecreateViewer = vi.fn();
const mockSetOcrEnabled = vi.fn();
const mockSetOcrLanguage = vi.fn();
const mockViewState = { ocrEnabled: false, ocrLanguage: '' };
const mockSaveViewSettings = vi.fn().mockResolvedValue(undefined);
const mockAppService = {
  appPlatform: 'web',
  hasWindow: false,
  hasAmbientLightSensor: false,
  supportsCanvasContext2DFilter: true,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: mockAppService,
  }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));
vi.mock('@/store/themeStore', () => {
  const useThemeStore = () => ({
    themeMode: 'auto',
    isDarkMode: false,
    setThemeMode: vi.fn(),
  });
  useThemeStore.getState = () => ({ isIPhoneDuo: false, duoFold: null });
  return { useThemeStore };
});
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => mockView,
    getViewSettings: () => currentViewSettings,
    getViewState: () => mockViewState,
    getProgress: () => null,
    setViewSettings: vi.fn(),
    setOcrEnabled: mockSetOcrEnabled,
    setOcrLanguage: mockSetOcrLanguage,
    recreateViewer: mockRecreateViewer,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({}),
    getBookData: () => mockBookData,
  }),
}));
vi.mock('@/store/settingsStore', () => {
  const useSettingsStore = () => ({
    setSettingsDialogOpen: vi.fn(),
    setSettingsDialogBookKey: vi.fn(),
  });
  useSettingsStore.getState = () => ({ settings: { alwaysShowStatusBar: false } });
  return { useSettingsStore };
});
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));
vi.mock('@/helpers/settings', () => ({
  saveViewSettings: (...args: unknown[]) => mockSaveViewSettings(...args),
}));
vi.mock('@/components/vocabulary/VocabularyDialog', () => ({
  setVocabularyDialogVisible: vi.fn(),
}));
vi.mock('@/services/constants', () => ({
  MAX_ZOOM_LEVEL: 200,
  MIN_ZOOM_LEVEL: 50,
  ZOOM_STEP: 10,
  MAX_CONTRAST: 200,
  MIN_CONTRAST: 50,
  CONTRAST_STEP: 10,
  TRANSLATED_LANGS: {
    en: 'English',
    es: 'Español',
    ja: '日本語',
    'zh-CN': '简体中文',
  },
}));
vi.mock('@/utils/style', () => ({ getStyles: vi.fn() }));
vi.mock('@/utils/nav', () => ({ navigateToLogin: vi.fn() }));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({ applyPageTurnAttributes: vi.fn() }));
vi.mock('@/utils/config', () => ({ getMaxInlineSize: () => 720 }));
vi.mock('@/utils/ambientLight', () => ({ nextThemeMode: (mode: string) => mode }));
vi.mock('@/utils/window', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/window')>()),
  tauriHandleToggleFullScreen: vi.fn(),
}));

describe('ViewMenu fullscreen', () => {
  const requestFullscreen = vi.fn();

  const stubFullscreenApi = (enabled: boolean) => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: enabled });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requestFullscreen.mockResolvedValue(undefined);
    stubFullscreenApi(true);
  });

  afterEach(() => {
    cleanup();
    mockAppService.appPlatform = 'web';
  });

  it('offers Fullscreen in a web browser and enters it on tap (#6892)', async () => {
    const closeMenu = vi.fn();
    render(<ViewMenu bookKey='book-1' setIsDropdownOpen={closeMenu} />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Fullscreen' }));

    await waitFor(() => expect(requestFullscreen).toHaveBeenCalledOnce());
    expect(closeMenu).toHaveBeenCalledWith(false);
  });

  it('hides Fullscreen in browsers without the Fullscreen API', () => {
    stubFullscreenApi(false);
    render(<ViewMenu bookKey='book-1' />);

    expect(screen.queryByRole('menuitem', { name: 'Fullscreen' })).toBeNull();
  });

  it('hides Fullscreen in native mobile webviews', () => {
    mockAppService.appPlatform = 'tauri';
    render(<ViewMenu bookKey='book-1' />);

    expect(screen.queryByRole('menuitem', { name: 'Fullscreen' })).toBeNull();
  });
});

describe('ViewMenu right-to-left pages toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveViewSettings.mockResolvedValue(undefined);
    mockView.book.dir = undefined;
    mockBookData.isFixedLayout = true;
    mockBookData.bookDoc.dir = undefined;
    mockBookData.bookDoc.rendition = { layout: 'pre-paginated' };
    currentViewSettings.writingMode = 'auto';
    currentViewSettings.vertical = false;
    mockViewState.ocrEnabled = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the toggle for fixed-layout books', () => {
    render(<ViewMenu bookKey='book-1' />);
    expect(screen.getByText('Right-to-Left Pages')).toBeTruthy();
  });

  it('hides the toggle for reflowable books', () => {
    mockBookData.isFixedLayout = false;
    mockBookData.bookDoc.rendition = { layout: 'reflowable' };

    render(<ViewMenu bookKey='book-1' />);
    expect(screen.queryByText('Right-to-Left Pages')).toBeNull();
  });

  it('switches an LTR book to RTL page order and recreates the viewer', async () => {
    render(<ViewMenu bookKey='book-1' />);

    fireEvent.click(screen.getByText('Right-to-Left Pages'));

    await waitFor(() => {
      expect(mockSaveViewSettings).toHaveBeenCalledWith(
        expect.anything(),
        'book-1',
        'writingMode',
        'horizontal-rl',
        true,
      );
      expect(mockView.book.dir).toBe('rtl');
      expect(mockRecreateViewer).toHaveBeenCalledWith(expect.anything(), 'book-1');
    });
  });

  it('switches a native RTL book back to LTR page order', async () => {
    mockBookData.bookDoc.dir = 'rtl';
    mockView.book.dir = 'rtl';

    render(<ViewMenu bookKey='book-1' />);

    fireEvent.click(screen.getByText('Right-to-Left Pages'));

    await waitFor(() => {
      expect(mockSaveViewSettings).toHaveBeenCalledWith(
        expect.anything(),
        'book-1',
        'writingMode',
        'horizontal-tb',
        true,
      );
      expect(mockView.book.dir).toBe('ltr');
      expect(mockRecreateViewer).toHaveBeenCalledWith(expect.anything(), 'book-1');
    });
  });

  it('closes the menu when toggling text recognition', () => {
    const setIsDropdownOpen = vi.fn();

    const { rerender } = render(
      <ViewMenu bookKey='book-1' setIsDropdownOpen={setIsDropdownOpen} />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Recognize Text - OFF' }));

    expect(mockSetOcrEnabled).toHaveBeenCalledWith('book-1', true);
    expect(setIsDropdownOpen).toHaveBeenCalledWith(false);
    mockViewState.ocrEnabled = true;
    rerender(<ViewMenu bookKey='book-1' setIsDropdownOpen={setIsDropdownOpen} />);
    expect(screen.getByRole('menuitem', { name: 'Recognize Text - ON' })).toBeTruthy();
  });
});

describe('ViewMenu gapless scrolling (#7219)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentViewSettings.scrolled = true;
    currentViewSettings.scrolledDirection = 'horizontal';
    currentViewSettings.webtoonMode = false;
    currentViewSettings.zoomLevel = 100;
    mockBookData.isFixedLayout = true;
  });

  afterEach(() => {
    cleanup();
    currentViewSettings.scrolled = false;
    currentViewSettings.scrolledDirection = 'vertical';
    currentViewSettings.webtoonMode = false;
  });

  it('removes the page gap without changing horizontal scrolling', () => {
    render(<ViewMenu bookKey='book-1' />);

    fireEvent.click(screen.getByText('Webtoon Mode'));

    expect(mockView.renderer.setAttribute).toHaveBeenCalledWith('scroll-gap', '0');
    expect(currentViewSettings.scrolledDirection).toBe('horizontal');
    expect(currentViewSettings.webtoonMode).toBe(true);
  });

  it('keeps pages gapless when switching from vertical to horizontal scrolling', () => {
    currentViewSettings.scrolledDirection = 'vertical';
    currentViewSettings.webtoonMode = true;
    render(<ViewMenu bookKey='book-1' />);

    fireEvent.click(screen.getByTitle('Horizontal Scrolling'));

    expect(currentViewSettings.scrolledDirection).toBe('horizontal');
    expect(currentViewSettings.webtoonMode).toBe(true);
    expect(mockView.renderer.setAttribute).not.toHaveBeenCalledWith('scroll-gap', '4');
  });

  it('still enters vertical scrolling when enabled from paginated reading', () => {
    currentViewSettings.scrolled = false;
    render(<ViewMenu bookKey='book-1' />);

    fireEvent.click(screen.getByText('Webtoon Mode'));

    expect(currentViewSettings.scrolled).toBe(true);
    expect(currentViewSettings.scrolledDirection).toBe('vertical');
    expect(mockView.renderer.setAttribute).toHaveBeenCalledWith('scroll-gap', '0');
  });
});

// Menu rows and separators in document order: 'hr' for a separator, else the
// row's label (shortcut hints stripped).
const menuSequence = () =>
  Array.from(document.querySelectorAll('hr, [role="menuitem"], [role="none"]')).map((el) =>
    el.tagName === 'HR' ? 'hr' : (el.textContent ?? '').replace(/Shift\+\w$/, '').trim(),
  );

describe('ViewMenu layout', () => {
  beforeEach(() => {
    currentViewSettings.scrolled = false;
    currentViewSettings.scrolledDirection = 'vertical';
    currentViewSettings.spreadMode = 'auto';
    currentViewSettings.keepCoverSpread = true;
    mockBookData.isFixedLayout = true;
    mockBookData.bookDoc.rendition = { layout: 'pre-paginated' };
  });

  afterEach(() => {
    cleanup();
  });

  it('drops Paragraph and Speed Reading modes for fixed-layout books', () => {
    render(<ViewMenu bookKey='book-1' />);
    expect(screen.queryByText('Paragraph Mode')).toBeNull();
    expect(screen.queryByText('Speed Reading Mode')).toBeNull();
  });

  it('keeps Paragraph and Speed Reading modes for reflowable books', () => {
    mockBookData.isFixedLayout = false;
    mockBookData.bookDoc.rendition = { layout: 'reflowable' };
    render(<ViewMenu bookKey='book-1' />);
    expect(screen.getByText('Paragraph Mode')).toBeTruthy();
    expect(screen.getByText('Speed Reading Mode')).toBeTruthy();
  });

  it.each([
    'Vertical Scrolling',
    'Horizontal Scrolling',
  ])('disables Separate Cover Page in %s mode (#7129)', (layout) => {
    render(<ViewMenu bookKey='book-1' />);

    fireEvent.click(screen.getByTitle(layout));

    const separateCoverButton = screen.getByText('Separate Cover Page').closest('button');
    expect(separateCoverButton?.disabled).toBe(true);
  });

  it('groups the image colour toggles after Auto Scroll and Webtoon Mode on its own above sync', () => {
    render(<ViewMenu bookKey='book-1' />);
    const seq = menuSequence();
    const autoScroll = seq.indexOf('Auto Scroll');
    expect(seq.slice(autoScroll, autoScroll + 5)).toEqual([
      'Auto Scroll',
      'Apply Theme Colors',
      'hr',
      'Webtoon Mode',
      'hr',
    ]);
    expect(seq[autoScroll + 5]).toBe('Sign in to Sync');
  });
});
