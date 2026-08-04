import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import BookmarkPullDown from '@/app/reader/components/BookmarkPullDown';
import {
  registerBookmarkPullDoc,
  setBookmarkPullHandlers,
  BOOKMARK_PULL_TRIGGER_PX,
} from '@/app/reader/utils/bookmarkPullGesture';
import { setLayeredTurnTouchClaimed } from '@/app/reader/utils/iframeEventHandlers';
import { eventDispatcher } from '@/utils/event';

const BOOK_KEY = 'book-1';

let currentViewSettings: Record<string, unknown>;
let currentRibbonVisible: boolean;
let currentHoveredBookKey: string | null = null;
let hoverCalls: (string | null)[] = [];

vi.mock('@/store/readerStore', () => {
  const buildState = () => ({
    viewStates: { [BOOK_KEY]: { ribbonVisible: currentRibbonVisible } },
    hoveredBookKey: currentHoveredBookKey,
    getViewSettings: () => currentViewSettings,
    setHoveredBookKey: (key: string | null) => {
      hoverCalls.push(key);
      currentHoveredBookKey = key;
    },
  });
  const useReaderStore = <R,>(selector?: (s: ReturnType<typeof buildState>) => R) => {
    const state = buildState();
    return selector ? selector(state) : state;
  };
  useReaderStore.getState = buildState;
  return { useReaderStore };
});

vi.mock('@/store/bookDataStore', () => {
  const buildState = () => ({
    getBookData: () => ({ isFixedLayout: false }),
  });
  const useBookDataStore = <R,>(selector?: (s: ReturnType<typeof buildState>) => R) => {
    const state = buildState();
    return selector ? selector(state) : state;
  };
  useBookDataStore.getState = buildState;
  return { useBookDataStore };
});

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 48, right: 0, bottom: 0, left: 0 } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/app/reader/utils/iframeEventHandlers', () => ({
  setLayeredTurnTouchClaimed: vi.fn(),
}));

// Deterministic rAF: callbacks queue up and run only when the test flushes
// them with an explicit timestamp, so the release spring can be stepped.
let rafQueue: FrameRequestCallback[] = [];
const flushRaf = (now: number) => {
  const cbs = rafQueue;
  rafQueue = [];
  cbs.forEach((cb) => cb(now));
};

const touchEvent = (type: string, y: number, x = 200): Event => {
  const event = new Event(type, { cancelable: true, bubbles: true });
  const point = { screenX: x, screenY: y, clientX: x, clientY: y };
  Object.assign(event, {
    touches: type === 'touchend' || type === 'touchcancel' ? [] : [point],
    changedTouches: [point],
  });
  return event;
};

const dispatchTouch = (type: string, y: number, x = 200) => {
  act(() => {
    document.dispatchEvent(touchEvent(type, y, x));
  });
};

describe('BookmarkPullDown', () => {
  let slide: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    rafQueue = [];
    currentViewSettings = { scrolled: false, vertical: false, isEink: false };
    currentRibbonVisible = false;
    currentHoveredBookKey = null;
    hoverCalls = [];
    slide = document.createElement('div');
    vi.mocked(setLayeredTurnTouchClaimed).mockClear();
    registerBookmarkPullDoc(BOOK_KEY, document);
  });

  afterEach(() => {
    setBookmarkPullHandlers(BOOK_KEY, null);
    cleanup();
    vi.unstubAllGlobals();
  });

  const renderComponent = (ribbonHidden = false) =>
    render(
      <BookmarkPullDown
        bookKey={BOOK_KEY}
        ribbonHidden={ribbonHidden}
        slideRef={{ current: slide }}
      />,
    );

  it('shows nothing at rest without a bookmark, and the resting ribbon with one', () => {
    const { container, rerender } = renderComponent();
    expect(container.querySelector('.ribbon')).toBeNull();
    expect(container.querySelector('.bookmark-pull-band')).toBeNull();

    currentRibbonVisible = true;
    rerender(
      <BookmarkPullDown bookKey={BOOK_KEY} ribbonHidden={false} slideRef={{ current: slide }} />,
    );
    expect(container.querySelector('.ribbon')).not.toBeNull();
  });

  it('does not engage in scrolled mode', () => {
    const { container } = renderComponent();
    currentViewSettings = { scrolled: true, vertical: false, isEink: false };
    dispatchTouch('touchstart', 300);
    dispatchTouch('touchmove', 400);
    expect(container.querySelector('.bookmark-pull-band')).toBeNull();
  });

  it('activates on a downward drag, flips at the threshold, and previews the release state', () => {
    const { container, getByText } = renderComponent();

    dispatchTouch('touchstart', 300);
    // below activation: still nothing
    dispatchTouch('touchmove', 310);
    expect(container.querySelector('.bookmark-pull-band')).toBeNull();

    // past activation: band + "pull down" hint; outline ribbon previews "still no bookmark"
    dispatchTouch('touchmove', 330);
    expect(container.querySelector('.bookmark-pull-band')).not.toBeNull();
    expect(getByText('Pull down to add bookmark')).toBeTruthy();
    const polygon = container.querySelector('.bookmark-pull-ribbon polygon') as SVGElement;
    expect(polygon.getAttribute('fill')).toBe('none');

    // past the trigger: "release" hint; filled ribbon previews "will be bookmarked"
    dispatchTouch('touchmove', 300 + BOOKMARK_PULL_TRIGGER_PX + 10);
    expect(getByText('Release to add bookmark')).toBeTruthy();
    expect(polygon.getAttribute('fill')).toBe('#F44336');

    // offset applied to the slide wrapper on the next frame (1:1 in the linear range)
    act(() => flushRaf(0));
    expect(slide.style.transform).toBe(`translate3d(0, ${BOOKMARK_PULL_TRIGGER_PX + 10}px, 0)`);
  });

  it('toggles the bookmark on release past the threshold and springs back', () => {
    const { container } = renderComponent();
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    dispatchTouch('touchstart', 300);
    dispatchTouch('touchmove', 330);
    dispatchTouch('touchmove', 300 + BOOKMARK_PULL_TRIGGER_PX + 20);
    dispatchTouch('touchend', 300 + BOOKMARK_PULL_TRIGGER_PX + 20);

    expect(dispatchSpy).toHaveBeenCalledWith('toggle-bookmark', { bookKey: BOOK_KEY });
    expect(setLayeredTurnTouchClaimed).toHaveBeenCalledWith(BOOK_KEY, false);

    // spring back: first frame seeds the clock, a +400ms frame finishes it
    act(() => flushRaf(1000));
    act(() => flushRaf(1400));
    expect(container.querySelector('.bookmark-pull-band')).toBeNull();
    expect(slide.style.transform).toBe('');
    dispatchSpy.mockRestore();
  });

  it('does not toggle when released below the threshold', () => {
    renderComponent();
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    dispatchTouch('touchstart', 300);
    dispatchTouch('touchmove', 350);
    dispatchTouch('touchend', 350);

    expect(dispatchSpy).not.toHaveBeenCalledWith('toggle-bookmark', { bookKey: BOOK_KEY });
    dispatchSpy.mockRestore();
  });

  it('dismisses the visible toolbars instead of engaging the pull', () => {
    currentHoveredBookKey = BOOK_KEY;
    const { container } = renderComponent();
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    dispatchTouch('touchstart', 300);
    dispatchTouch('touchmove', 330);
    expect(hoverCalls).toEqual(['']); // bars dismissed by the pull
    expect(container.querySelector('.bookmark-pull-band')).toBeNull(); // gesture yields

    dispatchTouch('touchmove', 300 + BOOKMARK_PULL_TRIGGER_PX + 20);
    dispatchTouch('touchend', 300 + BOOKMARK_PULL_TRIGGER_PX + 20);
    expect(dispatchSpy).not.toHaveBeenCalledWith('toggle-bookmark', { bookKey: BOOK_KEY });
    dispatchSpy.mockRestore();
  });

  it('shows remove wording while bookmarked', () => {
    currentRibbonVisible = true;
    const { getByText } = renderComponent();

    dispatchTouch('touchstart', 300);
    dispatchTouch('touchmove', 330);
    expect(getByText('Pull down to remove bookmark')).toBeTruthy();

    dispatchTouch('touchmove', 300 + BOOKMARK_PULL_TRIGGER_PX + 30);
    expect(getByText('Release to remove bookmark')).toBeTruthy();
  });
});
