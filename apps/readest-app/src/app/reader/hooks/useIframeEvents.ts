import { useEffect, useRef } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { eventDispatcher } from '@/utils/event';
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL } from '@/services/constants';
import { createWheelGestureDetector } from '@/app/reader/utils/wheelGesture';
import { dispatchTouchInterceptors, TouchDetail } from './useTouchInterceptor';
import { hasVerticalPanning } from './usePagination';

export const useMouseEvent = (
  bookKey: string,
  handlePageFlip: (msg: MessageEvent | React.MouseEvent<HTMLDivElement, MouseEvent>) => void,
) => {
  const { hoveredBookKey } = useReaderStore();
  // Keep the latest handlePageFlip in a ref so the wheel-driven flip path
  // always invokes the most recent closure, independent of when listeners
  // were registered.
  const handlePageFlipRef = useRef(handlePageFlip);
  useEffect(() => {
    handlePageFlipRef.current = handlePageFlip;
  }, [handlePageFlip]);
  // Filters the raw wheel stream so a touch-surface mouse (e.g. Magic Mouse)
  // — which emits a flood of tiny events plus an inertial momentum tail for
  // one physical gesture — flips exactly one page instead of cascading
  // through several. See wheelGesture.ts.
  const wheelDetectorRef = useRef<ReturnType<typeof createWheelGestureDetector> | null>(null);
  if (!wheelDetectorRef.current) {
    wheelDetectorRef.current = createWheelGestureDetector();
  }
  const handleMouseEvent = (msg: MessageEvent | React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (msg instanceof MessageEvent) {
      if (msg.data && msg.data.bookKey === bookKey) {
        if (msg.data.type === 'iframe-wheel') {
          if (msg.data.ctrlKey) {
            // Pinch/ctrl-wheel zoom is not a page-turn gesture — drop any
            // travel accumulated so far so it can't bleed into a later flip.
            wheelDetectorRef.current!.reset();
            if (msg.data.deltaY > 0) {
              eventDispatcher.dispatch('zoom-out', { factor: Math.abs(msg.data.deltaY) / 100 });
            } else if (msg.data.deltaY < 0) {
              eventDispatcher.dispatch('zoom-in', { factor: Math.abs(msg.data.deltaY) / 100 });
            }
          } else {
            const flip = wheelDetectorRef.current!.feed({
              deltaX: msg.data.deltaX ?? 0,
              deltaY: msg.data.deltaY ?? 0,
              deltaMode: msg.data.deltaMode ?? 0,
              timeStamp: Date.now(),
            });
            if (flip) {
              handlePageFlipRef.current(
                new MessageEvent('message', {
                  data: { ...msg.data, deltaX: flip.deltaX, deltaY: flip.deltaY },
                }),
              );
            }
          }
        } else {
          handlePageFlip(msg);
        }
      }
    } else if (msg.type !== 'wheel') {
      handlePageFlip(msg);
    }
  };

  useEffect(() => {
    window.addEventListener('message', handleMouseEvent);
    return () => {
      window.removeEventListener('message', handleMouseEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, hoveredBookKey]);

  return {
    onClick: handlePageFlip,
    onWheel: handleMouseEvent,
  };
};

// Opens the image gallery / table zoom viewer when the iframe reports that the
// user tapped an image or table (reflowable books only). See the
// `iframe-open-media` producer in iframeEventHandlers.ts.
export const useOpenMediaEvent = (
  bookKey: string,
  handleImagePress: (src: string) => void,
  handleTablePress: (html: string) => void,
) => {
  const handleOpenMedia = (msg: MessageEvent) => {
    if (msg.data && msg.data.bookKey === bookKey && msg.data.type === 'iframe-open-media') {
      if (msg.data.elementType === 'image') {
        handleImagePress(msg.data.src);
      } else if (msg.data.elementType === 'table') {
        handleTablePress(msg.data.html);
      }
    }
  };

  useEffect(() => {
    window.addEventListener('message', handleOpenMedia);
    return () => {
      window.removeEventListener('message', handleOpenMedia);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);
};

interface IframeTouch {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
}

interface IframeTouchEvent {
  timeStamp: number;
  targetTouches: IframeTouch[];
}

// A two-finger gesture only becomes a pinch once the fingers' separation
// changes by at least this many pixels AND that change outweighs how far the
// pair has travelled together. On touchscreen laptops (e.g. Surface) users
// scroll with two fingers moving the same direction, which nudges the spacing
// a little; the deadzone keeps that from being read as an accidental zoom.
const PINCH_ACTIVATION_THRESHOLD = 24;
// Once the pair has translated this far together we lock the gesture as a
// two-finger scroll and stop looking for a pinch for the rest of it.
const TWO_FINGER_PAN_THRESHOLD = 12;

export const useTouchEvent = (bookKey: string) => {
  const { getBookData } = useBookDataStore();
  const { hoveredBookKey, setHoveredBookKey, getViewSettings, getView } = useReaderStore();

  const touchStartRef = useRef<IframeTouch | null>(null);
  const touchEndRef = useRef<IframeTouch | null>(null);
  const touchStartTimeRef = useRef<number | null>(null);
  const touchEndTimeRef = useRef<number | null>(null);
  const touchConsumedRef = useRef(false);
  // Two fingers on a fixed-layout book start in a "pending" state: we wait to
  // see whether they spread/converge (pinch) or slide together (scroll) before
  // committing. isPinchingRef only flips true once a pinch is confirmed.
  const pinchPendingRef = useRef(false);
  const isPinchingRef = useRef(false);
  const initialTouch0Ref = useRef<IframeTouch | null>(null);
  const initialTouch1Ref = useRef<IframeTouch | null>(null);
  const initialPinchDistRef = useRef(0);
  const initialZoomRef = useRef(100);
  const lastPinchRatioRef = useRef(1);

  const getTouchDistance = (t0: IframeTouch, t1: IframeTouch) => {
    // Use screenX/screenY instead of clientX/clientY because pinchZoom
    // applies a CSS transform to the iframe's parent, which changes the
    // iframe's coordinate space and causes clientX/clientY to oscillate
    const dx = t1.screenX - t0.screenX;
    const dy = t1.screenY - t0.screenY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const buildTouchDetail = (
    phase: 'start' | 'move' | 'end',
    touch: IframeTouch,
    touchStart: IframeTouch,
    startTime: number | null,
    endTime: number | null,
  ): TouchDetail => ({
    phase,
    touch: { screenX: touch.screenX, screenY: touch.screenY },
    touchStart: { screenX: touchStart.screenX, screenY: touchStart.screenY },
    deltaX: touch.screenX - touchStart.screenX,
    deltaY: touch.screenY - touchStart.screenY,
    deltaT: endTime && startTime ? endTime - startTime : 0,
  });

  const onTouchStart = (e: IframeTouchEvent | React.TouchEvent<HTMLDivElement>) => {
    const t0 = e.targetTouches[0] as IframeTouch | undefined;
    const t1 = e.targetTouches[1] as IframeTouch | undefined;
    if (t0 && t1) {
      const bookData = getBookData(bookKey);
      if (bookData?.isFixedLayout) {
        pinchPendingRef.current = true;
        isPinchingRef.current = false;
        initialTouch0Ref.current = t0;
        initialTouch1Ref.current = t1;
        initialPinchDistRef.current = getTouchDistance(t0, t1);
        initialZoomRef.current = getViewSettings(bookKey)?.zoomLevel ?? 100;
        lastPinchRatioRef.current = 1;
        touchStartRef.current = null;
        touchEndRef.current = null;
        return;
      }
    }
    if (!t0) return;
    touchStartRef.current = t0;
    touchStartTimeRef.current = 'timeStamp' in e ? e.timeStamp : Date.now();
    touchConsumedRef.current = false;
    const detail = buildTouchDetail(
      'start',
      t0,
      t0,
      touchStartTimeRef.current,
      touchStartTimeRef.current,
    );
    dispatchTouchInterceptors(bookKey, detail);
  };

  const onTouchMove = (e: IframeTouchEvent | React.TouchEvent<HTMLDivElement>) => {
    const t0 = e.targetTouches[0] as IframeTouch | undefined;
    const t1 = e.targetTouches[1] as IframeTouch | undefined;
    if ((pinchPendingRef.current || isPinchingRef.current) && t0 && t1) {
      if (pinchPendingRef.current) {
        const init0 = initialTouch0Ref.current;
        const init1 = initialTouch1Ref.current;
        if (!init0 || !init1) return;
        const currentDist = getTouchDistance(t0, t1);
        const separationDelta = Math.abs(currentDist - initialPinchDistRef.current);
        // How far the finger pair has slid together (midpoint travel). A pinch
        // keeps the midpoint roughly still while the separation changes; a
        // two-finger scroll moves the midpoint while the separation barely
        // shifts.
        const panX = (t0.screenX - init0.screenX + (t1.screenX - init1.screenX)) / 2;
        const panY = (t0.screenY - init0.screenY + (t1.screenY - init1.screenY)) / 2;
        const panDist = Math.sqrt(panX * panX + panY * panY);
        if (separationDelta >= PINCH_ACTIVATION_THRESHOLD && separationDelta > panDist) {
          // Confirmed pinch. Re-baseline the distance so the zoom starts at 1x
          // from here — the deadzone travel is absorbed rather than snapping.
          pinchPendingRef.current = false;
          isPinchingRef.current = true;
          initialPinchDistRef.current = currentDist;
        } else if (panDist >= TWO_FINGER_PAN_THRESHOLD && panDist >= separationDelta) {
          // Two-finger scroll — bow out and let the page scroll natively.
          pinchPendingRef.current = false;
          return;
        } else {
          return; // not enough movement to decide yet
        }
      }
      const currentDist = getTouchDistance(t0, t1);
      if (initialPinchDistRef.current > 0) {
        const ratio = currentDist / initialPinchDistRef.current;
        lastPinchRatioRef.current = ratio;
        const renderer = getView(bookKey)?.renderer;
        renderer?.pinchZoom?.(ratio);
      }
      return;
    }
    if (!touchStartRef.current) return;
    const touch = t0;
    if (touch) {
      touchEndRef.current = touch;
      touchEndTimeRef.current = 'timeStamp' in e ? e.timeStamp : Date.now();
      const detail = buildTouchDetail(
        'move',
        touch,
        touchStartRef.current,
        touchStartTimeRef.current,
        touchEndTimeRef.current,
      );
      if (dispatchTouchInterceptors(bookKey, detail)) {
        touchConsumedRef.current = true;
        return;
      }
    }
    if (touchConsumedRef.current) return;
    const { current: touchStart } = touchStartRef;
    const { current: touchEnd } = touchEndRef;
    if (hoveredBookKey && touchEnd) {
      const viewSettings = getViewSettings(bookKey)!;
      const deltaY = touchEnd.screenY - touchStart.screenY;
      const deltaX = touchEnd.screenX - touchStart.screenX;
      if (!viewSettings!.scrolled && !viewSettings!.vertical) {
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
          setHoveredBookKey(null);
        }
      } else {
        setHoveredBookKey(null);
      }
    }
  };

  const onTouchEnd = (e: IframeTouchEvent | React.TouchEvent<HTMLDivElement>) => {
    if (isPinchingRef.current || pinchPendingRef.current) {
      const t0 = e.targetTouches[0] as IframeTouch | undefined;
      const t1 = e.targetTouches[1] as IframeTouch | undefined;
      if (t0 && t1) return; // still two fingers down
      const wasPinching = isPinchingRef.current;
      isPinchingRef.current = false;
      pinchPendingRef.current = false;
      initialTouch0Ref.current = null;
      initialTouch1Ref.current = null;
      // Only commit a zoom if a pinch was actually confirmed. A gesture that
      // stayed pending (jitter) or resolved to a scroll leaves zoom untouched.
      const renderer = getView(bookKey)?.renderer;
      if (wasPinching && renderer && initialPinchDistRef.current > 0) {
        renderer.pinchEnd?.();
        const newZoom = Math.round(initialZoomRef.current * lastPinchRatioRef.current);
        const clampedZoom = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, newZoom));
        eventDispatcher.dispatch('pinch-zoom', { zoomLevel: clampedZoom });
      }
      touchStartRef.current = null;
      touchEndRef.current = null;
      return;
    }
    if (!touchStartRef.current) return;

    const touch = e.targetTouches[0];
    if (touch) {
      touchEndRef.current = touch;
      touchEndTimeRef.current = 'timeStamp' in e ? e.timeStamp : Date.now();
    }

    const { current: touchStart } = touchStartRef;
    const { current: touchEnd } = touchEndRef;

    // Dispatch end to interceptors, then check if the gesture was consumed
    if (touchEnd && touchStart) {
      const detail = buildTouchDetail(
        'end',
        touchEnd,
        touchStart,
        touchStartTimeRef.current,
        touchEndTimeRef.current,
      );
      dispatchTouchInterceptors(bookKey, detail);
    }

    if (touchConsumedRef.current) {
      touchConsumedRef.current = false;
      touchStartRef.current = null;
      touchEndRef.current = null;
      return;
    }

    // Gesture was not consumed — handle hover bar toggle
    if (touchEnd && touchStart) {
      const windowWidth = window.innerWidth;
      const deltaY = touchEnd.screenY - touchStart.screenY;
      const deltaX = touchEnd.screenX - touchStart.screenX;
      if (
        deltaY < -10 &&
        Math.abs(deltaY) > Math.abs(deltaX) * 2 &&
        Math.abs(deltaX) < windowWidth * 0.3
      ) {
        const viewSettings = getViewSettings(bookKey)!;
        const bookData = getBookData(bookKey)!;
        // On a fixed-layout page that can pan vertically (e.g. fit-width in
        // landscape overflows vertically even at 100% zoom) an upward swipe
        // is a pan, not a toggle-the-bars gesture (#5142).
        if (
          !viewSettings!.scrolled &&
          !viewSettings!.vertical &&
          (!bookData.isFixedLayout || !hasVerticalPanning(getView(bookKey), viewSettings))
        ) {
          setHoveredBookKey(hoveredBookKey ? null : bookKey);
        }
      } else {
        if (hoveredBookKey) {
          setHoveredBookKey(null);
        }
      }
    }

    touchConsumedRef.current = false;
    touchStartRef.current = null;
    touchEndRef.current = null;
  };

  const handleTouch = (msg: MessageEvent) => {
    if (msg.data && msg.data.bookKey === bookKey) {
      if (msg.data.type === 'iframe-touchstart') {
        onTouchStart(msg.data);
      } else if (msg.data.type === 'iframe-touchmove') {
        onTouchMove(msg.data);
      } else if (msg.data.type === 'iframe-touchend') {
        onTouchEnd(msg.data);
      }
    }
  };

  useEffect(() => {
    window.addEventListener('message', handleTouch);
    return () => {
      window.removeEventListener('message', handleTouch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredBookKey]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
};
