// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FooterBar from '@/app/reader/components/footerbar/FooterBar';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
import type { BookProgress } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false } }),
}));
const setHoveredBookKey = vi.hoisted(() => vi.fn());
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: 'book-1',
    setHoveredBookKey,
    bottomBarTab: '',
    setBottomBarTab: vi.fn(),
    getView: () => null,
    getViewState: () => null,
    getProgress: () => null,
    getViewSettings: () => null,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({
    getConfig: () => null,
    setConfig: vi.fn(),
    getBookData: () => null,
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
const fractions = vi.hoisted(() => [] as Array<number | undefined>);
vi.mock('@/app/reader/components/footerbar/DesktopFooterBar', () => ({
  default: ({ progressFraction }: { progressFraction?: number }) => {
    fractions.push(progressFraction);
    return null;
  },
}));
vi.mock('@/app/reader/components/tts/TTSControl', () => ({ default: () => null }));
vi.mock('@/app/reader/components/rsvp', () => ({ RSVPControl: () => null }));

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

afterEach(() => {
  cleanup();
  clearBookProgress('book-1');
  fractions.length = 0;
});

// The cell no longer re-renders FooterBar on a page turn, so the footer reads
// the page from the progress it subscribes to.
describe('FooterBar page position', () => {
  it('follows a page turn without new props', () => {
    render(
      <FooterBar bookKey='book-1' bookFormat='EPUB' isHoveredAnim={false} gridInsets={insets} />,
    );
    act(() => {
      setBookProgress('book-1', {
        section: { current: 0, total: 3 },
        pageinfo: { current: 9, total: 40 },
      } as unknown as BookProgress);
    });

    expect(fractions.at(-1)).toBe(10 / 40);
  });
});
