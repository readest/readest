// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  appPlatform: 'web' as 'web' | 'tauri',
  hasSafeAreaInset: true,
  hoveredBookKey: '',
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: {
      isMobile: true,
      appPlatform: h.appPlatform,
      hasSafeAreaInset: h.hasSafeAreaInset,
    },
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { highlightStyle: 'highlight', highlightStyles: {} } },
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    isDarkMode: false,
    systemUIVisible: true,
    statusBarHeight: 0,
    isIPhoneDuo: false,
  }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ isSideBarVisible: false, getIsSideBarVisible: () => false }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    bookKeys: ['book-1'],
    hoveredBookKey: h.hoveredBookKey,
    getView: () => null,
    getViewSettings: () => ({ enableAnnotationQuickActions: false }),
    setHoveredBookKey: vi.fn(),
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({ getBookData: () => null, getConfig: () => null })),
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
vi.mock('@/utils/insets', () => ({
  getHeaderTriggerHeight: () => 0,
  getHorizontalInsetStyle: () => ({}),
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/app/reader/components/SidebarToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/BookmarkToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/NotebookToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TranslationToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ViewMenu', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SyncInfoDialog', () => ({ default: () => null }));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@/components/Dropdown', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({ default: () => null }));

import HeaderBar from '@/app/reader/components/HeaderBar';

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const insets = { top: 47, right: 0, bottom: 34, left: 0 };

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
  Object.defineProperty(window, 'innerWidth', { value: 393, configurable: true });
  h.appPlatform = 'web';
  h.hasSafeAreaInset = true;
  h.hoveredBookKey = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HeaderBar mobile Web PWA scroll-edge wrapper', () => {
  it('uses absolute rather than fixed on mobile Web PWA when the toolbar is hidden', () => {
    const { container } = renderHeader();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains('absolute')).toBe(true);
    expect(wrapper.classList.contains('fixed')).toBe(false);
    expect(wrapper.classList.contains('z-20')).toBe(true);
  });

  it('uses fixed on mobile Web PWA while the toolbar is visible', () => {
    h.hoveredBookKey = 'book-1';
    const { container } = renderHeader();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains('fixed')).toBe(true);
    expect(wrapper.classList.contains('z-20')).toBe(true);
    expect(wrapper.classList.contains('bg-base-100')).toBe(true);
  });

  it('keeps fixed on non-web platforms even when the toolbar is hidden', () => {
    h.appPlatform = 'tauri';
    const { container } = renderHeader();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains('fixed')).toBe(true);
    expect(wrapper.classList.contains('absolute')).toBe(false);
  });
});
