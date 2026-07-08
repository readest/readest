import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FooterBar from '@/app/reader/components/footerbar/FooterBar';
import { DEFAULT_VIEW_CONFIG } from '@/services/constants';
import type { ViewSettings } from '@/types/book';

// The desktop hover trigger used to be a 52px-tall full-width strip covering
// the entire footer band. Hovering anywhere near the ProgressBar info text
// (which is only ~12px tall inside that band) started the reveal timer, so
// the nav bar popped up over the text and swallowed the click the user was
// aiming at it ("the progress bar isn't tappable"). The trigger is now a
// thin strip at the very bottom edge, spatially below the info text, and it
// only fires after a hover-intent dwell.
const setHoveredBookKey = vi.fn();

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: { isMobile: false, hasRoundedWindow: false, isAndroidApp: false },
  }),
}));

let currentViewSettings: ViewSettings;
vi.mock('@/store/readerStore', () => {
  const state = () => ({
    hoveredBookKey: '',
    setHoveredBookKey,
    getView: () => ({ renderer: { getContents: () => [] }, history: {} }),
    getViewState: () => ({ ttsEnabled: false }),
    getProgress: () => null,
    getViewSettings: () => currentViewSettings,
  });
  return {
    useReaderStore: <R,>(selector?: (s: ReturnType<typeof state>) => R) =>
      selector ? selector(state()) : state(),
  };
});

vi.mock('@/store/sidebarStore', () => {
  const state = {
    isSideBarVisible: false,
    isSideBarPinned: false,
    setSideBarVisible: () => {},
  };
  return {
    useSidebarStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/store/bookDataStore', () => {
  const state = {
    getConfig: () => null,
    setConfig: () => {},
    getBookData: () => ({ isFixedLayout: false }),
  };
  return {
    useBookDataStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/store/deviceStore', () => {
  const state = { acquireBackKeyInterception: () => {}, releaseBackKeyInterception: () => {} };
  return {
    useDeviceControlStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/app/reader/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: () => {} }));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: () => {}, onSync: () => {}, offSync: () => {} },
}));
vi.mock('@/app/reader/components/footerbar/MobileFooterBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/footerbar/DesktopFooterBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/tts/TTSControl', () => ({ default: () => null }));
vi.mock('@/app/reader/components/rsvp', () => ({ RSVPControl: () => null }));

const renderFooterBar = () =>
  render(
    <FooterBar
      bookKey='book-1'
      bookFormat='EPUB'
      section={undefined}
      pageinfo={undefined}
      isHoveredAnim={false}
      gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
    />,
  );

beforeEach(() => {
  vi.useFakeTimers();
  setHoveredBookKey.mockClear();
  currentViewSettings = { ...DEFAULT_VIEW_CONFIG } as ViewSettings;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FooterBar — hover trigger zone', () => {
  it('is a thin bottom-edge strip below the footer info text, stacked under it', () => {
    const { container } = renderFooterBar();

    const zone = container.querySelector('.footer-hover-zone') as HTMLElement;
    expect(zone).not.toBeNull();
    // Thin edge strip, not the 52px band that covered the info text.
    expect(zone.classList.contains('h-3')).toBe(true);
    expect(zone.classList.contains('h-[52px]')).toBe(false);
    // Below the ProgressBar overlay (z-10) so the text always wins the pointer.
    expect(zone.classList.contains('z-0')).toBe(true);
  });

  it('summons the bar only after the hover-intent dwell', () => {
    const { container } = renderFooterBar();

    const zone = container.querySelector('.footer-hover-zone') as HTMLElement;
    fireEvent.mouseEnter(zone);
    vi.advanceTimersByTime(299);
    expect(setHoveredBookKey).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setHoveredBookKey).toHaveBeenCalledWith('book-1');
  });

  it('does not summon the bar when the pointer just passes through', () => {
    const { container } = renderFooterBar();

    const zone = container.querySelector('.footer-hover-zone') as HTMLElement;
    fireEvent.mouseEnter(zone);
    vi.advanceTimersByTime(150);
    fireEvent.mouseLeave(zone);
    vi.advanceTimersByTime(1000);
    expect(setHoveredBookKey).not.toHaveBeenCalled();
  });
});
