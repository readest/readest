import { useCallback, useEffect, useRef, useState } from 'react';
import {
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

  // The once-attached listener reads the latest session state and setter here.
  const latestRef = useRef(autoScroll);
  latestRef.current = autoScroll;

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

  const registerSpeedListeners = useCallback(
    (doc: Document) => {
      const opts = { capture: true, passive: false } as const;

      const onTouchStart = (e: TouchEvent) => {
        resetGesture();
        if (!latestRef.current.active) return;
        const selection = doc.getSelection?.();
        if (selection && !selection.isCollapsed) return; // don't hijack selection
        const t = e.touches[0];
        if (!t) return;
        // Use screenX/screenY, not clientX/clientY: in scrolled mode the iframe
        // document is many screens tall, and this listener runs in the parent
        // realm, so screen coordinates match the app viewport.
        const viewWidth = window.innerWidth;
        viewHeightRef.current = window.innerHeight;
        startXRef.current = t.screenX;
        startYRef.current = t.screenY;
        armedRef.current = isInRightEdge(t.screenX, viewWidth);
        startSpeedRef.current = latestRef.current.speed;
      };

      const onTouchMove = (e: TouchEvent) => {
        if (!armedRef.current) return;
        const t = e.touches[0];
        if (!t) return;
        const dx = t.screenX - startXRef.current;
        const dy = t.screenY - startYRef.current;
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
    },
    [resetGesture],
  );

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return { registerSpeedListeners, overlayVisible };
};
