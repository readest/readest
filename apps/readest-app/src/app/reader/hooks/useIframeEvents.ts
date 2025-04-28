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
  const viewSettings = getViewSettings(bookKey)!;

  let touchStart: IframeTouch | null = null;
  let touchEnd: IframeTouch | null = null;

  const onTouchStart = (e: IframeTouchEvent) => {
    touchEnd = null;
    const touch = e.targetTouches[0];
    if (!touch) return;
    touchStart = touch;
  };

  const onTouchMove = (e: IframeTouchEvent) => {
    if (!touchStart) return;
    const touch = e.targetTouches[0];
    if (touch) {
      touchEnd = touch;
    }
    if (hoveredBookKey && touchEnd) {
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

  const onTouchEnd = (e: IframeTouchEvent) => {
    if (!touchStart) return;

    const touch = e.targetTouches[0];
    if (touch) {
      touchEnd = touch;
    }

    const windowWidth = window.innerWidth;
    if (touchEnd) {
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
};
