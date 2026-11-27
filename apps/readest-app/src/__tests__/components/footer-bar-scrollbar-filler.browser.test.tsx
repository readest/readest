import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import FooterBar from '@/app/reader/components/footerbar/FooterBar';
import '@/styles/globals.css';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false } }),
}));
const viewSettings = vi.hoisted(() => ({
  vertical: true,
  scrolled: true,
  zoomLevel: 100,
}));
const bookData = vi.hoisted(() => ({
  isFixedLayout: false,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: 'book-1',
    setHoveredBookKey: vi.fn(),
    bottomBarTab: '',
    setBottomBarTab: vi.fn(),
    getView: () => null,
    getViewState: () => null,
    getProgress: () => null,
    getViewSettings: () => viewSettings,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({
    getConfig: () => null,
    setConfig: vi.fn(),
    getBookData: () => bookData,
  })),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    isSideBarVisible: false,
    isSideBarPinned: false,
    setSideBarVisible: vi.fn(),
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: (select: (s: { isIPhoneDuo: boolean }) => unknown) =>
    select({ isIPhoneDuo: false }),
}));
vi.mock('@/app/reader/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: () => {} }));
vi.mock('@/app/reader/components/footerbar/MobileFooterBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/footerbar/DesktopFooterBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/tts/TTSControl', () => ({ default: () => null }));
vi.mock('@/app/reader/components/rsvp', () => ({ RSVPControl: () => null }));

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

afterEach(() => {
  cleanup();
  viewSettings.vertical = true;
  viewSettings.scrolled = true;
  viewSettings.zoomLevel = 100;
  bookData.isFixedLayout = false;
});

const renderAndAssertGapFilled = async (bookFormat: 'EPUB' | 'PDF') => {
  await page.viewport(1280, 800);
  render(
    <div className='relative h-[800px] w-[1280px]'>
      <FooterBar
        bookKey='book-1'
        bookFormat={bookFormat}
        isHoveredAnim={false}
        gridInsets={insets}
      />
    </div>,
  );

  const footer = screen.getByRole('contentinfo');
  const filler = footer.nextElementSibling as HTMLElement;
  expect(filler).not.toBeNull();
  expect(getComputedStyle(filler).pointerEvents).toBe('none');

  const footerRect = footer.getBoundingClientRect();
  const fillerRect = filler.getBoundingClientRect();

  expect(footerRect.bottom).toBe(800 - 17);
  expect(fillerRect.bottom).toBe(800);
  expect(fillerRect.top).toBe(footerRect.bottom);
};

describe('FooterBar horizontal scrollbar filler (#8026)', () => {
  it('fills the entire 17px gap under the lifted desktop footer bar in scrolled vertical reading', async () => {
    await renderAndAssertGapFilled('EPUB');
  });

  it('fills the entire 17px gap under the lifted desktop footer bar on a zoomed fixed-layout page', async () => {
    viewSettings.vertical = false;
    viewSettings.scrolled = false;
    viewSettings.zoomLevel = 150;
    bookData.isFixedLayout = true;

    await renderAndAssertGapFilled('PDF');
  });
});
