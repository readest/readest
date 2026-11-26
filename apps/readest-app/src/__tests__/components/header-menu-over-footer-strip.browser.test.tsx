import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { DropdownProvider } from '@/context/DropdownContext';
import Menu from '@/components/Menu';
import HeaderBar from '@/app/reader/components/HeaderBar';
import ProgressBar from '@/app/reader/components/ProgressBar';
import { DEFAULT_BOOK_LAYOUT, DEFAULT_BOOK_STYLE, DEFAULT_VIEW_CONFIG } from '@/services/constants';
import type { BookProgress, ViewSettings } from '@/types/book';
import '@/styles/globals.css';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: false } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { highlightStyle: 'highlight', highlightStyles: {} } },
  }),
}));

// Selector-aware mocks: HeaderBar reads whole stores, ProgressBar selects fields.
const { select } = vi.hoisted(() => ({
  select:
    <S,>(state: S) =>
    <R,>(selector?: (s: S) => R) =>
      selector ? selector(state) : state,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: select({
    isDarkMode: false,
    systemUIVisible: false,
    statusBarHeight: 0,
    isIPhoneDuo: false,
  }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ isSideBarVisible: false, getIsSideBarVisible: () => false }),
}));
// The reporter's layout: a 144 px bottom margin in paginated mode, footer info on.
const viewSettings = {
  ...DEFAULT_BOOK_LAYOUT,
  ...DEFAULT_BOOK_STYLE,
  ...DEFAULT_VIEW_CONFIG,
  marginTopPx: 44,
  marginBottomPx: 144,
  scrolled: false,
  showFooter: true,
  showProgressInfo: true,
  showCurrentTime: true,
} as ViewSettings;
vi.mock('@/store/readerStore', () => ({
  useReaderStore: select({
    bookKeys: ['book-1'],
    hoveredBookKey: 'book-1',
    getView: () => ({
      renderer: { page: 1, pages: 4, getContents: () => [] },
      getSectionFractions: () => [],
    }),
    getViewSettings: () => viewSettings,
    setHoveredBookKey: vi.fn(),
  }),
}));
vi.mock('@/store/readerProgressStore', () => {
  const progress = {
    section: { current: 2, total: 5 },
    pageinfo: { current: 2, total: 5 },
    timeinfo: { section: 0, total: 0 },
  } as BookProgress;
  return { useBookProgress: () => progress, getBookProgress: () => progress };
});
vi.mock('@/store/bookDataStore', async () => {
  const { bookDataStoreHooks } = await import('@/__tests__/helpers/book-data-store-mock');
  const state = { getBookData: () => ({ isFixedLayout: false }), getConfig: () => null };
  return {
    ...bookDataStoreHooks((selector?: (store: typeof state) => unknown) =>
      selector ? selector(state) : state,
    ),
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
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({ useMedianPageDurationSecs: () => null }));
vi.mock('@/app/reader/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: () => {} }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));

vi.mock('@/app/reader/components/SidebarToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/BookmarkToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/NotebookToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TranslationToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/DuoBookModeToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SyncInfoDialog', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({ default: () => null }));
// As tall as the real View Options menu (13 rows, 520 px), so it scrolls.
vi.mock('@/app/reader/components/ViewMenu', () => ({
  default: () => (
    <Menu className='view-menu dropdown-content dropdown-right no-triangle mt-1.5'>
      {Array.from({ length: 13 }, (_, i) => (
        <button key={i} type='button' className='view-menu-row block h-10 w-48'>
          {`Row ${i + 1}`}
        </button>
      ))}
    </Menu>
  ),
}));

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

afterEach(() => {
  cleanup();
});

it('keeps every visible row of an open header menu above the footer tap strip (#7966)', async () => {
  await page.viewport(1124, 494);
  // The page cell as BooksGrid lays it out: the header, then the page layer
  // carrying the in-page footer.
  const { container } = render(
    <DropdownProvider>
      <div className='relative h-screen w-full overflow-hidden'>
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
        <div className='bg-base-100 absolute inset-0'>
          <ProgressBar
            bookKey='book-1'
            horizontalGap={5}
            contentInsets={insets}
            gridInsets={insets}
          />
        </div>
      </div>
    </DropdownProvider>,
  );

  const strip = container.querySelector('.progress-strip') as HTMLElement;
  expect(strip.getBoundingClientRect().top).toBe(494 - 144);

  fireEvent.click(screen.getByRole('button', { name: 'View Options' }));
  const menu = container.querySelector('.view-menu') as HTMLElement;
  menu.scrollTop = menu.scrollHeight;
  const menuRect = menu.getBoundingClientRect();
  expect(menuRect.bottom).toBeGreaterThan(494 - 144);

  const rows = [...menu.querySelectorAll<HTMLElement>('.view-menu-row')];
  const visible = rows.filter((row) => {
    const { top, bottom } = row.getBoundingClientRect();
    return top >= menuRect.top && bottom <= menuRect.bottom;
  });
  expect(visible.length).toBeGreaterThan(0);
  for (const row of visible) {
    const rect = row.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    expect(row.contains(hit), `${row.textContent} is covered by ${hit?.className}`).toBe(true);
  }

  // A tap on the strip away from the menu dismisses the menu, as it does
  // anywhere else on the page; once closed, the strip takes taps again.
  const stripRect = strip.getBoundingClientRect();
  const [x, y] = [stripRect.x + 20, stripRect.bottom - 20];
  const outside = document.elementFromPoint(x, y) as HTMLElement;
  expect(outside.classList.contains('overlay')).toBe(true);
  fireEvent.click(outside);
  expect(container.querySelector('.view-menu')).toBeNull();
  expect(strip.contains(document.elementFromPoint(x, y))).toBe(true);
});
