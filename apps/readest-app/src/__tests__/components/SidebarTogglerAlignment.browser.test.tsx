import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { DropdownProvider } from '@/context/DropdownContext';
import HeaderBar from '@/app/reader/components/HeaderBar';
import SidebarHeader from '@/app/reader/components/sidebar/Header';
import '@/styles/globals.css';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

let hasTrafficLight = true;
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: false, hasTrafficLight } }),
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
  useTrafficLight: () => ({ isTrafficLightVisible: hasTrafficLight }),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/app/reader/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: () => {} }));
vi.mock('@/utils/insets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/insets')>()),
  getHeaderTriggerHeight: () => 0,
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));

vi.mock('@/app/reader/components/SidebarToggler', () => ({
  default: () => (
    <button type='button' data-testid='sidebar-toggler' className='btn h-8 min-h-8 w-8 p-0' />
  ),
}));
vi.mock('@/app/reader/components/BookmarkToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/NotebookToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TranslationToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ViewMenu', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SyncInfoDialog', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/BookMenu', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({ default: () => null }));

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

const togglerLeft = () => screen.getByTestId('sidebar-toggler').getBoundingClientRect().left;

beforeEach(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  cleanup();
});

describe('sidebar toggler stays put when the sidebar opens', () => {
  it.each([true, false])('matches the header position (traffic lights: %s)', (trafficLight) => {
    hasTrafficLight = trafficLight;

    render(
      <DropdownProvider>
        <div className='relative h-screen w-full'>
          <HeaderBar
            bookKey='book-1'
            bookTitle='Book'
            isTopLeft
            isHoveredAnim={false}
            gridInsets={insets}
            screenInsets={insets}
            onCloseBook={vi.fn()}
            onGoToLibrary={vi.fn()}
          />
        </div>
      </DropdownProvider>,
    );
    const closedLeft = togglerLeft();
    cleanup();

    render(
      <div className='w-80'>
        <SidebarHeader
          bookKey='book-1'
          isPinned={false}
          isSearchBarVisible={false}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
          onToggleSearchBar={vi.fn()}
        />
      </div>,
    );
    expect(togglerLeft()).toBe(closedLeft);
  });
});
