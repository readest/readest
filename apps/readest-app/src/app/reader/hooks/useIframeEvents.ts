import { useEffect } from 'react';
import { FoliateView } from '@/types/view';
import { useReaderStore } from '@/store/readerStore';

export const useClickEvent = (bookKey: string, handlePageFlip: (msg: MessageEvent) => void) => {
  const { hoveredBookKey } = useReaderStore();

  useEffect(() => {
    window.addEventListener('message', handlePageFlip);
    return () => {
      window.removeEventListener('message', handlePageFlip);
    };
  }, [bookKey, hoveredBookKey, handlePageFlip]);
};

interface IframeTouch {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
}

interface IframeTouchEvent {
  targetTouches: IframeTouch[];
}

export const useTouchEvent = (
  bookKey: string,
  viewRef: React.MutableRefObject<FoliateView | null>,
) => {
  const { hoveredBookKey, setHoveredBookKey, getViewSettings } = useReaderStore();

  let touchStart: IframeTouch | null = null;
  let touchEnd: IframeTouch | null = null;

  const onTouchStart = (e: IframeTouchEvent | React.TouchEvent<HTMLDivElement>) => {
    touchEnd = null;
    const touch = e.targetTouches[0];
    if (!touch) return;
    touchStart = touch;
  };

  const onTouchMove = (e: IframeTouchEvent | React.TouchEvent<HTMLDivElement>) => {
    if (!touchStart) return;
    const touch = e.targetTouches[0];
    if (touch) {
      touchEnd = touch;
    }
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
    if (!touchStart) return;

    const touch = e.targetTouches[0];
    if (touch) {
      touchEnd = touch;
    }

    const windowWidth = window.innerWidth;
    if (touchEnd) {
      const viewSettings = getViewSettings(bookKey)!;
      const deltaY = touchEnd.screenY - touchStart.screenY;
      const deltaX = touchEnd.screenX - touchStart.screenX;
      // also check for deltaX to prevent swipe page turn from triggering the toggle
      if (
        deltaY < -10 &&
        Math.abs(deltaY) > Math.abs(deltaX) &&
        Math.abs(deltaX) < windowWidth * 0.3
      ) {
        // swipe up to toggle the header bar and the footer bar, only for horizontal page mode
        if (!viewSettings!.scrolled && !viewSettings!.vertical) {
          setHoveredBookKey(hoveredBookKey ? null : bookKey);
        }
      } else {
        if (hoveredBookKey) {
          setHoveredBookKey(null);
        }
      }
      const renderer = viewRef.current?.renderer;
      if (renderer && viewSettings.scrolled && viewSettings.continuousScroll) {
        const SCROLL_THRESHOLD = 30;
        const doScroll = () => {
          // may have overscroll where the start is greater than 0
          if (renderer.start <= deltaY && deltaY > SCROLL_THRESHOLD) {
            setTimeout(() => {
              viewRef.current?.prev(renderer.start + 1);
            }, 100);
            // sometimes viewSize has subpixel value that the end never reaches
          } else if (
            Math.ceil(renderer.end) - deltaY >= renderer.viewSize &&
            deltaY < -SCROLL_THRESHOLD
          ) {
            setTimeout(() => {
              viewRef.current?.next(renderer.viewSize - Math.floor(renderer.end) + 1);
            }, 100);
          }
        };
        if (renderer.size >= renderer.viewSize) {
          doScroll();
        } else {
          const handleRelocate = () => {
            doScroll();
          };
          renderer.addEventListener('relocate', handleRelocate, { once: true });
        }
      }
    }

    touchStart = null;
    touchEnd = null;
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
  }, [hoveredBookKey, viewRef.current]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
};
