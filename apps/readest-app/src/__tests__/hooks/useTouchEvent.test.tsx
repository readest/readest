import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Shared mock state so each test can configure the stores/renderer and inspect
// the calls the hook makes back into them.
const mocks = vi.hoisted(() => {
  return {
    hoveredBookKey: null as string | null,
    setHoveredBookKey: vi.fn(),
    getViewSettings: vi.fn(),
    getView: vi.fn(),
    getBookData: vi.fn(),
    dispatch: vi.fn(),
  };
});

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: mocks.hoveredBookKey,
    setHoveredBookKey: mocks.setHoveredBookKey,
    getViewSettings: mocks.getViewSettings,
    getView: mocks.getView,
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: mocks.getBookData }),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: mocks.dispatch },
}));

import { useTouchEvent } from '@/app/reader/hooks/useIframeEvents';

type Touch = { clientX: number; clientY: number; screenX: number; screenY: number };
const touch = (screenX: number, screenY: number): Touch => ({
  clientX: screenX,
  clientY: screenY,
  screenX,
  screenY,
});
const touchEvent = (touches: Touch[], timeStamp = 0) => ({ timeStamp, targetTouches: touches });

type Handlers = ReturnType<typeof useTouchEvent>;

const renderTouchHook = () => {
  const ref: { current: Handlers | null } = { current: null };
  function Wrapper() {
    ref.current = useTouchEvent('book-1');
    return null;
  }
  render(<Wrapper />);
  return ref as { current: Handlers };
};

describe('useTouchEvent pinch vs two-finger scroll', () => {
  let pinchZoom: ReturnType<typeof vi.fn>;
  let pinchEnd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pinchZoom = vi.fn();
    pinchEnd = vi.fn();
    mocks.hoveredBookKey = null;
    mocks.getBookData.mockReturnValue({ isFixedLayout: true });
    mocks.getViewSettings.mockReturnValue({ zoomLevel: 100, scrolled: true, vertical: false });
    mocks.getView.mockReturnValue({ renderer: { pinchZoom, pinchEnd } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('two fingers moving in the same direction (scroll) do not zoom', () => {
    const h = renderTouchHook();
    // Two fingers land ~100px apart.
    h.current.onTouchStart(touchEvent([touch(100, 300), touch(200, 300)], 0));
    // Both fingers travel ~80px upward. Human scroll is not perfectly parallel,
    // so the finger spacing drifts from 100px to 120px — enough that a naive
    // ratio (currentDist/initialDist = 1.2) would zoom to 120%.
    h.current.onTouchMove(touchEvent([touch(95, 220), touch(215, 220)], 16));
    h.current.onTouchEnd(touchEvent([], 32));

    expect(pinchZoom).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalledWith('pinch-zoom', expect.anything());
  });

  test('two fingers moving in opposite directions (pinch) zoom in', () => {
    const h = renderTouchHook();
    h.current.onTouchStart(touchEvent([touch(150, 300), touch(250, 300)], 0));
    // Spread apart: midpoint stays fixed, separation grows 100 -> 160 -> 200.
    h.current.onTouchMove(touchEvent([touch(120, 300), touch(280, 300)], 16));
    h.current.onTouchMove(touchEvent([touch(100, 300), touch(300, 300)], 32));
    h.current.onTouchEnd(touchEvent([], 48));

    expect(pinchZoom).toHaveBeenCalled();
    expect(pinchEnd).toHaveBeenCalled();
    const dispatched = mocks.dispatch.mock.calls.find((c) => c[0] === 'pinch-zoom');
    expect(dispatched).toBeTruthy();
    // Zoomed in beyond the starting 100%.
    expect(dispatched![1].zoomLevel).toBeGreaterThan(100);
  });

  test('tiny finger jitter below the deadzone does not zoom', () => {
    const h = renderTouchHook();
    h.current.onTouchStart(touchEvent([touch(150, 300), touch(250, 300)], 0));
    // Separation wobbles by only a few px — noise, not intent.
    h.current.onTouchMove(touchEvent([touch(148, 300), touch(253, 300)], 16));
    h.current.onTouchEnd(touchEvent([], 32));

    expect(pinchZoom).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalledWith('pinch-zoom', expect.anything());
  });
});

// Swipe-up toggles the header/footer bars — but never when the swipe is a
// vertical pan of an overflowing fixed-layout page (#5142: fit-width in
// landscape overflows vertically even at 100% zoom).
describe('useTouchEvent swipe-up bar toggle on fixed-layout', () => {
  const swipeUp = (h: { current: Handlers }) => {
    h.current.onTouchStart(touchEvent([touch(100, 500)], 0));
    h.current.onTouchMove(touchEvent([touch(100, 300)], 50));
    h.current.onTouchEnd(touchEvent([], 100));
  };

  const fxlView = (isOverflowY: boolean) => ({
    book: { rendition: { layout: 'pre-paginated' } },
    isOverflowY: () => isOverflowY,
    renderer: {},
  });

  beforeEach(() => {
    mocks.hoveredBookKey = null;
    mocks.getBookData.mockReturnValue({ isFixedLayout: true });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      zoomMode: 'fit-width',
      scrolled: false,
      vertical: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('swipe up on a vertically overflowing page (fit-width landscape) pans, not toggles', () => {
    mocks.getView.mockReturnValue(fxlView(true));
    const h = renderTouchHook();
    swipeUp(h);

    expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();
  });

  test('swipe up still toggles the bars when the page fits vertically', () => {
    mocks.getView.mockReturnValue(fxlView(false));
    const h = renderTouchHook();
    swipeUp(h);

    expect(mocks.setHoveredBookKey).toHaveBeenCalledWith('book-1');
  });

  test('swipe up on a zoomed page with vertical overflow pans, not toggles', () => {
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 150,
      zoomMode: 'fit-page',
      scrolled: false,
      vertical: false,
    });
    mocks.getView.mockReturnValue(fxlView(true));
    const h = renderTouchHook();
    swipeUp(h);

    expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();
  });

  test('swipe up toggles on a zoomed page that still fits vertically', () => {
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 150,
      zoomMode: 'fit-page',
      scrolled: false,
      vertical: false,
    });
    mocks.getView.mockReturnValue(fxlView(false));
    const h = renderTouchHook();
    swipeUp(h);

    expect(mocks.setHoveredBookKey).toHaveBeenCalledWith('book-1');
  });
});
