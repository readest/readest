import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import type { FoliateView } from '@/types/view';
import type { ViewSettings } from '@/types/book';
import type { TouchDetail } from '@/app/reader/hooks/useTouchInterceptor';

// The captured page-turn (slide/curl) swipe is handled by an app-side touch
// interceptor because `no-swipe` disables the paginator's own swipe. Push mode
// stays on the paginator's native swipe, which bows out while `scrollLocked`
// is set (instant highlight engaged). This test pins the captured turn to the
// same gate so a hold-then-swipe extends the highlight instead of paginating.
const h = vi.hoisted(() => ({
  controller: {
    turn: vi.fn(async () => {}),
    beginDrag: vi.fn(async () => true),
    moveDrag: vi.fn(),
    endDrag: vi.fn(async () => {}),
    dispose: vi.fn(),
  },
  renderer: {
    scrollLocked: false,
    atEnd: false,
    atStart: false,
    hasAttribute: () => false,
    setAttribute: () => {},
    removeAttribute: () => {},
  },
  viewSettings: {
    pageTurnStyle: 'curl',
    animated: true,
    scrolled: false,
    disableSwipe: false,
    isEink: false,
    rtl: false,
  } as ViewSettings,
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => h.viewSettings }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ isFixedLayout: false }) }),
}));
vi.mock('@/utils/bridge', () => ({ captureWebviewRegion: vi.fn() }));
vi.mock('@/utils/viewTransition', () => ({ detectViewTransitionGroup: () => false }));
vi.mock('@/app/reader/utils/capturedTurn', () => ({
  CapturedPageTurn: class {
    constructor() {
      Object.assign(this, h.controller);
    }
  },
}));

import { useCapturedTurn } from '@/app/reader/hooks/useCapturedTurn';
import { dispatchTouchInterceptors } from '@/app/reader/hooks/useTouchInterceptor';

const makeView = () =>
  ({ renderer: h.renderer, prev: vi.fn(), next: vi.fn() }) as unknown as FoliateView;

const detail = (phase: TouchDetail['phase'], deltaX = 0, deltaY = 0): TouchDetail => ({
  phase,
  touch: { screenX: 0, screenY: 0 },
  touchStart: { screenX: 0, screenY: 0 },
  deltaX,
  deltaY,
  deltaT: 16,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
  h.renderer.scrollLocked = false;
  h.renderer.atEnd = false;
  h.renderer.atStart = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

describe('useCapturedTurn scroll-lock gate', () => {
  test('a horizontal swipe starts the captured turn when scroll is not locked', () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    dispatchTouchInterceptors('book-1', detail('start'));
    const consumed = dispatchTouchInterceptors('book-1', detail('move', -60, 3));

    expect(consumed).toBe(true);
    expect(h.controller.beginDrag).toHaveBeenCalled();
  });

  test('scroll lock (instant highlight engaged) leaves the swipe to the highlight', () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    // Instant highlight has engaged after the still-hold: it locks scrolling.
    h.renderer.scrollLocked = true;
    dispatchTouchInterceptors('book-1', detail('start'));
    const consumed = dispatchTouchInterceptors('book-1', detail('move', -60, 3));

    expect(consumed).toBe(false);
    expect(h.controller.beginDrag).not.toHaveBeenCalled();
  });
});

describe('useCapturedTurn view.next replacement', () => {
  // The corner auto-turn awaits view.next() to keep its isAutoTurning guard up
  // (and the #873 selection scroll-pin suspended) until the turn settles. The
  // replaced view.next must return the turn's promise — discarding it resolves
  // awaiters while the page is still animating, and the pin snaps the turn back.
  test('the replaced view.next resolves only when the underlying turn settles', async () => {
    const savedStyle = h.viewSettings.pageTurnStyle;
    // push is never captured, so the wrapper takes the originals fallback path.
    h.viewSettings.pageTurnStyle = 'push';
    let resolveTurn!: () => void;
    const originalNext = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveTurn = r;
        }),
    );
    const view = {
      renderer: h.renderer,
      prev: vi.fn(),
      next: originalNext,
    } as unknown as FoliateView;
    renderHook(() => useCapturedTurn('book-1', { current: view }));

    const settled = vi.fn();
    Promise.resolve(view.next() as unknown as Promise<void>).then(settled);
    await new Promise((r) => setTimeout(r, 0));
    expect(originalNext).toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();

    resolveTurn();
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toHaveBeenCalled();
    h.viewSettings.pageTurnStyle = savedStyle;
  });
});
