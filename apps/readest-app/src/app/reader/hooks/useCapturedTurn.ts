import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { FoliateView } from '@/types/view';
import { ViewSettings } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useThemeStore } from '@/store/themeStore';
import { captureWebviewRegion } from '@/utils/bridge';
import { getInitializedAppService, isTauriAppPlatform } from '@/services/environment';
import { detectViewTransitionGroup } from '@/utils/viewTransition';
import { TURN_GESTURE_LEFT_INSET_ATTRIBUTE } from '../utils/brightnessGesture';
import { isLayeredTurnTouchActive, setLayeredTurnTouchClaimed } from '../utils/iframeEventHandlers';
import { CapturedPageTurn, CapturedTurnStyle } from '../utils/capturedTurn';
import { renderTurnBackdrop } from '../utils/turnBackdrop';
import {
  createTurnGestureIntent as createArenaIntent,
  NATIVE_CAPTURED_TURN_ATTRIBUTE,
  NATIVE_PROGRAMMATIC_TURN_ATTRIBUTE,
  shouldClaimTurnGesture as shouldClaimArenaGesture,
  TURN_EDGE_ZONE_RATIO,
  type TurnGestureIntent,
} from '../utils/turnGestureArena';
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
 * flat snapshot cannot mesh-bend). Mobile Tauri also keeps slide on this path
 * so a decoded snapshot can be prepared while the page is idle; desktop and
 * web builds retain the browser View Transition implementation when it is
 * available.
 */
export const getCapturedTurnStyle = (
  viewSettings: ViewSettings,
  isFixedLayout: boolean,
  prepareNativeSlide = getInitializedAppService()?.isMobileApp === true,
): CapturedTurnStyle | null => {
  if (!isTauriAppPlatform() || captureBroken) return null;
  if (!viewSettings.animated || viewSettings.scrolled || viewSettings.isEink || isFixedLayout) {
    return null;
  }
  if (viewSettings.pageTurnStyle === 'curl') return 'curl';
  if (
    viewSettings.pageTurnStyle === 'slide' &&
    (prepareNativeSlide || !detectViewTransitionGroup())
  ) {
    return 'slide';
  }
  return null;
};

/**
 * Single source of truth for the page-turn renderer attributes. When a
 * captured turn is active the paginator must stay out of the way: no
 * `turn-style` (the app animates the captured page itself) and `no-swipe`
 * (the touch interceptor scrubs the turn instead of the paginator's
 * finger-tracked View Transition). Outside the captured mobile path, layered
 * `turn-style` values are withheld from engines without full View Transitions
 * support — iOS 18 WebKit crashes on them — leaving those on push.
 */
export const applyPageTurnAttributes = (
  view: FoliateView,
  viewSettings: ViewSettings,
  isFixedLayout: boolean,
  prepareNativeSlide = getInitializedAppService()?.isMobileApp === true,
) => {
  const captured = getCapturedTurnStyle(viewSettings, isFixedLayout, prepareNativeSlide);
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
  if (captured && !viewSettings.disableSwipe) {
    view.renderer.setAttribute(NATIVE_CAPTURED_TURN_ATTRIBUTE, captured);
  } else {
    view.renderer.removeAttribute(NATIVE_CAPTURED_TURN_ATTRIBUTE);
  }
};

interface DragState {
  style: CapturedTurnStyle;
  forward: boolean;
  width: number;
  height: number;
  /** Finger distance already consumed when a Slide gesture was claimed. */
  visualOriginDistance: number;
  progress: number;
  grabY: number;
  releaseSamples: { distance: number; time: number }[];
  lastMovementTime: number;
}

const RELEASE_VELOCITY_WINDOW_MS = 90;
const RELEASE_PAUSE_THRESHOLD_MS = 80;
const SLIDE_RELEASE_PROJECTION_MS = 240;
const PREPARED_CAPTURE_DELAY_MS = 160;
const PREPARED_CAPTURE_CHROME_DELAY_MS = 360;

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
  const gestureIntentRef = useRef<TurnGestureIntent | null>(null);
  const programmaticTurnsInFlightRef = useRef(new Set<symbol>());
  const schedulePreparedCaptureRef = useRef<(() => void) | null>(null);
  const cancelPreparedCaptureScheduleRef = useRef<(() => void) | null>(null);
  // Whether the current touch gesture is claimed by another interaction and
  // must never morph into a page turn, even after the claim is released:
  // - it began with an active selection (a handle drag stays a selection
  //   gesture even if app code deselects mid-drag — the instant quick action
  //   dismisses on selectionchange and iOS re-confirms right after);
  // - it was ever blocked by the instant-highlight scroll lock (the unlock
  //   at release runs before the gesture's queued trailing touchmoves are
  //   delivered, and their full-stroke deltas would read as a swipe);
  // - a layered turn already recognized it (including at a book boundary),
  //   or a programmatic turn took ownership while the finger was still down.
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
        // Keep per-touch ownership latched until iframe touchend/cancel clears
        // it. A synchronous View Transition failure can finish while the
        // finger is still down; clearing here would let its release become a
        // synthesized toolbar click.
        restoreToolbarOnCancelRef.current = false;
        document
          .getElementById(`gridcell-${bookKey}`)
          ?.classList.remove('captured-turn-sync-chrome');
      }
    };
    const handleLayeredTurnGestureClaimed = () => {
      setLayeredTurnTouchClaimed(bookKey, true);
    };
    const cleanupLayeredTurn = () => {
      view.renderer.removeEventListener('layered-turn-state', handleLayeredTurnState);
      view.renderer.removeEventListener(
        'layered-turn-gesture-claimed',
        handleLayeredTurnGestureClaimed,
      );
      setLayeredTurnGestureActive(bookKey, false);
      setLayeredTurnTouchClaimed(bookKey, false);
      restoreToolbarOnCancelRef.current = false;
      document.getElementById(`gridcell-${bookKey}`)?.classList.remove('captured-turn-sync-chrome');
    };
    view.renderer.addEventListener('layered-turn-state', handleLayeredTurnState);
    view.renderer.addEventListener('layered-turn-gesture-claimed', handleLayeredTurnGestureClaimed);

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

    let prepareTimer: ReturnType<typeof setTimeout> | null = null;
    let prepareRaf = 0;
    let preparePaintRaf = 0;
    let prepareNotBefore = 0;
    let cleanedUp = false;
    const cancelPreparedCaptureSchedule = () => {
      if (prepareTimer !== null) clearTimeout(prepareTimer);
      if (prepareRaf) cancelAnimationFrame(prepareRaf);
      if (preparePaintRaf) cancelAnimationFrame(preparePaintRaf);
      prepareTimer = null;
      prepareRaf = 0;
      preparePaintRaf = 0;
    };
    function runPreparedCapture() {
      if (cleanedUp) return;
      const remaining = prepareNotBefore - performance.now();
      if (remaining > 0) {
        prepareTimer = setTimeout(runPreparedCapture, remaining);
        return;
      }
      prepareTimer = null;
      prepareNotBefore = 0;
      prepareRaf = requestAnimationFrame(() => {
        prepareRaf = 0;
        preparePaintRaf = requestAnimationFrame(() => {
          preparePaintRaf = 0;
          if (cleanedUp || document.hidden) return;
          const currentViewState = useReaderStore.getState().viewStates[bookKey];
          if (!currentViewState?.inited || currentViewState.ttsEnabled) return;
          if (hasActiveSelection(view!)) {
            schedulePreparedCapture(PREPARED_CAPTURE_CHROME_DELAY_MS);
            return;
          }
          // Do not ask the native webview to capture while a tap, selection,
          // brightness drag, or still-unclaimed turn gesture is in flight.
          if (isLayeredTurnTouchActive(bookKey)) {
            schedulePreparedCapture();
            return;
          }
          const appService = getInitializedAppService();
          if (!appService?.isMobileApp && !appService?.isMacOSApp) return;
          const currentSettings = getViewSettings(bookKey);
          const style = currentSettings
            ? getCapturedTurnStyle(currentSettings, isFixedLayout())
            : null;
          if (style) void controller.prepareCapture(style);
        });
      });
    }
    function schedulePreparedCapture(delay = PREPARED_CAPTURE_DELAY_MS) {
      if (cleanedUp) return;
      prepareNotBefore = Math.max(prepareNotBefore, performance.now() + delay);
      cancelPreparedCaptureSchedule();
      prepareTimer = setTimeout(
        runPreparedCapture,
        Math.max(0, prepareNotBefore - performance.now()),
      );
    }
    const invalidateAndSchedulePreparedCapture = (delay = PREPARED_CAPTURE_DELAY_MS) => {
      controller.invalidatePreparedCapture();
      schedulePreparedCapture(delay);
    };
    schedulePreparedCaptureRef.current = schedulePreparedCapture;
    cancelPreparedCaptureScheduleRef.current = cancelPreparedCaptureSchedule;

    // A warm bitmap represents the pixels of one settled reader-cell state.
    // Coalesce the renderer's noisy lifecycle into one post-paint capture and
    // discard any result whose generation changed while native work ran.
    const handleCapturedSurfaceChange = () => invalidateAndSchedulePreparedCapture();
    view.addEventListener('relocate', handleCapturedSurfaceChange);
    view.addEventListener('draw-annotation', handleCapturedSurfaceChange);
    view.addEventListener('show-annotation', handleCapturedSurfaceChange);
    view.renderer.addEventListener('stabilized', handleCapturedSurfaceChange);

    const gridCell = document.getElementById(`gridcell-${bookKey}`);
    const resizeObserver =
      gridCell && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => invalidateAndSchedulePreparedCapture())
        : null;
    if (gridCell) resizeObserver?.observe(gridCell);

    const unsubscribeReader = useReaderStore.subscribe((state, previous) => {
      const currentViewState = state.viewStates[bookKey];
      const previousViewState = previous.viewStates[bookKey];
      const toolbarChanged =
        (state.hoveredBookKey === bookKey) !== (previous.hoveredBookKey === bookKey);
      const toolbarContentChanged =
        state.bottomBarTab !== previous.bottomBarTab &&
        (state.hoveredBookKey === bookKey || previous.hoveredBookKey === bookKey);
      const readerPixelsChanged =
        toolbarChanged || toolbarContentChanged || currentViewState !== previousViewState;
      if (readerPixelsChanged) {
        invalidateAndSchedulePreparedCapture(
          toolbarChanged || toolbarContentChanged
            ? PREPARED_CAPTURE_CHROME_DELAY_MS
            : PREPARED_CAPTURE_DELAY_MS,
        );
      }
    });
    const unsubscribeTheme = useThemeStore.subscribe((state, previous) => {
      const systemChromeChanged = state.systemUIVisible !== previous.systemUIVisible;
      const themePixelsChanged =
        state.themeCode !== previous.themeCode ||
        state.isDarkMode !== previous.isDarkMode ||
        systemChromeChanged ||
        state.statusBarHeight !== previous.statusBarHeight ||
        state.safeAreaInsets !== previous.safeAreaInsets ||
        state.isRoundedWindow !== previous.isRoundedWindow;
      if (themePixelsChanged) {
        invalidateAndSchedulePreparedCapture(
          systemChromeChanged ? PREPARED_CAPTURE_CHROME_DELAY_MS : PREPARED_CAPTURE_DELAY_MS,
        );
      }
    });
    const handleVisibilityChange = () => {
      if (document.hidden) {
        cancelPreparedCaptureSchedule();
        prepareNotBefore = 0;
        controller.invalidatePreparedCapture();
      } else {
        schedulePreparedCapture();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    schedulePreparedCapture();

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
      const programmaticTurn = Symbol('captured-turn');
      programmaticTurnsInFlightRef.current.add(programmaticTurn);
      view.renderer.setAttribute(NATIVE_PROGRAMMATIC_TURN_ATTRIBUTE, '');
      // If another input starts a programmatic turn while a finger is still
      // pending, that navigation owns the rest of the touch sequence. Do not
      // let later samples reuse the old origin and launch a second turn after
      // the programmatic animation; the controller cancels any open drag.
      const rawTouchActive = isLayeredTurnTouchActive(bookKey);
      if (rawTouchActive || gestureIntentRef.current || dragRef.current) {
        dragRef.current = null;
        gestureIntentRef.current = null;
        gestureClaimed.current = true;
        if (rawTouchActive) setLayeredTurnTouchClaimed(bookKey, true);
      }
      try {
        await controller.turn(forward, viewSettings.rtl, style);
      } catch (error) {
        markCaptureBroken(error);
        return forward ? originals.next() : originals.prev();
      } finally {
        programmaticTurnsInFlightRef.current.delete(programmaticTurn);
        if (programmaticTurnsInFlightRef.current.size === 0) {
          view.renderer.removeAttribute(NATIVE_PROGRAMMATIC_TURN_ATTRIBUTE);
        }
        schedulePreparedCapture();
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
      cleanedUp = true;
      cancelPreparedCaptureSchedule();
      prepareNotBefore = 0;
      if (schedulePreparedCaptureRef.current === schedulePreparedCapture) {
        schedulePreparedCaptureRef.current = null;
      }
      if (cancelPreparedCaptureScheduleRef.current === cancelPreparedCaptureSchedule) {
        cancelPreparedCaptureScheduleRef.current = null;
      }
      unsubscribeReader();
      unsubscribeTheme();
      resizeObserver?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      view.removeEventListener('relocate', handleCapturedSurfaceChange);
      view.removeEventListener('draw-annotation', handleCapturedSurfaceChange);
      view.removeEventListener('show-annotation', handleCapturedSurfaceChange);
      view.renderer.removeEventListener('stabilized', handleCapturedSurfaceChange);
      view.prev = originals.prev;
      view.next = originals.next;
      controller.dispose();
      cleanupLayeredTurn();
      programmaticTurnsInFlightRef.current.clear();
      view.renderer.removeAttribute(NATIVE_PROGRAMMATIC_TURN_ATTRIBUTE);
      dragRef.current = null;
      gestureIntentRef.current = null;
      gestureClaimed.current = false;
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
        cancelPreparedCaptureScheduleRef.current?.();
        // Some webviews can start a replacement touch sequence without
        // delivering the previous touchend. Cancel the old drag before its
        // state is replaced so it cannot remain over, or settle onto, the
        // following page.
        if (dragRef.current) {
          controller
            .endDrag(false)
            .finally(() => schedulePreparedCaptureRef.current?.())
            .catch(() => {});
        }
        dragRef.current = null;
        gestureIntentRef.current = createTurnGestureIntent(bookKey, currentView, detail);
        gestureClaimed.current =
          programmaticTurnsInFlightRef.current.size > 0 || hasActiveSelection(currentView);
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
            gestureIntentRef.current = null;
            gestureClaimed.current = true;
            return false;
          }
          // A non-collapsed selection means the finger is creating or
          // adjusting a text selection (long-press select, handle drags);
          // the paginator's native swipe bows out then too (#onTouchMove
          // selection gate), so the captured turn must as well. The claim
          // latch keeps a handle drag from morphing into a turn during a
          // transient mid-drag deselect.
          if (gestureClaimed.current || hasActiveSelection(currentView)) {
            gestureIntentRef.current = null;
            return false;
          }
          if (!viewSettings || viewSettings.disableSwipe) {
            gestureIntentRef.current = null;
            return false;
          }
          const style = getCapturedTurnStyle(viewSettings, isFixedLayout());
          if (!style) {
            gestureIntentRef.current = null;
            return false;
          }
          const intent =
            gestureIntentRef.current ?? createTurnGestureIntent(bookKey, currentView, detail);
          gestureIntentRef.current = intent;
          // Edge drags can engage on their first clear inward sample. Central
          // drags use two timely, coherent samples for a 6px fast path, while
          // ambiguous trajectories retain the established 15px fallback.
          // The brightness strip keeps the paginator-compatible 24px fallback
          // so it can reach its own 18px activation point first.
          if (!shouldClaimTurnGesture(intent, detail)) {
            return false;
          }
          gestureIntentRef.current = null;
          const { deltaX } = detail;
          const forward = viewSettings.rtl ? deltaX > 0 : deltaX < 0;
          // Recognition owns the touch even at a book boundary, where no
          // captured animation can start. Otherwise a 1–6px early claim can
          // be replayed as a synthesized toolbar click on release.
          setLayeredTurnTouchClaimed(bookKey, true);
          gestureClaimed.current = true;
          if (forward ? currentView.renderer.atEnd : currentView.renderer.atStart) return true;
          const rect = document.getElementById(`gridcell-${bookKey}`)?.getBoundingClientRect();
          const startedState: DragState = {
            style,
            forward,
            width: rect?.width || window.innerWidth,
            height: rect?.height || window.innerHeight,
            visualOriginDistance: 0,
            progress: 0,
            grabY: 0.5,
            releaseSamples: [{ distance: 0, time: 0 }],
            lastMovementTime: 0,
          };
          if (style === 'slide') {
            startedState.visualOriginDistance = Math.max(
              0,
              dragDistance(startedState, detail.deltaX, viewSettings.rtl),
            );
          }
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
      gestureIntentRef.current = null;
      if (!state) {
        schedulePreparedCaptureRef.current?.();
        return false;
      }
      dragRef.current = null;
      updateDragSample(state, detail, viewSettings?.rtl ?? false);
      // Store the release position before endDrag joins the controller's
      // serialized queue. This ordering also covers touchcancel.
      controller.moveDrag(state.progress, state.grabY);
      if (detail.phase === 'cancel') {
        controller
          .endDrag(false)
          .finally(() => schedulePreparedCaptureRef.current?.())
          .catch(() => {});
        return true;
      }
      const signed = dragDistance(state, detail.deltaX, viewSettings?.rtl ?? false);
      const fullGestureVelocity = signed / (detail.deltaT || 1);
      const releaseVelocity = getReleaseVelocity(state);
      // Slide projects the release velocity forward over a short horizon:
      // distance and speed contribute continuously instead of crossing two
      // independent hard thresholds. Curl preserves the existing whole-
      // gesture 0.3px/ms-or-halfway rule.
      const releaseProgress = Math.max(0, Math.min(1, signed / state.width));
      const projectedProgress =
        releaseProgress + (releaseVelocity * SLIDE_RELEASE_PROJECTION_MS) / state.width;
      const commit =
        state.style === 'slide'
          ? projectedProgress > 0.5
          : fullGestureVelocity > 0.3
            ? true
            : state.progress > 0.5;
      // CapturedPageTurn serializes endDrag behind an in-flight beginDrag, so
      // queue release immediately. This also keeps a following gesture behind
      // the complete begin/end pair instead of letting it supersede the turn.
      controller
        .endDrag(commit, releaseVelocity)
        .finally(() => schedulePreparedCaptureRef.current?.())
        .catch(() => {});
      return true;
    },
    // Above the fixed-layout swipe-flip (0), below the reading ruler (10).
    5,
  );
};

const dragProgress = (state: DragState, deltaX: number, rtl: boolean) => {
  const signed = dragDistance(state, deltaX, rtl);
  // Slide starts visually flat at the claim point, avoiding a first-frame
  // jump by the distance consumed during gesture recognition. Curl keeps its
  // established touchstart-relative fold. Release decisions still use the
  // full signed distance above, so this changes presentation only.
  const visualDistance = state.style === 'slide' ? signed - state.visualOriginDistance : signed;
  return Math.max(0, Math.min(1, visualDistance / state.width));
};

const createTurnGestureIntent = (
  bookKey: string,
  view: FoliateView,
  detail: TouchDetail,
): TurnGestureIntent => {
  const rect = document.getElementById(`gridcell-${bookKey}`)?.getBoundingClientRect();
  let edgeDirection: TurnGestureIntent['edgeDirection'] = 0;
  const inset = Number(view.renderer.getAttribute?.(TURN_GESTURE_LEFT_INSET_ATTRIBUTE));
  const reservedLeftRatio = Number.isFinite(inset) ? Math.max(0, Math.min(0.5, inset)) : 0;
  let earlyClaimBlocked = detail.touchStart.screenX <= window.innerWidth * reservedLeftRatio;
  if (rect && rect.width > 0) {
    const windowScreenX = Number.isFinite(window.screenX) ? window.screenX : 0;
    const localStartX = detail.touchStart.screenX - windowScreenX - rect.left;
    earlyClaimBlocked = localStartX <= rect.width * reservedLeftRatio;
    if (
      !earlyClaimBlocked &&
      localStartX >= 0 &&
      localStartX <= rect.width * TURN_EDGE_ZONE_RATIO
    ) {
      edgeDirection = 1;
    } else if (
      localStartX <= rect.width &&
      localStartX >= rect.width * (1 - TURN_EDGE_ZONE_RATIO)
    ) {
      edgeDirection = -1;
    }
  }
  return createArenaIntent(edgeDirection, earlyClaimBlocked, detail.deltaT);
};

const shouldClaimTurnGesture = (intent: TurnGestureIntent, detail: TouchDetail) =>
  shouldClaimArenaGesture(intent, detail, TOUCH_SWIPE_THRESHOLD_PX);

const dragDistance = (state: DragState, deltaX: number, rtl: boolean) => {
  const along = rtl ? -deltaX : deltaX;
  return state.forward ? -along : along;
};

const updateDragSample = (state: DragState, detail: TouchDetail, rtl: boolean) => {
  const distance = dragDistance(state, detail.deltaX, rtl);
  state.progress = dragProgress(state, detail.deltaX, rtl);
  // The fold tilts as the finger strays vertically, curling corners like a
  // real page pinch.
  state.grabY = Math.max(0.05, Math.min(0.95, 0.5 + detail.deltaY / state.height));

  const time = Math.max(0, detail.deltaT);
  const previous = state.releaseSamples.at(-1);
  if (!previous || distance !== previous.distance) state.lastMovementTime = time;
  if (previous?.time === time) {
    previous.distance = distance;
  } else {
    state.releaseSamples.push({ distance, time });
  }

  const cutoff = time - RELEASE_VELOCITY_WINDOW_MS;
  while (state.releaseSamples.length > 2 && state.releaseSamples[1]!.time < cutoff) {
    state.releaseSamples.shift();
  }
};

const getReleaseVelocity = (state: DragState) => {
  const latest = state.releaseSamples.at(-1);
  if (!latest || latest.time - state.lastMovementTime > RELEASE_PAUSE_THRESHOLD_MS) return 0;

  const cutoff = latest.time - RELEASE_VELOCITY_WINDOW_MS;
  const before = state.releaseSamples[0];
  const after = state.releaseSamples.find((sample) => sample.time >= cutoff);
  if (!before || !after) return 0;

  const startTime = Math.max(cutoff, before.time);
  if (latest.time <= startTime) return 0;
  const interval = after.time - before.time;
  const startDistance =
    interval > 0 && startTime > before.time
      ? before.distance +
        ((after.distance - before.distance) * (startTime - before.time)) / interval
      : after.distance;
  return (latest.distance - startDistance) / (latest.time - startTime);
};
