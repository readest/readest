import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FooterBar from '@/app/reader/components/footerbar/FooterBar';

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
  useBookDataStore: () => ({ getConfig: () => null, setConfig: vi.fn(), getBookData: () => null }),
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

// The strip along the bottom edge reveals the footer on mouseenter, and the
// footer hides on its own mouseleave. A pointer that crosses the strip and
// lands in the book with its next move (coming up from a taskbar that covers
// most of the strip, #6999) never entered the footer, so only the strip sees
// it go.
describe('FooterBar hover strip (#6999)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    setHoveredBookKey.mockReset();
  });

  const renderWithFooterAt = () => {
    const { container } = render(
      <FooterBar bookKey='book-1' bookFormat='EPUB' isHoveredAnim={false} gridInsets={insets} />,
    );
    vi.spyOn(screen.getByRole('contentinfo'), 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 1440,
      top: 848,
      bottom: 900,
    } as DOMRect);
    return container.querySelector('div[role="none"]') as HTMLElement;
  };

  it('hides the footer when the pointer leaves the strip for the book', () => {
    const strip = renderWithFooterAt();
    fireEvent.mouseLeave(strip, { clientX: 700, clientY: 600 });
    expect(setHoveredBookKey).toHaveBeenCalledWith('');
  });

  it('keeps the footer when the pointer leaves the strip for the footer itself', () => {
    const strip = renderWithFooterAt();
    fireEvent.mouseLeave(strip, { clientX: 700, clientY: 870 });
    expect(setHoveredBookKey).not.toHaveBeenCalledWith('');
  });
});
