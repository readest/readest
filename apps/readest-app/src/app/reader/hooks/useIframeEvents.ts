import { useEffect, useRef } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL } from '@/services/constants';

export const useMouseEvent = (
  bookKey: string,
  handlePageFlip: (msg: MessageEvent | React.MouseEvent<HTMLDivElement, MouseEvent>) => void,
) => {
  const { hoveredBookKey } = useReaderStore();
  const debounceFlip = debounce(handlePageFlip, 100);
  const handleMouseEvent = (msg: MessageEvent | React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (msg instanceof MessageEvent) {
      if (msg.data && msg.data.bookKey === bookKey) {
        if (msg.data.type === 'iframe-wheel') {
          if (msg.data.ctrlKey) {
            if (msg.data.deltaY > 0) {
              eventDispatcher.dispatch('zoom-out', { factor: Math.abs(msg.data.deltaY) / 100 });
            } else if (msg.data.deltaY < 0) {
              eventDispatcher.dispatch('zoom-in', { factor: Math.abs(msg.data.deltaY) / 100 });
            }
          } else {
            debounceFlip(msg);
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

export const useLongPressEvent = (
  bookKey: string,
  handleImagePress: (src: string) => void,
  handleTablePress: (html: string) => void,
) => {
  const handleLongPress = (msg: MessageEvent) => {
    if (msg.data && msg.data.bookKey === bookKey && msg.data.type === 'iframe-long-press') {
      if (msg.data.elementType === 'image') {
        handleImagePress(msg.data.src);
      } else if (msg.data.elementType === 'table') {
        handleTablePress(msg.data.html);
      }
    }
  };

  useEffect(() => {
    window.addEventListener('message', handleLongPress);
    return () => {
      window.removeEventListener('message', handleLongPress);
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

export const useTouchEvent = (bookKey: string, handlePageFlip: (msg: CustomEvent) => void) => {
  const { getBookData } = useBookDataStore();
  const { hoveredBookKey, setHoveredBookKey, getViewSettings, getView } = useReaderStore();

  const touchStartRef = useRef<IframeTouch | null>(null);
  const touchEndRef = useRef<IframeTouch | null>(null);
  const touchStartTimeRef = useRef<number | null>(null);
  const touchEndTimeRef = useRef<number | null>(null);
  const isPinchingRef = useRef(false);
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

  const onTouchStart = (e: IframeTouchEvent | React.TouchEvent<HTMLDivElement>) => {
    const t0 = e.targetTouches[0] as IframeTouch | undefined;
    const t1 = e.targetTouches[1] as IframeTouch | undefined;
    if (t0 && t1) {
      const bookData = getBookData(bookKey);
      if (bookData?.isFixedLayout) {
        isPinchingRef.current = true;
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
  };

  const onTouchMove = (e: IframeTouchEvent | React.TouchEvent<HTMLDivElement>) => {
    const t0 = e.targetTouches[0] as IframeTouch | undefined;
    const t1 = e.targetTouches[1] as IframeTouch | undefined;
    if (isPinchingRef.current && t0 && t1) {
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
    }
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
    if (isPinchingRef.current) {
      const t0 = e.targetTouches[0] as IframeTouch | undefined;
      const t1 = e.targetTouches[1] as IframeTouch | undefined;
      if (t0 && t1) return; // still pinching with 2+ fingers
      isPinchingRef.current = false;
      const renderer = getView(bookKey)?.renderer;
      if (renderer && initialPinchDistRef.current > 0) {
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

    const windowWidth = window.innerWidth;
    const { current: touchStart } = touchStartRef;
    const { current: touchEnd } = touchEndRef;
    const { current: touchStartTime } = touchStartTimeRef;
    const { current: touchEndTime } = touchEndTimeRef;
    if (touchEnd) {
      const viewSettings = getViewSettings(bookKey)!;
      const bookData = getBookData(bookKey)!;
      const deltaY = touchEnd.screenY - touchStart.screenY;
      const deltaX = touchEnd.screenX - touchStart.screenX;
      const deltaT = touchEndTime && touchStartTime ? touchEndTime - touchStartTime : 0;
      // also check for deltaX to prevent swipe page turn from triggering the toggle
      if (
        deltaY < -10 &&
        Math.abs(deltaY) > Math.abs(deltaX) * 2 &&
        Math.abs(deltaX) < windowWidth * 0.3
      ) {
        // swipe up to toggle the header bar and the footer bar, only for horizontal page mode
        if (
          !viewSettings!.scrolled && // not scrolled
          !viewSettings!.vertical && // not vertical
          (!bookData.isFixedLayout || viewSettings.zoomLevel <= 100) // for fixed layout, not when zoomed in
        ) {
          setHoveredBookKey(hoveredBookKey ? null : bookKey);
        }
      } else {
        if (hoveredBookKey) {
          setHoveredBookKey(null);
        }
      }
      handlePageFlip(
        new CustomEvent('touch-swipe', {
          detail: {
            deltaX,
            deltaY,
            deltaT,
            startX: touchStart.screenX,
            startY: touchStart.screenY,
            endX: touchEnd.screenX,
            endY: touchEnd.screenY,
          },
        }),
      );
    }

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
