import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { FoliateView } from '@/types/view';
import type { ViewSettings } from '@/types/book';
import type { TouchDetail } from '@/app/reader/hooks/useTouchInterceptor';

// The captured page-turn (slide/curl) swipe is handled by an app-side touch
// interceptor because `no-swipe` disables the paginator's own swipe. Push mode
// stays on the paginator's native swipe, which bows out while `scrollLocked`
// is set (instant highlight engaged). This test pins the captured turn to the
// same gate so a hold-then-swipe extends the highlight instead of paginating.
const h = vi.hoisted(() => ({
  controllerHost: null as null | {
    onBeforeCapture?: (style: 'curl' | 'slide') => Promise<void> | void;
    onCovered?: (style: 'curl' | 'slide') => Promise<void> | void;
    onCancelled?: (style: 'curl' | 'slide') => Promise<void> | void;
  },
  hoveredBookKey: 'book-1' as string | null,
  setHoveredBookKey: vi.fn(),
  controller: {
    turn: vi.fn(async () => {}),
    beginDrag: vi.fn(async () => true),
    moveDrag: vi.fn(),
    endDrag: vi.fn(async () => {}),
    dispose: vi.fn(),
  },
  selection: null as { rangeCount: number; isCollapsed: boolean } | null,
  renderer: {
    listeners: new Map<string, Set<EventListener>>(),
    scrollLocked: false,
    atEnd: false,
    atStart: false,
    primaryIndex: 0,
    getContents() {
      return [{ index: 0, doc: { getSelection: () => h.selection } }];
    },
    hasAttribute: () => false,
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener(type: string, listener: EventListener) {
      const listeners = this.listeners.get(type) ?? new Set<EventListener>();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    },
    removeEventListener(type: string, listener: EventListener) {
      this.listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: Event) {
      for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    },
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

vi.mock('@/store/readerStore', () => {
  const useReaderStore = () => ({
    getViewSettings: () => h.viewSettings,
    setHoveredBookKey: h.setHoveredBookKey,
  });
  useReaderStore.getState = () => ({ hoveredBookKey: h.hoveredBookKey });
  return { useReaderStore };
});
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ isFixedLayout: false }) }),
}));
vi.mock('@/utils/bridge', () => ({ captureWebviewRegion: vi.fn() }));
vi.mock('@/utils/viewTransition', () => ({ detectViewTransitionGroup: () => false }));
vi.mock('@/app/reader/utils/capturedTurn', () => ({
  CapturedPageTurn: class {
    constructor(host: NonNullable<typeof h.controllerHost>) {
      h.controllerHost = host;
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
  h.controller.beginDrag.mockResolvedValue(true);
  h.setHoveredBookKey.mockReset();
  vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
  h.renderer.scrollLocked = false;
  h.renderer.atEnd = false;
  h.renderer.atStart = false;
  h.selection = null;
  h.renderer.listeners.clear();
  h.controllerHost = null;
  h.hoveredBookKey = 'book-1';
});

afterEach(() => {
  vi.unstubAllEnvs();
  document.getElementById('gridcell-book-1')?.remove();
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

  test('catches the captured drag up to the activation-threshold distance', async () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    dispatchTouchInterceptors('book-1', detail('start'));
    dispatchTouchInterceptors('book-1', detail('move', -15, 0));
    await act(async () => {
      await Promise.resolve();
    });

    expect(h.controller.moveDrag).toHaveBeenLastCalledWith(15 / window.innerWidth, 0.5);
  });

  test('preserves total travel when horizontal intent is recognized later', async () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    dispatchTouchInterceptors('book-1', detail('start'));
    dispatchTouchInterceptors('book-1', detail('move', -60, 80));
    expect(h.controller.beginDrag).not.toHaveBeenCalled();

    dispatchTouchInterceptors('book-1', detail('move', -100, 80));
    await act(async () => {
      await Promise.resolve();
    });

    expect(h.controller.moveDrag).toHaveBeenLastCalledWith(
      100 / window.innerWidth,
      expect.any(Number),
    );
  });

  test('forwards the latest sample before queueing release while capture is pending', async () => {
    let finishCapture!: (ok: boolean) => void;
    h.controller.beginDrag.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (finishCapture = resolve)),
    );
    const cell = document.createElement('div');
    cell.id = 'gridcell-book-1';
    vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 500));
    document.body.appendChild(cell);
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    dispatchTouchInterceptors('book-1', detail('start'));
    dispatchTouchInterceptors('book-1', detail('move', -15, 0));
    dispatchTouchInterceptors('book-1', detail('move', -240, 10));
    const released = dispatchTouchInterceptors('book-1', detail('end', -240, 10));

    expect(released).toBe(true);
    expect(h.controller.endDrag).toHaveBeenCalledWith(true);
    const lastSample = h.controller.moveDrag.mock.calls.at(-1)!;
    // 240px of total travel across the 300px captured reader cell.
    expect(lastSample[0]).toBeCloseTo(0.8);
    expect(lastSample[1]).toBeCloseTo(0.52);
    expect(h.controller.moveDrag.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      h.controller.endDrag.mock.invocationCallOrder[0]!,
    );

    await act(async () => {
      finishCapture(true);
      await Promise.resolve();
    });
  });

  test('commits a short fast flick before halfway', () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    dispatchTouchInterceptors('book-1', detail('start'));
    dispatchTouchInterceptors('book-1', detail('move', -20, 0));
    dispatchTouchInterceptors('book-1', { ...detail('end', -20, 0), deltaT: 50 });

    // 20px / 50ms = 0.4px/ms, above the 0.3 flick threshold.
    expect(h.controller.endDrag).toHaveBeenCalledWith(true);
  });

  test('cancels an unfinished drag before accepting a replacement touch sequence', () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    dispatchTouchInterceptors('book-1', detail('start'));
    dispatchTouchInterceptors('book-1', detail('move', -60, 0));
    dispatchTouchInterceptors('book-1', detail('start'));
    dispatchTouchInterceptors('book-1', detail('move', -60, 0));

    expect(h.controller.beginDrag).toHaveBeenCalledTimes(2);
    expect(h.controller.endDrag).toHaveBeenCalledWith(false);
    expect(h.controller.endDrag.mock.invocationCallOrder[0]!).toBeLessThan(
      h.controller.beginDrag.mock.invocationCallOrder[1]!,
    );
  });

  test('touch cancellation always reverses an active captured drag', () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    dispatchTouchInterceptors('book-1', detail('start'));
    dispatchTouchInterceptors('book-1', detail('move', -60, 3));
    const consumed = dispatchTouchInterceptors('book-1', detail('cancel', -60, 3));

    expect(consumed).toBe(true);
    expect(h.controller.endDrag).toHaveBeenCalledWith(false);
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

  // Non-instant selection: a long-press selection (or a drag of its handles)
  // moves the finger horizontally without engaging scrollLocked. The push
  // paginator's native swipe bows out when the primary document holds a
  // non-collapsed selection (#onTouchMove); the captured slide/curl
  // interceptor must honor the same gate or it turns the page mid-selection
  // (iOS 18.7, where slide/curl always take the captured path).
  test('an active text selection leaves the swipe to the selection', () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    h.selection = { rangeCount: 1, isCollapsed: false };
    dispatchTouchInterceptors('book-1', detail('start'));
    const consumed = dispatchTouchInterceptors('book-1', detail('move', -60, 3));

    expect(consumed).toBe(false);
    expect(h.controller.beginDrag).not.toHaveBeenCalled();
  });

  test('a collapsed selection does not block the captured turn', () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    h.selection = { rangeCount: 1, isCollapsed: true };
    dispatchTouchInterceptors('book-1', detail('start'));
    const consumed = dispatchTouchInterceptors('book-1', detail('move', -60, 3));

    expect(consumed).toBe(true);
    expect(h.controller.beginDrag).toHaveBeenCalled();
  });

  // A drag of the system selection handles adjusts the selection; app code can
  // deselect mid-drag (the instant quick action dismisses on selectionchange),
  // and on iOS WebKit the native handle drag re-confirms the selection right
  // after. The collapsed-selection window between the two must not let the
  // handle drag morph into a page turn: a gesture that began with an active
  // selection is a selection gesture for its whole lifetime.
  test('a gesture that starts with a selection never turns, even if deselected mid-drag', () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    h.selection = { rangeCount: 1, isCollapsed: false };
    dispatchTouchInterceptors('book-1', detail('start'));
    // Mid-gesture deselect (e.g. the quick action's dismiss).
    h.selection = null;
    const consumed = dispatchTouchInterceptors('book-1', detail('move', -60, 3));

    expect(consumed).toBe(false);
    expect(h.controller.beginDrag).not.toHaveBeenCalled();
  });

  test('the selection latch clears on the next gesture', () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    h.selection = { rangeCount: 1, isCollapsed: false };
    dispatchTouchInterceptors('book-1', detail('start'));
    h.selection = null;
    dispatchTouchInterceptors('book-1', detail('end', -60, 3));

    // A fresh gesture with no selection swipes normally.
    dispatchTouchInterceptors('book-1', detail('start'));
    const consumed = dispatchTouchInterceptors('book-1', detail('move', -60, 3));

    expect(consumed).toBe(true);
    expect(h.controller.beginDrag).toHaveBeenCalled();
  });

  // Instant highlighting locks scrolling for the drag and unlocks at release —
  // but the unlock runs before the gesture's queued trailing touchmoves are
  // delivered, and their deltas span the whole highlight stroke. A gesture
  // that was ever blocked by the lock must stay claimed to its end, or those
  // trailing moves read as a full swipe and start a stray captured drag whose
  // endDrag races the capture (the stranded-overlay bug).
  test('a gesture ever blocked by scroll lock never turns, even after unlock', () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    dispatchTouchInterceptors('book-1', detail('start'));
    h.renderer.scrollLocked = true;
    dispatchTouchInterceptors('book-1', detail('move', -30, 3));
    // Instant highlight released: unlocked before the queued moves arrive.
    h.renderer.scrollLocked = false;
    const consumed = dispatchTouchInterceptors('book-1', detail('move', -70, 3));

    expect(consumed).toBe(false);
    expect(h.controller.beginDrag).not.toHaveBeenCalled();
  });

  test('the scroll-lock claim clears on the next gesture', () => {
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    dispatchTouchInterceptors('book-1', detail('start'));
    h.renderer.scrollLocked = true;
    dispatchTouchInterceptors('book-1', detail('move', -30, 3));
    h.renderer.scrollLocked = false;
    dispatchTouchInterceptors('book-1', detail('end', -70, 3));

    dispatchTouchInterceptors('book-1', detail('start'));
    const consumed = dispatchTouchInterceptors('book-1', detail('move', -60, 3));

    expect(consumed).toBe(true);
    expect(h.controller.beginDrag).toHaveBeenCalled();
  });

  test.each([
    'curl',
    'slide',
  ] as const)('hides live toolbar without transitions once the %s snapshot covers it', async (style) => {
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);
    h.setHoveredBookKey.mockImplementationOnce(() => {
      expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(true);
    });
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    await act(async () => {
      await h.controllerHost?.onBeforeCapture?.(style);
      await h.controllerHost?.onCovered?.(style);
    });

    expect(h.setHoveredBookKey).toHaveBeenCalledWith(null);
    expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(false);
  });

  test.each([
    'curl',
    'slide',
  ] as const)('restores a previously visible toolbar when a %s turn is cancelled', async (style) => {
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    await act(async () => {
      await h.controllerHost?.onBeforeCapture?.(style);
      await h.controllerHost?.onCovered?.(style);
      await h.controllerHost?.onCancelled?.(style);
    });

    expect(h.setHoveredBookKey.mock.calls).toEqual([[null], ['book-1']]);
  });

  test('does not show the toolbar after cancellation when it started hidden', async () => {
    h.hoveredBookKey = null;
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    await act(async () => {
      await h.controllerHost?.onBeforeCapture?.('curl');
      await h.controllerHost?.onCovered?.('curl');
      await h.controllerHost?.onCancelled?.('curl');
    });

    expect(h.setHoveredBookKey).not.toHaveBeenCalled();
  });

  test('restores the toolbar state captured before the snapshot starts', async () => {
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    await act(async () => {
      await h.controllerHost?.onBeforeCapture?.('curl');
      // A later event must not overwrite the gesture's original UI state.
      h.hoveredBookKey = null;
      await h.controllerHost?.onCovered?.('curl');
      await h.controllerHost?.onCancelled?.('curl');
    });

    expect(h.setHoveredBookKey.mock.calls).toEqual([[null], ['book-1']]);
  });

  test('paints the snapshot before hiding chrome and keeps transitions disabled for a painted frame', async () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    try {
      await h.controllerHost?.onBeforeCapture?.('curl');
      const covered = Promise.resolve(h.controllerHost?.onCovered?.('curl'));

      // The live toolbar must remain untouched until the flat snapshot has
      // survived a rendering opportunity.
      expect(h.setHoveredBookKey).not.toHaveBeenCalled();
      frames.shift()?.(16);
      await Promise.resolve();
      expect(h.setHoveredBookKey).not.toHaveBeenCalled();
      frames.shift()?.(32);
      await Promise.resolve();

      expect(h.setHoveredBookKey).toHaveBeenCalledWith(null);
      expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(true);

      // Keep transition:none through another painted frame before restoring
      // the normal CSS transition declaration.
      frames.shift()?.(48);
      await Promise.resolve();
      expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(true);
      frames.shift()?.(64);
      await covered;
      expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(false);
    } finally {
      raf.mockRestore();
    }
  });

  test('synchronizes toolbar state with a native layered slide lifecycle', async () => {
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    const dispatch = (phase: string) =>
      h.renderer.dispatchEvent(
        new CustomEvent('layered-turn-state', {
          detail: { phase, style: 'slide', forward: true },
        }),
      );

    act(() => {
      dispatch('before-capture');
      dispatch('covered');
    });
    expect(h.setHoveredBookKey).toHaveBeenLastCalledWith(null);
    expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(true);

    act(() => dispatch('ready'));
    expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(false);

    act(() => dispatch('cancelled'));
    expect(h.setHoveredBookKey).toHaveBeenLastCalledWith('book-1');
    expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(true);

    act(() => dispatch('finished'));
    expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(false);
  });

  test.each([
    'curl',
    'slide',
  ] as const)('synchronizes toolbar state with a web layered %s lifecycle', (style) => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);
    renderHook(() => useCapturedTurn('book-1', { current: makeView() }));

    const dispatch = (phase: string) =>
      h.renderer.dispatchEvent(
        new CustomEvent('layered-turn-state', {
          detail: { phase, style, forward: true },
        }),
      );

    act(() => {
      dispatch('before-capture');
      dispatch('covered');
    });
    expect(h.controllerHost).toBeNull();
    expect(h.setHoveredBookKey).toHaveBeenLastCalledWith(null);
    expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(true);

    act(() => dispatch('ready'));
    expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(false);

    act(() => dispatch('cancelled'));
    expect(h.setHoveredBookKey).toHaveBeenLastCalledWith('book-1');
    expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(true);

    act(() => dispatch('finished'));
    expect(gridCell.classList.contains('captured-turn-sync-chrome')).toBe(false);
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
