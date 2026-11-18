import { useCallback, useEffect, useRef, useState } from 'react';
import { useThemeStore } from '@/store/themeStore';
import {
  AUTO_SCROLL_GESTURE_EDGE_RATIO,
  computeSpeed,
  isInRightEdge,
  shouldActivate,
} from '@/app/reader/utils/autoScrollSpeedGesture';
import { AutoScrollState } from './useAutoScroll';

const OVERLAY_HIDE_DELAY_MS = 600;

/**
 * Right-edge swipe-to-adjust-auto-scroll-speed gesture (touch).
 *
 * Mirrors `useBrightnessGesture` on the opposite edge, but is armed only while
 * an Auto Scroll session is active. Attaches capture-phase, non-passive touch
 * listeners to the foliate iframe document once; capture phase is required so
 * an active gesture's `stopImmediatePropagation` can suppress foliate-js's own
 * bubble-phase paginator listeners. Everything runtime-variable is read through
 * `latestRef` (updated each render).
 *
 * The transient capsule shows the live speed (`autoScroll.speed`); this hook
 * only owns its visibility.
 */
export const useAutoScrollSpeedGesture = (autoScroll: AutoScrollState) => {
  const [overlayVisible, setOverlayVisible] = useState(false);
  const { safeAreaInsets, isIPhoneDuo } = useThemeStore();

  // The once-attached listener reads the latest session state and setter here.
  const latestRef = useRef(autoScroll);
  latestRef.current = autoScroll;

  // Right safe-area inset (px), iPhone Duo only: its status-bar strip is a
  // large left/right inset (#6307), so the gesture zone must end before it.
  const edgeInsetRef = useRef(0);
  edgeInsetRef.current = isIPhoneDuo ? safeAreaInsets?.right || 0 : 0;

  // Per-gesture state.
  const armedRef = useRef(false);
  const activeRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const viewHeightRef = useRef(0);
  const startSpeedRef = useRef(0);
  const lastSpeedRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetGesture = useCallback(() => {
    armedRef.current = false;
    activeRef.current = false;
  }, []);

  // `accept` filters the touches a document's listeners take; the returned
  // function removes them.
  const registerSpeedListeners = useCallback(
    (doc: Document, accept: (e: TouchEvent) => boolean = () => true) => {
      const opts = { capture: true, passive: false } as const;
      // Use screenX/screenY in a book iframe, not clientX/clientY: in scrolled
      // mode its document is many screens tall, and this listener runs in the
      // parent realm, so screen coordinates match the app viewport. The app
      // document's own client coordinates are that viewport already.
      const own = doc === document;
      const pointOf = (t: Touch) =>
        own ? { x: t.clientX, y: t.clientY } : { x: t.screenX, y: t.screenY };

      const onTouchStart = (e: TouchEvent) => {
        resetGesture();
        if (!latestRef.current.active || !accept(e)) return;
        const selection = doc.getSelection?.();
        if (selection && !selection.isCollapsed) return; // don't hijack selection
        const t = e.touches[0];
        if (!t) return;
        const { x, y } = pointOf(t);
        const viewWidth = window.innerWidth;
        viewHeightRef.current = window.innerHeight;
        startXRef.current = x;
        startYRef.current = y;
        armedRef.current = isInRightEdge(
          x,
          viewWidth,
          AUTO_SCROLL_GESTURE_EDGE_RATIO,
          edgeInsetRef.current,
        );
        startSpeedRef.current = latestRef.current.speed;
      };

      const onTouchMove = (e: TouchEvent) => {
        if (!armedRef.current) return;
        const t = e.touches[0];
        if (!t) return;
        const { x, y } = pointOf(t);
        const dx = x - startXRef.current;
        const dy = y - startYRef.current;
        // Reserve the strip: stop the native (paced) scroll from the first move,
        // so there is no scroll-then-freeze jump once speed control activates.
        e.preventDefault();
        if (!activeRef.current && shouldActivate(dx, dy)) {
          activeRef.current = true;
        }
        if (!activeRef.current) return;
        e.stopImmediatePropagation();
        const value = computeSpeed(startSpeedRef.current, dy, viewHeightRef.current);
        lastSpeedRef.current = value;
        latestRef.current.setSpeed(value, false);
        setOverlayVisible(true);
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (!activeRef.current) {
          resetGesture();
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        latestRef.current.setSpeed(lastSpeedRef.current, true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setOverlayVisible(false), OVERLAY_HIDE_DELAY_MS);
        resetGesture();
      };

      doc.addEventListener('touchstart', onTouchStart, opts);
      doc.addEventListener('touchmove', onTouchMove, opts);
      doc.addEventListener('touchend', onTouchEnd, opts);
      doc.addEventListener('touchcancel', onTouchEnd, opts);
      return () => {
        doc.removeEventListener('touchstart', onTouchStart, opts);
        doc.removeEventListener('touchmove', onTouchMove, opts);
        doc.removeEventListener('touchend', onTouchEnd, opts);
        doc.removeEventListener('touchcancel', onTouchEnd, opts);
      };
    },
    [resetGesture],
  );

  // While a page wipe's snapshot is up, touches meant for the book land on
  // the app document's root instead (#7575). Every book listens there; the
  // touch is for the one holding the snapshot.
  useEffect(
    () =>
      registerSpeedListeners(
        document,
        (e) => e.target === document.documentElement && latestRef.current.isWipeCovering(),
      ),
    [registerSpeedListeners],
  );

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return { registerSpeedListeners, overlayVisible };
};
