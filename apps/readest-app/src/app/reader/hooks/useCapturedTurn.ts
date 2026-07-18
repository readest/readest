import { useEffect, useRef } from 'react';
import { FoliateView } from '@/types/view';
import { ViewSettings } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { captureWebviewRegion } from '@/utils/bridge';
import { isTauriAppPlatform } from '@/services/environment';
import { detectViewTransitionGroup } from '@/utils/viewTransition';
import { CapturedPageTurn, CapturedTurnStyle } from '../utils/capturedTurn';
import { useTouchInterceptor } from './useTouchInterceptor';

// Once the native snapshot fails (older webview, capture bug), stop trying
// for the rest of the session: the renderer's own `turn-style` animations
// take over where the engine supports them, push everywhere else.
let captureBroken = false;

/**
 * The turn style the captured-page pipeline should drive for this view, or
 * null when the paginator's own turns apply. The pipeline needs a native
 * webview snapshot (Tauri only) and only makes sense for animated,
 * paginated, reflowable books. The curl always turns from a capture (a
 * flat snapshot cannot mesh-bend); the slide prefers the View Transitions
 * version and falls back to the captured slide on engines without full
 * support.
 */
export const getCapturedTurnStyle = (
  viewSettings: ViewSettings,
  isFixedLayout: boolean,
): CapturedTurnStyle | null => {
  if (!isTauriAppPlatform() || captureBroken) return null;
  if (!viewSettings.animated || viewSettings.scrolled || viewSettings.isEink || isFixedLayout) {
    return null;
  }
  if (viewSettings.pageTurnStyle === 'curl') return 'curl';
  if (viewSettings.pageTurnStyle === 'slide' && !detectViewTransitionGroup()) return 'slide';
  return null;
};

/**
 * Single source of truth for the page-turn renderer attributes. When a
 * captured turn is active the paginator must stay out of the way: no
 * `turn-style` (the app animates the captured page itself) and `no-swipe`
 * (the touch interceptor scrubs the turn instead of the paginator's
 * finger-tracked View Transition). The layered `turn-style` values are
 * withheld from engines without full View Transitions support — iOS 18
 * WebKit crashes on them — leaving those on push.
 */
export const applyPageTurnAttributes = (
  view: FoliateView,
  viewSettings: ViewSettings,
  isFixedLayout: boolean,
) => {
  const captured = getCapturedTurnStyle(viewSettings, isFixedLayout);
  const style = viewSettings.pageTurnStyle;
  if (style && style !== 'push' && !captured && detectViewTransitionGroup()) {
    view.renderer.setAttribute('turn-style', style);
  } else {
    view.renderer.removeAttribute('turn-style');
  }
  if (viewSettings.disableSwipe || captured) {
    view.renderer.setAttribute('no-swipe', '');
  } else {
    view.renderer.removeAttribute('no-swipe');
  }
};

interface DragState {
  forward: boolean;
  width: number;
  height: number;
}

// Whether the visible section's document holds a non-collapsed selection —
// the same condition the paginator's native swipe bows out on (#onTouchMove
// selection gate), mirrored for the captured-turn interceptor.
const hasActiveSelection = (view: FoliateView) => {
  const { renderer } = view;
  const doc = renderer.getContents().find((c) => c.index === renderer.primaryIndex)?.doc;
  const selection = doc?.getSelection();
  return !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
};

/**
 * Drives the captured page turns (readest#555) on Tauri platforms: wraps
 * the view's `prev`/`next` so programmatic turns (taps, keys, wheel) run
 * the capture→overlay→instant-turn→animate pipeline, and registers a touch
 * interceptor that scrubs the turn from the finger. Falls back to the
 * paginator's own animations when the native capture is unavailable.
 */
export const useCapturedTurn = (bookKey: string, viewRef: React.RefObject<FoliateView | null>) => {
  const { getViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const controllerRef = useRef<CapturedPageTurn | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // Whether the current touch gesture is claimed by another interaction and
  // must never morph into a page turn, even after the claim is released:
  // - it began with an active selection (a handle drag stays a selection
  //   gesture even if app code deselects mid-drag — the instant quick action
  //   dismisses on selectionchange and iOS re-confirms right after);
  // - it was ever blocked by the instant-highlight scroll lock (the unlock
  //   at release runs before the gesture's queued trailing touchmoves are
  //   delivered, and their full-stroke deltas would read as a swipe).
  const gestureClaimed = useRef(false);
  const view = viewRef.current;

  const isFixedLayout = () => !!getBookData(bookKey)?.isFixedLayout;

  const markCaptureBroken = (error: unknown) => {
    if (captureBroken) return;
    captureBroken = true;
    console.warn('Captured page turn unavailable, falling back:', error);
    const currentView = viewRef.current;
    const viewSettings = getViewSettings(bookKey);
    if (currentView && viewSettings) {
      applyPageTurnAttributes(currentView, viewSettings, isFixedLayout());
    }
  };

  useEffect(() => {
    if (!view || !isTauriAppPlatform()) return;

    // The foliate implementation returns the turn's promise even though the
    // published type is void; navigate() awaits it so the overlay only starts
    // animating once the instant jump underneath has landed.
    type TurnFn = (distance?: number) => void | Promise<void>;
    const originals: { prev: TurnFn; next: TurnFn } = {
      prev: view.prev.bind(view),
      next: view.next.bind(view),
    };
    const controller = new CapturedPageTurn({
      getHostElement: () => document.getElementById(`gridcell-${bookKey}`),
      // The whole reader cell turns — running header, footer, and page
      // margins ride the turning page like a physical sheet (and like
      // Apple Books), so the capture spans the full cell, not just the
      // text content box.
      getContentRect: () =>
        document.getElementById(`gridcell-${bookKey}`)?.getBoundingClientRect() ?? null,
      capture: captureWebviewRegion,
      navigate: async (forward: boolean) => {
        // The paginator's animated paths (push slide and the layered VT
        // turns) all gate on the `animated` attribute; dropping it makes
        // the underlying turn an instant jump hidden by the overlay.
        const renderer = view.renderer;
        const hadAnimated = renderer.hasAttribute('animated');
        renderer.removeAttribute('animated');
        try {
          await (forward ? originals.next() : originals.prev());
        } finally {
          if (hadAnimated) renderer.setAttribute('animated', '');
        }
      },
    });
    controllerRef.current = controller;

    const capturedTurn = async (forward: boolean, distance?: number) => {
      const viewSettings = getViewSettings(bookKey);
      const boundary = forward ? view.renderer.atEnd : view.renderer.atStart;
      const style =
        viewSettings && distance === undefined && !boundary
          ? getCapturedTurnStyle(viewSettings, isFixedLayout())
          : null;
      if (!viewSettings || !style) {
        return forward ? originals.next(distance) : originals.prev(distance);
      }
      try {
        await controller.turn(forward, viewSettings.rtl, style);
      } catch (error) {
        markCaptureBroken(error);
        return forward ? originals.next() : originals.prev();
      }
    };
    // Return the turn's promise (the foliate originals do too, despite the
    // published void type): the corner auto-turn awaits it to hold its
    // isAutoTurning guard up until the turn settles — discarding it resolves
    // awaiters ~300ms early, and the #873 selection scroll-pin then snaps the
    // still-animating page straight back (nightly Android e2e regression).
    view.prev = (distance?: number) => capturedTurn(false, distance);
    view.next = (distance?: number) => capturedTurn(true, distance);

    return () => {
      view.prev = originals.prev;
      view.next = originals.next;
      controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, bookKey]);

  useTouchInterceptor(
    `captured-turn-${bookKey}`,
    (bk, detail) => {
      if (bk !== bookKey) return false;
      const currentView = viewRef.current;
      const controller = controllerRef.current;
      if (!currentView || !controller) return false;

      if (detail.phase === 'start') {
        dragRef.current = null;
        gestureClaimed.current = hasActiveSelection(currentView);
        return false;
      }

      const viewSettings = getViewSettings(bookKey);
      if (detail.phase === 'move') {
        let state = dragRef.current;
        if (!state) {
          // Instant highlight engaged (still-hold on text) locks scrolling so
          // the finger extends the highlight, not turns the page. The push
          // paginator honors the same lock in its native swipe (paginator's
          // #scrollLocked); mirror it here so slide/curl behaves identically —
          // and claim the whole gesture, so the trailing moves delivered
          // after the release's unlock cannot start a stray drag.
          if (currentView.renderer.scrollLocked) {
            gestureClaimed.current = true;
            return false;
          }
          // A non-collapsed selection means the finger is creating or
          // adjusting a text selection (long-press select, handle drags);
          // the paginator's native swipe bows out then too (#onTouchMove
          // selection gate), so the captured turn must as well. The claim
          // latch keeps a handle drag from morphing into a turn during a
          // transient mid-drag deselect.
          if (gestureClaimed.current || hasActiveSelection(currentView)) return false;
          if (!viewSettings || viewSettings.disableSwipe) return false;
          const style = getCapturedTurnStyle(viewSettings, isFixedLayout());
          if (!style) return false;
          // Horizontal intent only; leave vertical swipes and taps alone.
          const { deltaX, deltaY } = detail;
          if (Math.abs(deltaX) < 15 || Math.abs(deltaX) <= Math.abs(deltaY)) return false;
          const forward = viewSettings.rtl ? deltaX > 0 : deltaX < 0;
          if (forward ? currentView.renderer.atEnd : currentView.renderer.atStart) return false;
          const rect = document.getElementById(`gridcell-${bookKey}`)?.getBoundingClientRect();
          state = {
            forward,
            width: rect?.width || window.innerWidth,
            height: rect?.height || window.innerHeight,
          };
          dragRef.current = state;
          controller
            .beginDrag(forward, viewSettings.rtl, style)
            .then((ok) => {
              if (!ok) dragRef.current = null;
            })
            .catch((error) => {
              dragRef.current = null;
              markCaptureBroken(error);
            });
          return true;
        }
        controller.moveDrag(
          dragProgress(state, detail.deltaX, viewSettings?.rtl ?? false),
          // The fold tilts as the finger strays vertically, curling corners
          // like a real page pinch.
          Math.max(0.05, Math.min(0.95, 0.5 + detail.deltaY / state.height)),
        );
        return true;
      }

      // phase === 'end'
      const state = dragRef.current;
      if (!state) return false;
      dragRef.current = null;
      const progress = dragProgress(state, detail.deltaX, viewSettings?.rtl ?? false);
      const signed = progress * state.width;
      const velocity = signed / (detail.deltaT || 1);
      // Same carousel rule as the paginator: a flick along the turn commits
      // regardless of distance; otherwise commit past halfway.
      const commit = velocity > 0.3 ? true : progress > 0.5;
      controller.endDrag(commit).catch(() => {});
      return true;
    },
    // Above the fixed-layout swipe-flip (0), below the reading ruler (10).
    5,
  );
};

const dragProgress = (state: DragState, deltaX: number, rtl: boolean) => {
  const along = rtl ? -deltaX : deltaX;
  const signed = state.forward ? -along : along;
  return Math.max(0, Math.min(1, signed / state.width));
};
