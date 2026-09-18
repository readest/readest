import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HeaderBar from '@/app/reader/components/HeaderBar';
import SectionInfo from '@/app/reader/components/SectionInfo';
import { page } from 'vitest/browser';
import '@/styles/globals.css';

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
let statusBarHeight = 36 / 1.4875000715255737;
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    isDarkMode: false,
    systemUIVisible: true,
    statusBarHeight,
  }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ isSideBarVisible: false, getIsSideBarVisible: () => false }),
}));
let hoveredBookKey = 'book-1';
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    bookKeys: ['book-1'],
    hoveredBookKey,
    getView: () => null,
    getViewSettings: () => ({ enableAnnotationQuickActions: false, marginTopPx: 44 }),
    setHoveredBookKey: vi.fn(),
  }),
}));
vi.mock('@/store/bookDataStore', () => {
  const state = { getBookData: () => null, getConfig: () => null };
  return {
    useBookDataStore: (selector?: (store: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});
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
vi.mock('@/utils/insets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/insets')>()),
  getHeaderTriggerHeight: () => 0,
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));

// Keep toolbar children isolated; HeaderBar, SectionInfo, geometry and CSS are real.
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

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

const renderHeader = () =>
  render(
    <div className='relative h-screen w-full'>
      <HeaderBar
        bookKey='book-1'
        bookTitle='Book'
        isTopLeft={false}
        isHoveredAnim={false}
        gridInsets={insets}
        screenInsets={insets}
        onCloseBook={vi.fn()}
        onGoToLibrary={vi.fn()}
      />
      <SectionInfo
        bookKey='book-1'
        section='Chapter One'
        showDoubleBorder={false}
        isScrolled={false}
        isVertical={false}
        isEink={false}
        horizontalGap={5}
        contentInsets={insets}
        gridInsets={insets}
      />
    </div>,
  );

beforeEach(() => {
  hoveredBookKey = 'book-1';
  statusBarHeight = 36 / 1.4875000715255737;
  useEnvMock.mockReturnValue({ envConfig: {}, appService: { isMobile: true, isAndroidApp: true } });
});

afterEach(() => {
  cleanup();
  useEnvMock.mockReset();
});

describe('tablet header hit testing (#6242)', () => {
  it.each([
    [686, 1097, 24],
    [807, 1291, 36 / 1.4875000715255737],
    [1291, 807, 36 / 1.4875000715255737],
  ])('keeps button centers clickable with overlapping page chrome at %i x %i', async (width, height, barHeight) => {
    statusBarHeight = barHeight;
    await page.viewport(width, height);
    const { container } = renderHeader();
    const header = container.querySelector('.header-bar') as HTMLElement;
    const buttons = [...header.querySelectorAll('button')].filter(
      (button) => button.getBoundingClientRect().width > 0,
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      expect(button.contains(hit), button.title || button.ariaLabel || 'header button').toBe(true);
    }
  });
});

it('lets the page-title strip receive taps while the toolbar is hidden', async () => {
  await page.viewport(807, 1291);
  hoveredBookKey = '';
  const { container } = renderHeader();
  const title = container.querySelector('.sectioninfo') as HTMLElement;
  const rect = title.getBoundingClientRect();
  expect(
    title.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
  ).toBe(true);
});
