import { useEffect } from 'react';
import { FoliateView } from '@/types/view';
import { useReaderStore } from '@/store/readerStore';
import { eventDispatcher } from '@/utils/event';

export const useClickEvent = (
  bookKey: string,
  viewRef: React.MutableRefObject<FoliateView | null>,
  containerRef: React.RefObject<HTMLDivElement>,
) => {
  const { getViewSettings } = useReaderStore();
  const { hoveredBookKey, setHoveredBookKey } = useReaderStore();
  const handleTurnPage = (msg: MessageEvent | React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (msg instanceof MessageEvent) {
      if (msg.data && msg.data.bookKey === bookKey) {
        const viewSettings = getViewSettings(bookKey)!;
        if (msg.data.type === 'iframe-single-click') {
          if (viewSettings.disableClick!) {
            return;
          }
          const viewElement = containerRef.current;
          if (viewElement) {
            const rect = viewElement.getBoundingClientRect();
            const { screenX, screenY } = msg.data;
            const consumed = eventDispatcher.dispatchSync('iframe-single-click', {
              screenX,
              screenY,
            });
            if (!consumed) {
              const centerStartX = rect.left + rect.width * 0.375;
              const centerEndX = rect.left + rect.width * 0.625;
              const centerStartY = rect.top + rect.height * 0.375;
              const centerEndY = rect.top + rect.height * 0.625;
              if (
                screenX >= centerStartX &&
                screenX <= centerEndX &&
                screenY >= centerStartY &&
                screenY <= centerEndY
              ) {
                // toggle visibility of the header bar and the footer bar
                setHoveredBookKey(hoveredBookKey ? '' : bookKey);
              } else if (screenX >= rect.left + rect.width / 2) {
                viewRef.current?.goRight();
              } else if (screenX < rect.left + rect.width / 2) {
                viewRef.current?.goLeft();
              }
            }
          }
        } else if (msg.data.type === 'iframe-wheel' && !viewSettings.scrolled) {
          const { deltaY } = msg.data;
          if (deltaY > 0) {
            viewRef.current?.next(1);
          } else if (deltaY < 0) {
            viewRef.current?.prev(1);
          }
        }
      }
    } else {
      const { clientX } = msg;
      const width = window.innerWidth;
      const leftThreshold = width * 0.5;
      const rightThreshold = width * 0.5;
      if (clientX < leftThreshold) {
        viewRef.current?.goLeft();
      } else if (clientX > rightThreshold) {
        viewRef.current?.goRight();
      }
    }
  };

  useEffect(() => {
    window.addEventListener('message', handleTurnPage);
    return () => {
      window.removeEventListener('message', handleTurnPage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredBookKey, viewRef]);

  return {
    handleTurnPage,
  };
};
