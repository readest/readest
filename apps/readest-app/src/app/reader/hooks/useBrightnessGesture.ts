import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { saveSysSettings } from '@/helpers/settings';
import { setLayeredTurnTouchClaimed } from '@/app/reader/utils/iframeEventHandlers';
import {
  BRIGHTNESS_GESTURE_ACTIVATION_PX,
  BRIGHTNESS_GESTURE_EDGE_RATIO,
  computeBrightness,
  isInLeftEdge,
  shouldActivate,
  TURN_GESTURE_LEFT_INSET_ATTRIBUTE,
} from '@/app/reader/utils/brightnessGesture';

const OVERLAY_HIDE_DELAY_MS = 600;
const DEFAULT_BRIGHTNESS = 0.5;

interface LatestState {
  enabled: boolean;
  scrolled: boolean;
}

/**
 * Left-edge swipe-to-adjust-brightness gesture (iOS / Android only).
 *
 * Attaches capture-phase, non-passive touch listeners to the foliate iframe
 * document. Capture phase is required: foliate-js's own paginator registers its
 * touch listeners during `view.open()` (before any app listener) in the bubble
 * phase, so only a capture-phase `stopImmediatePropagation` can suppress them.
 *
 * The listener is attached once per document, so everything runtime-variable is
 * read through `latestRef` (updated each render), mirroring `useTouchInterceptor`.
 */
export const useBrightnessGesture = (bookKey: string) => {
  const { appService, envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getView, getViewSettings } = useReaderStore();
  const { getScreenBrightness, setScreenBrightness } = useDeviceControlStore();

  const hasScreenBrightness = !!appService?.hasScreenBrightness;
  const viewSettings = getViewSettings(bookKey);
  const renderer = getView(bookKey)?.renderer;
  const brightnessGestureEnabled = hasScreenBrightness && settings.swipeBrightnessGesture;

  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayLevel, setOverlayLevel] = useState(0);

  // Everything the once-attached listener must read at the latest value.
  const latestRef = useRef<LatestState>({ enabled: false, scrolled: false });
  latestRef.current = {
    enabled: brightnessGestureEnabled,
    scrolled: !!viewSettings?.scrolled,
  };

  useEffect(() => {
    if (!renderer) return;
    if (brightnessGestureEnabled) {
      renderer.setAttribute(
        TURN_GESTURE_LEFT_INSET_ATTRIBUTE,
        String(BRIGHTNESS_GESTURE_EDGE_RATIO),
      );
    } else {
      renderer.removeAttribute(TURN_GESTURE_LEFT_INSET_ATTRIBUTE);
    }
    return () => renderer.removeAttribute(TURN_GESTURE_LEFT_INSET_ATTRIBUTE);
  }, [renderer, brightnessGestureEnabled]);

  // Per-gesture state.
  const armedRef = useRef(false);
  const activeRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const viewHeightRef = useRef(0);
  const startValueRef = useRef(DEFAULT_BRIGHTNESS);
  const levelRef = useRef(DEFAULT_BRIGHTNESS);
  const rafIdRef = useRef<number | null>(null);
  const pendingValueRef = useRef<number | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed brightness (0-1): the value a gesture starts from. Primed eagerly so the
  // first swipe never races the async device read.
  const seedRef = useRef(DEFAULT_BRIGHTNESS);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!hasScreenBrightness) return;
    if (settings.screenBrightness >= 0) {
      seedRef.current = Math.max(0, Math.min(1, settings.screenBrightness / 100));
      seededRef.current = true;
      return;
    }
    let cancelled = false;
    getScreenBrightness().then((b) => {
      if (cancelled) return;
      seedRef.current = b >= 0 && b <= 1 ? b : DEFAULT_BRIGHTNESS;
      seededRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [hasScreenBrightness, settings.screenBrightness, getScreenBrightness]);

  const flushBrightness = useCallback(() => {
    rafIdRef.current = null;
    if (pendingValueRef.current !== null) {
      setScreenBrightness(pendingValueRef.current);
      pendingValueRef.current = null;
    }
  }, [setScreenBrightness]);

  const scheduleBrightness = useCallback(
    (value: number) => {
      pendingValueRef.current = value;
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(flushBrightness);
      }
    },
    [flushBrightness],
  );

  const cancelRaf = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingValueRef.current = null;
  }, []);

  const resetGesture = useCallback(() => {
    armedRef.current = false;
    activeRef.current = false;
  }, []);

  const abortGesture = useCallback(() => {
    cancelRaf();
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    resetGesture();
    setOverlayVisible(false);
  }, [cancelRaf, resetGesture]);

  const registerBrightnessListeners = useCallback(
    (doc: Document) => {
      const opts = { capture: true, passive: false } as const;

      const onTouchStart = (e: TouchEvent) => {
        abortGesture();
        if (!latestRef.current.enabled) return;
        // A second finger permanently yields this sequence to pinch/zoom. In
        // particular, do not let the first finger keep brightness armed and
        // steal later moves from the paginator in capture phase.
        if (e.touches.length !== 1) return;
        const selection = doc.getSelection?.();
        if (selection && !selection.isCollapsed) return; // don't hijack selection
        const t = e.touches[0];
        if (!t) return;
        // Use screenX/screenY, not clientX/clientY: in paginated mode foliate-js
        // lays content out as side-by-side columns, so the iframe document is
        // many screens wide and clientX is a document coordinate. screenX is the
        // physical screen position, and this listener runs in the parent realm so
        // `window` is the app viewport.
        const viewWidth = window.innerWidth;
        viewHeightRef.current = window.innerHeight;
        startXRef.current = t.screenX;
        startYRef.current = t.screenY;
        armedRef.current = isInLeftEdge(t.screenX, viewWidth);
        startValueRef.current = seedRef.current;
      };

      const onTouchMove = (e: TouchEvent) => {
        if (!armedRef.current) return;
        if (e.touches.length !== 1) {
          abortGesture();
          return;
        }
        const t = e.touches[0];
        if (!t) return;
        const dx = t.screenX - startXRef.current;
        const dy = t.screenY - startYRef.current;
        // Gesture ownership is one-way. Once the same activation distance is
        // clearly horizontal, brightness may not claim the sequence later if
        // the trajectory bends vertically; Slide/Curl can safely own it.
        if (
          !activeRef.current &&
          Math.abs(dx) >= BRIGHTNESS_GESTURE_ACTIVATION_PX &&
          Math.abs(dx) > Math.abs(dy)
        ) {
          resetGesture();
          return;
        }
        // Reserve the strip in scrolled mode: stop native scroll from the first
        // move, so there is no scroll-then-freeze jump once brightness activates.
        if (latestRef.current.scrolled) e.preventDefault();
        if (!activeRef.current && shouldActivate(dx, dy)) {
          activeRef.current = true;
        }
        if (!activeRef.current) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const value = computeBrightness(startValueRef.current, dy, viewHeightRef.current);
        levelRef.current = value;
        scheduleBrightness(value);
        setOverlayVisible(true);
        setOverlayLevel(value);
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (e.touches.length > 0) {
          abortGesture();
          return;
        }
        if (!activeRef.current) {
          resetGesture();
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        // This capture-phase owner prevents the normal iframe touchend
        // forwarder from seeing the release, so clear its per-touch state here.
        setLayeredTurnTouchClaimed(bookKey, false);
        cancelRaf();
        const value = levelRef.current;
        setScreenBrightness(value);
        seedRef.current = value;
        saveSysSettings(envConfig, 'screenBrightness', Math.round(value * 100));
        saveSysSettings(envConfig, 'autoScreenBrightness', false);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null;
          setOverlayVisible(false);
        }, OVERLAY_HIDE_DELAY_MS);
        resetGesture();
      };

      doc.addEventListener('touchstart', onTouchStart, opts);
      doc.addEventListener('touchmove', onTouchMove, opts);
      doc.addEventListener('touchend', onTouchEnd, opts);
      doc.addEventListener('touchcancel', onTouchEnd, opts);
    },
    [abortGesture, resetGesture, scheduleBrightness, cancelRaf, setScreenBrightness, envConfig],
  );

  useEffect(() => {
    return () => {
      cancelRaf();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [cancelRaf]);

  return { registerBrightnessListeners, overlayVisible, overlayLevel };
};
