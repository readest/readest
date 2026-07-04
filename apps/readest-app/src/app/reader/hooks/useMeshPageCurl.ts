import { useEffect, useRef } from 'react';
import { FoliateView } from '@/types/view';
import { ViewSettings } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { captureWebviewRegion } from '@/utils/bridge';
import { getViewInsets } from '@/utils/insets';
import { isTauriAppPlatform } from '@/services/environment';
import { MeshCurlTurn } from '../utils/meshCurl';
import { useTouchInterceptor } from './useTouchInterceptor';

// Once the native snapshot fails (older webview, capture bug), stop trying
// for the rest of the session: the CSS arc-fold curl takes over via the
// renderer's `turn-style` attribute.
let meshCaptureBroken = false;

/**
 * Whether the true mesh page curl should drive turns for this view. The
 * mesh needs a native webview snapshot (Tauri only) and only makes sense
 * for animated, paginated, reflowable books — everything else keeps the
 * paginator's own turn styles.
 */
export const isMeshCurlEligible = (viewSettings: ViewSettings, isFixedLayout: boolean) =>
  isTauriAppPlatform() &&
  !meshCaptureBroken &&
  viewSettings.pageTurnStyle === 'curl' &&
  !!viewSettings.animated &&
  !viewSettings.scrolled &&
  !viewSettings.isEink &&
  !isFixedLayout;

/**
 * Single source of truth for the page-turn renderer attributes. When the
 * mesh curl is active the paginator must stay out of the way: no
 * `turn-style` (the app curls the captured page itself) and `no-swipe`
 * (the touch interceptor scrubs the curl instead of the paginator's
 * finger-tracked View Transition).
 */
export const applyPageTurnAttributes = (
  view: FoliateView,
  viewSettings: ViewSettings,
  isFixedLayout: boolean,
) => {
  const mesh = isMeshCurlEligible(viewSettings, isFixedLayout);
  const style = viewSettings.pageTurnStyle;
  if (style && style !== 'push' && !mesh) {
    view.renderer.setAttribute('turn-style', style);
  } else {
    view.renderer.removeAttribute('turn-style');
  }
  if (viewSettings.disableSwipe || mesh) {
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

/**
 * Drives the true mesh page curl (readest#555) on Tauri platforms: wraps
 * the view's `prev`/`next` so programmatic turns (taps, keys, wheel) run
 * the capture→overlay→instant-turn→animate pipeline, and registers a touch
 * interceptor that scrubs the curl from the finger. Falls back to the
 * paginator's CSS curl when the native capture is unavailable.
 */
export const useMeshPageCurl = (bookKey: string, viewRef: React.RefObject<FoliateView | null>) => {
  const { getViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const controllerRef = useRef<MeshCurlTurn | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const view = viewRef.current;

  const isFixedLayout = () => !!getBookData(bookKey)?.isFixedLayout;

  const markCaptureBroken = (error: unknown) => {
    if (meshCaptureBroken) return;
    meshCaptureBroken = true;
    console.warn('Mesh page curl unavailable, falling back to CSS curl:', error);
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
    const controller = new MeshCurlTurn({
      getHostElement: () => document.getElementById(`gridcell-${bookKey}`),
      getContentRect: () => {
        const viewSettings = getViewSettings(bookKey);
        if (!viewSettings) return null;
        const rect = view.getBoundingClientRect();
        const insets = getViewInsets(viewSettings);
        return new DOMRect(
          rect.x + insets.left,
          rect.y + insets.top,
          rect.width - insets.left - insets.right,
          rect.height - insets.top - insets.bottom,
        );
      },
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

    const meshTurn = async (forward: boolean, distance?: number) => {
      const viewSettings = getViewSettings(bookKey);
      const boundary = forward ? view.renderer.atEnd : view.renderer.atStart;
      if (
        distance !== undefined ||
        !viewSettings ||
        !isMeshCurlEligible(viewSettings, isFixedLayout()) ||
        boundary
      ) {
        return forward ? originals.next(distance) : originals.prev(distance);
      }
      try {
        await controller.turn(forward, viewSettings.rtl);
      } catch (error) {
        markCaptureBroken(error);
        return forward ? originals.next() : originals.prev();
      }
    };
    view.prev = (distance?: number) => void meshTurn(false, distance);
    view.next = (distance?: number) => void meshTurn(true, distance);

    return () => {
      view.prev = originals.prev;
      view.next = originals.next;
      controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, bookKey]);

  useTouchInterceptor(
    `mesh-curl-${bookKey}`,
    (bk, detail) => {
      if (bk !== bookKey) return false;
      const currentView = viewRef.current;
      const controller = controllerRef.current;
      if (!currentView || !controller) return false;

      if (detail.phase === 'start') {
        dragRef.current = null;
        return false;
      }

      const viewSettings = getViewSettings(bookKey);
      if (detail.phase === 'move') {
        let state = dragRef.current;
        if (!state) {
          if (
            !viewSettings ||
            viewSettings.disableSwipe ||
            !isMeshCurlEligible(viewSettings, isFixedLayout())
          ) {
            return false;
          }
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
            .beginDrag(forward, viewSettings.rtl)
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
