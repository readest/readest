// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FooterBar from '@/app/reader/components/footerbar/FooterBar';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
import { clearChapterScreens, recordChapterScreens } from '@/utils/chapterScreens';
import type { BookProgress } from '@/types/book';
import type { NavigationHandlers } from '@/app/reader/components/footerbar/types';

// With Stable Page Numbers off, the progress slider moves through the same
// screen pages its label and the footer count (#7445, #7453).

const goToFraction = vi.hoisted(() => vi.fn());
const viewSettings = vi.hoisted(() => ({
  progressStyle: 'fraction',
  stablePageNumbers: false as boolean,
  scrolled: false,
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isMobile: false } }) }));
vi.mock('@/store/readerStore', () => {
  const view = {
    renderer: { page: 1, getContents: () => [] },
    getSectionFractions: () => [0, 0.25, 0.5, 1],
    goToFraction,
  };
  const state = {
    hoveredBookKey: 'book-1',
    setHoveredBookKey: vi.fn(),
    bottomBarTab: '',
    setBottomBarTab: vi.fn(),
    getView: () => view,
    getViewState: () => null,
    getProgress: () => null,
    getViewSettings: () => viewSettings,
  };
  return { useReaderStore: () => state };
});
// Three chapters of 3000, 3000 and 6000 bytes.
const bookData = vi.hoisted(() => ({
  isFixedLayout: false,
  bookDoc: { sections: [{ size: 3000 }, { size: 3000 }, { size: 6000 }] },
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
const footer = vi.hoisted(() => ({
  fraction: undefined as number | undefined,
  handlers: undefined as NavigationHandlers | undefined,
}));
vi.mock('@/app/reader/components/footerbar/DesktopFooterBar', () => ({
  default: (props: { progressFraction?: number; navigationHandlers: NavigationHandlers }) => {
    footer.fraction = props.progressFraction;
    footer.handlers = props.navigationHandlers;
    return null;
  },
}));
vi.mock('@/app/reader/components/tts/TTSControl', () => ({ default: () => null }));
vi.mock('@/app/reader/components/rsvp', () => ({ RSVPControl: () => null }));

const insets = { top: 0, right: 0, bottom: 0, left: 0 };
const renderFooter = () =>
  render(
    <FooterBar bookKey='book-1' bookFormat='EPUB' isHoveredAnim={false} gridInsets={insets} />,
  );

beforeEach(() => {
  viewSettings.stablePageNumbers = false;
  // Measured: 2 + 2 + 4 screens. The second screen of chapter 1 is page 4 of
  // 8; the byte grid calls it 5 / 9.
  recordChapterScreens('book-1', 0, 2);
  recordChapterScreens('book-1', 1, 2);
  recordChapterScreens('book-1', 2, 4);
  act(() => {
    setBookProgress('book-1', {
      section: { current: 1, total: 3 },
      pageinfo: { current: 4, total: 9 },
      fraction: 0.4,
    } as unknown as BookProgress);
  });
});

afterEach(() => {
  cleanup();
  clearBookProgress('book-1');
  clearChapterScreens('book-1');
  goToFraction.mockClear();
  vi.useRealTimers();
});

describe('FooterBar progress slider with Stable Page Numbers off', () => {
  it('sits at the screen page the footer shows', () => {
    renderFooter();
    expect(footer.fraction).toBe(4 / 8);
  });

  it('lands on the screen page its label previews', () => {
    vi.useFakeTimers();
    renderFooter();
    // 75% previews page ceil(0.75 * 8) = 6: the second of chapter 2's four
    // screens, 1 / 3 into it.
    footer.handlers!.onProgressChange(75);
    act(() => vi.advanceTimersByTime(200));
    expect(goToFraction).toHaveBeenCalledOnce();
    expect(goToFraction.mock.calls[0]![0]).toBeCloseTo(0.5 + (1 / 3) * 0.5);
  });

  it('keeps the byte-grid slider with Stable Page Numbers on', () => {
    viewSettings.stablePageNumbers = true;
    vi.useFakeTimers();
    renderFooter();
    expect(footer.fraction).toBe(5 / 9);
    footer.handlers!.onProgressChange(75);
    act(() => vi.advanceTimersByTime(200));
    expect(goToFraction).toHaveBeenCalledWith(0.75);
  });
});
