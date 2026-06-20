import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { saveSysSettings } from '@/helpers/settings';
import {
  computeBrightness,
  isInLeftEdge,
  shouldActivate,
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
  const { getViewSettings } = useReaderStore();
  const { getScreenBrightness, setScreenBrightness } = useDeviceControlStore();

  const hasScreenBrightness = !!appService?.hasScreenBrightness;
  const viewSettings = getViewSettings(bookKey);

  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayLevel, setOverlayLevel] = useState(0);

  // Everything the once-attached listener must read at the latest value.
  const latestRef = useRef<LatestState>({ enabled: false, scrolled: false });
  latestRef.current = {
    enabled: hasScreenBrightness && settings.swipeBrightnessGesture,
    scrolled: !!viewSettings?.scrolled,
  };

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

  const registerBrightnessListeners = useCallback(
    (doc: Document) => {
      const opts = { capture: true, passive: false } as const;

      const onTouchStart = (e: TouchEvent) => {
        resetGesture();
        if (!latestRef.current.enabled) return;
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
        const t = e.touches[0];
        if (!t) return;
        const dx = t.screenX - startXRef.current;
        const dy = t.screenY - startYRef.current;
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
        if (!activeRef.current) {
          resetGesture();
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        cancelRaf();
        const value = levelRef.current;
        setScreenBrightness(value);
        seedRef.current = value;
        saveSysSettings(envConfig, 'screenBrightness', Math.round(value * 100));
        saveSysSettings(envConfig, 'autoScreenBrightness', false);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setOverlayVisible(false), OVERLAY_HIDE_DELAY_MS);
        resetGesture();
      };

      doc.addEventListener('touchstart', onTouchStart, opts);
      doc.addEventListener('touchmove', onTouchMove, opts);
      doc.addEventListener('touchend', onTouchEnd, opts);
      doc.addEventListener('touchcancel', onTouchEnd, opts);
    },
    [resetGesture, scheduleBrightness, cancelRaf, setScreenBrightness, envConfig],
  );

  useEffect(() => {
    return () => {
      cancelRaf();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [cancelRaf]);

  return { registerBrightnessListeners, overlayVisible, overlayLevel };
};
