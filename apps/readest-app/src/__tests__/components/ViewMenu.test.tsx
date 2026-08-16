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
const mockSaveViewSettings = vi.fn().mockResolvedValue(undefined);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasAmbientLightSensor: false } }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ themeMode: 'auto', isDarkMode: false, setThemeMode: vi.fn() }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => mockView,
    getViewSettings: () => currentViewSettings,
    getViewState: () => ({}),
    getProgress: () => null,
    setViewSettings: vi.fn(),
    recreateViewer: mockRecreateViewer,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({}),
    getBookData: () => mockBookData,
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    setSettingsDialogOpen: vi.fn(),
    setSettingsDialogBookKey: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));
vi.mock('@/helpers/settings', () => ({
  saveViewSettings: (...args: unknown[]) => mockSaveViewSettings(...args),
}));
vi.mock('@/services/constants', () => ({
  MAX_ZOOM_LEVEL: 200,
  MIN_ZOOM_LEVEL: 50,
  ZOOM_STEP: 10,
  MAX_CONTRAST: 200,
  MIN_CONTRAST: 50,
  CONTRAST_STEP: 10,
}));
vi.mock('@/utils/style', () => ({ getStyles: vi.fn() }));
vi.mock('@/utils/nav', () => ({ navigateToLogin: vi.fn() }));
vi.mock('@/utils/webtoon', () => ({ getScrollGapAttr: vi.fn() }));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({ applyPageTurnAttributes: vi.fn() }));
vi.mock('@/utils/config', () => ({ getMaxInlineSize: () => 720 }));
vi.mock('@/utils/ambientLight', () => ({ nextThemeMode: (mode: string) => mode }));
vi.mock('@/utils/window', () => ({ tauriHandleToggleFullScreen: vi.fn() }));

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
});
