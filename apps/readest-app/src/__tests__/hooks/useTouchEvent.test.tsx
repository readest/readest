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
import {
  registerTouchInterceptor,
  setLayeredTurnGestureActive,
  type TouchDetail,
} from '@/app/reader/hooks/useTouchInterceptor';

type Touch = { clientX: number; clientY: number; screenX: number; screenY: number };
const touch = (screenX: number, screenY: number): Touch => ({
  clientX: screenX,
  clientY: screenY,
  screenX,
  screenY,
});
const touchEvent = (touches: Touch[], timeStamp = 0, changedTouches: Touch[] = touches) => ({
  timeStamp,
  targetTouches: touches,
  changedTouches,
});

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
    setLayeredTurnGestureActive('book-1', false);
    pinchZoom = vi.fn();
    pinchEnd = vi.fn();
    mocks.hoveredBookKey = null;
    mocks.getBookData.mockReturnValue({ isFixedLayout: true });
    mocks.getViewSettings.mockReturnValue({ zoomLevel: 100, scrolled: true, vertical: false });
    mocks.getView.mockReturnValue({ renderer: { pinchZoom, pinchEnd } });
  });

  afterEach(() => {
    setLayeredTurnGestureActive('book-1', false);
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

  test.each([
    'curl',
    'slide',
  ] as const)('does not start hiding the toolbar before a captured %s turn claims the swipe', (pageTurnStyle) => {
    mocks.hoveredBookKey = 'book-1';
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      scrolled: false,
      vertical: false,
      pageTurnStyle,
    });
    const unregister = registerTouchInterceptor(
      'captured-turn-threshold-test',
      (_bookKey, detail) =>
        detail.phase === 'move' &&
        Math.abs(detail.deltaX) >= 15 &&
        Math.abs(detail.deltaX) > Math.abs(detail.deltaY),
      5,
    );

    try {
      const h = renderTouchHook();
      h.current.onTouchStart(touchEvent([touch(100, 300)], 100));
      h.current.onTouchMove(touchEvent([touch(88, 300)], 116));

      expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  test('does not pre-toggle a push turn until movement leaves the shared tap slop', () => {
    mocks.hoveredBookKey = 'book-1';
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      scrolled: false,
      vertical: false,
      pageTurnStyle: 'push',
    });
    const h = renderTouchHook();

    h.current.onTouchStart(touchEvent([touch(100, 300)], 100));
    h.current.onTouchMove(touchEvent([touch(88, 300)], 116));

    expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();

    h.current.onTouchMove(touchEvent([touch(84, 300)], 132));

    expect(mocks.setHoveredBookKey).toHaveBeenCalledWith(null);
  });

  test('does not hide a toolbar for tap-sized jitter in scrolled mode', () => {
    mocks.hoveredBookKey = 'book-1';
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      scrolled: true,
      vertical: false,
      pageTurnStyle: 'push',
    });
    const h = renderTouchHook();

    h.current.onTouchStart(touchEvent([touch(100, 300)], 100));
    h.current.onTouchMove(touchEvent([touch(106, 306)], 116));
    h.current.onTouchEnd(touchEvent([], 132, [touch(106, 306)]));

    expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();
  });

  test.each([
    'curl',
    'slide',
  ] as const)('leaves web %s toolbar hiding to the layered transition lifecycle', (pageTurnStyle) => {
    mocks.hoveredBookKey = 'book-1';
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      scrolled: false,
      vertical: false,
      pageTurnStyle,
      animated: true,
      isEink: false,
      disableSwipe: false,
    });
    mocks.getView.mockReturnValue({
      renderer: {
        getAttribute: (name: string) => (name === 'turn-style' ? pageTurnStyle : null),
      },
    });
    setLayeredTurnGestureActive('book-1', true);
    const h = renderTouchHook();

    h.current.onTouchStart(touchEvent([touch(200, 300)], 100));
    h.current.onTouchMove(touchEvent([touch(120, 300)], 180));
    // The lifecycle may finish before the iframe's queued touchend message is
    // delivered. Ownership must remain sticky for this gesture.
    setLayeredTurnGestureActive('book-1', false);
    h.current.onTouchEnd(touchEvent([], 220, [touch(120, 450)]));

    expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();
  });

  test.each([
    'curl',
    'slide',
  ] as const)('keeps the toolbar visible when a web %s turn claims after the pre-claim gap', (pageTurnStyle) => {
    mocks.hoveredBookKey = 'book-1';
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      scrolled: false,
      vertical: false,
      pageTurnStyle,
      animated: true,
      isEink: false,
      disableSwipe: false,
    });
    mocks.getView.mockReturnValue({
      renderer: {
        getAttribute: (name: string) => (name === 'turn-style' ? pageTurnStyle : null),
      },
    });
    const h = renderTouchHook();

    h.current.onTouchStart(touchEvent([touch(200, 300)], 100));
    // Readest's 15px native threshold has been crossed, but the paginator's
    // stricter browser-layered gate has not claimed the gesture yet.
    h.current.onTouchMove(touchEvent([touch(184, 300)], 116));
    expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();

    // The paginator synchronously claims on a later raw touchmove before its
    // forwarded iframe message arrives. Ownership stays sticky through the
    // cancellation lifecycle, even if `finished` precedes touchend delivery.
    setLayeredTurnGestureActive('book-1', true);
    h.current.onTouchMove(touchEvent([touch(175, 300)], 132));
    h.current.onTouchMove(touchEvent([touch(190, 300)], 148));
    setLayeredTurnGestureActive('book-1', false);
    h.current.onTouchEnd(touchEvent([], 164, [touch(190, 300)]));

    expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();
  });

  test.each([
    'curl',
    'slide',
  ] as const)('does not hide the toolbar when an unclaimed web %s turn is cancelled', (pageTurnStyle) => {
    mocks.hoveredBookKey = 'book-1';
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      scrolled: false,
      vertical: false,
      pageTurnStyle,
      animated: true,
      isEink: false,
      disableSwipe: false,
    });
    mocks.getView.mockReturnValue({
      renderer: {
        getAttribute: (name: string) => (name === 'turn-style' ? pageTurnStyle : null),
      },
    });
    const h = renderTouchHook();

    h.current.onTouchStart(touchEvent([touch(200, 300)], 100));
    h.current.onTouchMove(touchEvent([touch(184, 300)], 116));
    h.current.onTouchCancel(touchEvent([], 132, [touch(184, 300)]));

    expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();
  });

  test.each([
    'curl',
    'slide',
  ] as const)('defers an unclaimed web %s toolbar update until touchend', (pageTurnStyle) => {
    mocks.hoveredBookKey = 'book-1';
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      scrolled: false,
      vertical: false,
      pageTurnStyle,
      animated: true,
      isEink: false,
      disableSwipe: false,
    });
    mocks.getView.mockReturnValue({
      renderer: {
        getAttribute: (name: string) => (name === 'turn-style' ? pageTurnStyle : null),
      },
    });
    const h = renderTouchHook();

    h.current.onTouchStart(touchEvent([touch(200, 300)], 100));
    h.current.onTouchMove(touchEvent([touch(184, 300)], 116));
    expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();

    h.current.onTouchEnd(touchEvent([], 132, [touch(184, 300)]));
    expect(mocks.setHoveredBookKey).toHaveBeenCalledWith(null);
  });

  test.each([
    'curl',
    'slide',
  ] as const)('does not fade the web %s toolbar before a fast flick snapshot settles', (pageTurnStyle) => {
    mocks.hoveredBookKey = 'book-1';
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      scrolled: false,
      vertical: false,
      pageTurnStyle,
      animated: true,
      isEink: false,
      disableSwipe: false,
    });
    mocks.getView.mockReturnValue({
      renderer: {
        getAttribute: (name: string) => (name === 'turn-style' ? pageTurnStyle : null),
      },
    });
    setLayeredTurnGestureActive('book-1', true);
    const h = renderTouchHook();

    h.current.onTouchStart(touchEvent([touch(200, 300)], 100));
    h.current.onTouchEnd(touchEvent([], 160, [touch(120, 300)]));

    expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();
  });

  test('leaves native layered slide toolbar changes to the transition lifecycle', () => {
    mocks.hoveredBookKey = 'book-1';
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      scrolled: false,
      vertical: false,
      pageTurnStyle: 'slide',
      animated: true,
      isEink: false,
      disableSwipe: false,
    });
    mocks.getView.mockReturnValue({
      renderer: { getAttribute: (name: string) => (name === 'turn-style' ? 'slide' : null) },
    });
    setLayeredTurnGestureActive('book-1', true);
    const h = renderTouchHook();

    h.current.onTouchStart(touchEvent([touch(200, 300)], 100));
    h.current.onTouchMove(touchEvent([touch(120, 300)], 180));
    h.current.onTouchEnd(touchEvent([], 260, [touch(120, 300)]));

    expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();
  });

  test.each([
    ['scrolled', { scrolled: true }],
    ['animations disabled', { animated: false }],
    ['E-ink', { isEink: true }],
    ['swipe disabled', { disableSwipe: true }],
  ] as const)('uses generic toolbar hiding when a layered style is not active: %s', (_label, override) => {
    mocks.hoveredBookKey = 'book-1';
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      scrolled: false,
      vertical: false,
      pageTurnStyle: 'slide',
      animated: true,
      isEink: false,
      disableSwipe: false,
      ...override,
    });
    mocks.getView.mockReturnValue({
      renderer: { getAttribute: (name: string) => (name === 'turn-style' ? 'slide' : null) },
    });
    const h = renderTouchHook();

    h.current.onTouchStart(touchEvent([touch(200, 300)], 100));
    h.current.onTouchMove(touchEvent([touch(120, 300)], 180));

    expect(mocks.setHoveredBookKey).toHaveBeenCalledWith(null);
  });

  test('leaves a clean tap to the synthesized click toolbar handler', () => {
    mocks.hoveredBookKey = 'book-1';
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      scrolled: false,
      vertical: false,
      pageTurnStyle: 'slide',
    });
    const h = renderTouchHook();

    h.current.onTouchStart(touchEvent([touch(200, 300)], 100));
    h.current.onTouchEnd(touchEvent([], 160, [touch(203, 302)]));

    // usePagination owns iframe-single-click and performs the one toggle.
    // touchend must not pre-toggle the same gesture.
    expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();
  });

  test('uses the released finger position and time for the final gesture sample', () => {
    const details: TouchDetail[] = [];
    const unregister = registerTouchInterceptor('touch-end-sample-test', (_bookKey, detail) => {
      details.push(detail);
      return detail.phase === 'move';
    });

    try {
      const h = renderTouchHook();
      h.current.onTouchStart(touchEvent([touch(100, 300)], 100));
      h.current.onTouchMove(touchEvent([touch(60, 300)], 150));
      h.current.onTouchEnd(touchEvent([], 300, [touch(20, 300)]));

      expect(details.at(-1)).toMatchObject({
        phase: 'end',
        deltaX: -80,
        deltaY: 0,
        deltaT: 200,
      });
    } finally {
      unregister();
    }
  });

  test('forwards touch cancellation without toggling the toolbar', () => {
    const details: TouchDetail[] = [];
    const unregister = registerTouchInterceptor('touch-cancel-test', (_bookKey, detail) => {
      details.push(detail);
      return detail.phase === 'move' || detail.phase === 'cancel';
    });
    mocks.hoveredBookKey = 'book-1';
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    mocks.getViewSettings.mockReturnValue({
      zoomLevel: 100,
      scrolled: false,
      vertical: false,
      pageTurnStyle: 'push',
    });

    try {
      const h = renderTouchHook();
      h.current.onTouchStart(touchEvent([touch(100, 300)], 100));
      h.current.onTouchMove(touchEvent([touch(60, 300)], 150));
      h.current.onTouchCancel(touchEvent([], 220, [touch(40, 300)]));

      expect(details.at(-1)).toMatchObject({
        phase: 'cancel',
        deltaX: -60,
        deltaY: 0,
        deltaT: 120,
      });
      expect(mocks.setHoveredBookKey).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
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
