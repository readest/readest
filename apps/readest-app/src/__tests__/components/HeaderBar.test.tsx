import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HeaderBar from '@/app/reader/components/HeaderBar';

// jsdom ships no ResizeObserver, and HeaderBar constructs one to track its own
// width. Same stub pattern as popup-resting-triangle.test.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const useEnvMock = vi.fn();
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => useEnvMock(),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { highlightStyle: 'highlight', highlightStyles: {} } },
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false, systemUIVisible: true, statusBarHeight: 0 }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ isSideBarVisible: false, getIsSideBarVisible: () => false }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    bookKeys: ['book-1'],
    hoveredBookKey: 'book-1',
    getView: () => null,
    getViewSettings: () => ({ enableAnnotationQuickActions: false }),
    setHoveredBookKey: vi.fn(),
  }),
}));
let currentBookData: {
  book?: { title: string; metadata?: { series?: string; seriesIndex?: number } };
} | null = null;
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => currentBookData, getConfig: () => null }),
}));
vi.mock('@/store/trafficLightStore', () => ({
  useTrafficLightStore: () => ({
    trafficLightInFullscreen: false,
    setTrafficLightVisibility: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/app/reader/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: () => {} }));
vi.mock('@/utils/insets', () => ({ getHeaderTriggerHeight: () => 0 }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));

// Child toolbar buttons are stubbed to bare, identifiable markup: this test is
// about which of them the header decides to render, not how they look.
vi.mock('@/app/reader/components/SidebarToggler', () => ({
  default: () => <button type='button'>sidebar-toggler</button>,
}));
vi.mock('@/app/reader/components/BookmarkToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/NotebookToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TranslationToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ViewMenu', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SyncInfoDialog', () => ({ default: () => null }));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@/components/Dropdown', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({ default: () => null }));

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
};

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

const renderHeader = () =>
  render(
    <HeaderBar
      bookKey='book-1'
      bookTitle='Book'
      isTopLeft={false}
      isHoveredAnim={false}
      gridInsets={insets}
      screenInsets={insets}
      onCloseBook={vi.fn()}
      onGoToLibrary={vi.fn()}
    />,
  );

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  useEnvMock.mockReturnValue({ envConfig: {}, appService: { isMobile: true } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useEnvMock.mockReset();
  currentBookData = null;
});

describe('HeaderBar sidebar toggle', () => {
  it('is hidden on tablet portrait, where the footer bar owns the TOC tab', () => {
    setViewport(834, 1194);
    renderHeader();
    expect(screen.queryByText('sidebar-toggler')).toBeNull();
  });

  it('is shown on tablet landscape, which gets the desktop footer bar', () => {
    setViewport(1194, 834);
    renderHeader();
    expect(screen.getByText('sidebar-toggler')).toBeTruthy();
  });

  it('is shown on desktop', () => {
    useEnvMock.mockReturnValue({ envConfig: {}, appService: { isMobile: false } });
    setViewport(1440, 900);
    renderHeader();
    expect(screen.getByText('sidebar-toggler')).toBeTruthy();
  });
});

describe('HeaderBar font button', () => {
  it('is gone on every platform, since it opened the last panel rather than Font', () => {
    useEnvMock.mockReturnValue({ envConfig: {}, appService: { isMobile: false } });
    setViewport(1440, 900);
    renderHeader();
    // queryByRole, not querySelector: jsdom's selector engine fails to match
    // [aria-label="Font & Layout"] on the `&`, so a CSS-based assertion here
    // passes whether or not the button is rendered.
    expect(screen.queryByRole('button', { name: 'Font & Layout' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });
});

describe('HeaderBar book metadata data attributes (#5776)', () => {
  // The desktop header only prints the title; series readers want "Book 2"
  // next to it. Exposed on .header-title as inert data attributes so Custom
  // Reader UI CSS can append them with attr() without a default UI change.
  it('exposes title, series and series index on .header-title', () => {
    currentBookData = {
      book: { title: 'Book', metadata: { series: 'The Expanse', seriesIndex: 2 } },
    };
    useEnvMock.mockReturnValue({ envConfig: {}, appService: { isMobile: false } });
    setViewport(1440, 900);
    const { container } = renderHeader();
    const title = container.querySelector('.header-title') as HTMLElement;

    expect(title.getAttribute('data-book-title')).toBe('Book');
    expect(title.getAttribute('data-book-series')).toBe('The Expanse');
    expect(title.getAttribute('data-book-series-index')).toBe('2');
  });

  it('leaves the series attributes off for a standalone book', () => {
    currentBookData = { book: { title: 'Book', metadata: {} } };
    useEnvMock.mockReturnValue({ envConfig: {}, appService: { isMobile: false } });
    setViewport(1440, 900);
    const { container } = renderHeader();
    const title = container.querySelector('.header-title') as HTMLElement;

    expect(title.getAttribute('data-book-title')).toBe('Book');
    expect(title.hasAttribute('data-book-series')).toBe(false);
    expect(title.hasAttribute('data-book-series-index')).toBe(false);
  });
});
