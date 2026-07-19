import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { FoliateView } from '@/types/view';
import { ViewSettings } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useThemeStore } from '@/store/themeStore';
import { captureWebviewRegion } from '@/utils/bridge';
import { isTauriAppPlatform } from '@/services/environment';
import { detectViewTransitionGroup } from '@/utils/viewTransition';
import { CapturedPageTurn, CapturedTurnStyle } from '../utils/capturedTurn';
import { renderTurnBackdrop } from '../utils/turnBackdrop';
import {
  setLayeredTurnGestureActive,
  TOUCH_SWIPE_THRESHOLD_PX,
  type TouchDetail,
  useTouchInterceptor,
} from './useTouchInterceptor';

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
  progress: number;
  grabY: number;
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
  const { getViewSettings, setHoveredBookKey } = useReaderStore();
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
  const restoreToolbarOnCancelRef = useRef(false);
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
    if (!view) return;

    const waitForPaint = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    const setToolbarVisibilityNow = (visible: boolean) => {
      const gridCell = document.getElementById(`gridcell-${bookKey}`);
      if (!gridCell) return null;

      gridCell.classList.add('captured-turn-sync-chrome');
      flushSync(() => setHoveredBookKey(visible ? bookKey : null));
      return gridCell;
    };
    const syncToolbarVisibility = async (visible: boolean) => {
      // The page snapshot covers this state change. Suppress the normal
      // 300ms toolbar transition, commit the matching live state underneath,
      // and keep the override through one painted frame before removing it.
      const gridCell = setToolbarVisibilityNow(visible);
      if (!gridCell) return;
      try {
        await waitForPaint();
      } finally {
        gridCell.classList.remove('captured-turn-sync-chrome');
      }
    };
    const handleLayeredTurnState = (event: Event) => {
      const detail = (event as CustomEvent<{ phase?: string }>).detail;
      if (detail.phase === 'before-capture') {
        setLayeredTurnGestureActive(bookKey, true);
        restoreToolbarOnCancelRef.current = useReaderStore.getState().hoveredBookKey === bookKey;
      } else if (detail.phase === 'covered') {
        if (restoreToolbarOnCancelRef.current) setToolbarVisibilityNow(false);
      } else if (detail.phase === 'ready') {
        document
          .getElementById(`gridcell-${bookKey}`)
          ?.classList.remove('captured-turn-sync-chrome');
      } else if (detail.phase === 'cancelled') {
        const shouldRestore = restoreToolbarOnCancelRef.current;
        restoreToolbarOnCancelRef.current = false;
        if (shouldRestore) void syncToolbarVisibility(true);
      } else if (detail.phase === 'finished') {
        setLayeredTurnGestureActive(bookKey, false);
        restoreToolbarOnCancelRef.current = false;
        document
          .getElementById(`gridcell-${bookKey}`)
          ?.classList.remove('captured-turn-sync-chrome');
      }
    };
    const cleanupLayeredTurn = () => {
      view.renderer.removeEventListener('layered-turn-state', handleLayeredTurnState);
      setLayeredTurnGestureActive(bookKey, false);
      restoreToolbarOnCancelRef.current = false;
      document.getElementById(`gridcell-${bookKey}`)?.classList.remove('captured-turn-sync-chrome');
    };
    view.renderer.addEventListener('layered-turn-state', handleLayeredTurnState);

    // Browser View Transitions emit the same lifecycle as Tauri layered
    // turns, so toolbar/snapshot synchronization is shared. Only the native
    // platform needs the captured-canvas controller and prev/next wrappers.
    if (!isTauriAppPlatform()) return cleanupLayeredTurn;

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
      onBeforeCapture: () => {
        restoreToolbarOnCancelRef.current = useReaderStore.getState().hoveredBookKey === bookKey;
      },
      capture: captureWebviewRegion,
      getBackdrop: () => {
        const cell = document.getElementById(`gridcell-${bookKey}`);
        const rect = cell?.getBoundingClientRect();
        if (!cell || !rect) return null;
        // The back of the curl shows the theme paper: the background color
        // plus the texture layer painted on the viewer's ::before.
        return renderTurnBackdrop(
          cell.querySelector('.foliate-viewer'),
          useThemeStore.getState().themeCode.bg,
          rect.width,
          rect.height,
        );
      },
      onCovered: async () => {
        // Let the flat canvas reach the compositor before touching the live
        // chrome; otherwise the toolbar can flash out before its captured copy
        // is actually visible on Android/iOS WebViews.
        await waitForPaint();
        if (restoreToolbarOnCancelRef.current) await syncToolbarVisibility(false);
      },
      onCancelled: async () => {
        const shouldRestore = restoreToolbarOnCancelRef.current;
        restoreToolbarOnCancelRef.current = false;
        if (shouldRestore) await syncToolbarVisibility(true);
      },
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
      cleanupLayeredTurn();
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
        // Some webviews can start a replacement touch sequence without
        // delivering the previous touchend. Cancel the old drag before its
        // state is replaced so it cannot remain over, or settle onto, the
        // following page.
        if (dragRef.current) controller.endDrag(false).catch(() => {});
        dragRef.current = null;
        gestureClaimed.current = hasActiveSelection(currentView);
        return false;
      }

      const viewSettings = getViewSettings(bookKey);
      if (detail.phase === 'move') {
        const state = dragRef.current;
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
          if (Math.abs(deltaX) < TOUCH_SWIPE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) {
            return false;
          }
          const forward = viewSettings.rtl ? deltaX > 0 : deltaX < 0;
          if (forward ? currentView.renderer.atEnd : currentView.renderer.atStart) return false;
          const rect = document.getElementById(`gridcell-${bookKey}`)?.getBoundingClientRect();
          const startedState: DragState = {
            forward,
            width: rect?.width || window.innerWidth,
            height: rect?.height || window.innerHeight,
            progress: 0,
            grabY: 0.5,
          };
          updateDragSample(startedState, detail, viewSettings.rtl);
          dragRef.current = startedState;
          const beginning = controller.beginDrag(forward, viewSettings.rtl, style);
          // moveDrag buffers this initial sample even while native capture is
          // pending, then applies it before a queued release can settle.
          controller.moveDrag(startedState.progress, startedState.grabY);
          beginning
            .then((ok) => {
              if (!ok) {
                if (dragRef.current === startedState) dragRef.current = null;
              }
            })
            .catch((error) => {
              if (dragRef.current === startedState) dragRef.current = null;
              markCaptureBroken(error);
            });
          return true;
        }
        updateDragSample(state, detail, viewSettings?.rtl ?? false);
        controller.moveDrag(state.progress, state.grabY);
        return true;
      }

      // phase === 'end' | 'cancel'
      const state = dragRef.current;
      if (!state) return false;
      dragRef.current = null;
      updateDragSample(state, detail, viewSettings?.rtl ?? false);
      // Store the release position before endDrag joins the controller's
      // serialized queue. This ordering also covers touchcancel.
      controller.moveDrag(state.progress, state.grabY);
      if (detail.phase === 'cancel') {
        controller.endDrag(false).catch(() => {});
        return true;
      }
      const signed = dragDistance(state, detail.deltaX, viewSettings?.rtl ?? false);
      const velocity = signed / (detail.deltaT || 1);
      // Same carousel rule as the paginator: a flick along the turn commits
      // regardless of distance; otherwise commit past halfway.
      const commit = velocity > 0.3 ? true : state.progress > 0.5;
      // CapturedPageTurn serializes endDrag behind an in-flight beginDrag, so
      // queue release immediately. This also keeps a following gesture behind
      // the complete begin/end pair instead of letting it supersede the turn.
      controller.endDrag(commit).catch(() => {});
      return true;
    },
    // Above the fixed-layout swipe-flip (0), below the reading ruler (10).
    5,
  );
};

const dragProgress = (state: DragState, deltaX: number, rtl: boolean) => {
  const signed = dragDistance(state, deltaX, rtl);
  // Preserve the full displacement from touchstart: recognition catches the
  // animation up to the gesture, and later progress remains based on the same
  // cumulative travel.
  return Math.max(0, Math.min(1, signed / state.width));
};

const dragDistance = (state: DragState, deltaX: number, rtl: boolean) => {
  const along = rtl ? -deltaX : deltaX;
  return state.forward ? -along : along;
};

const updateDragSample = (state: DragState, detail: TouchDetail, rtl: boolean) => {
  state.progress = dragProgress(state, detail.deltaX, rtl);
  // The fold tilts as the finger strays vertically, curling corners like a
  // real page pinch.
  state.grabY = Math.max(0.05, Math.min(0.95, 0.5 + detail.deltaY / state.height));
};
