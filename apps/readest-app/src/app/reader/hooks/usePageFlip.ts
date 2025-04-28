import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { FoliateView } from '@/types/view';
import { useReaderStore } from '@/store/readerStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { eventDispatcher } from '@/utils/event';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriGetWindowLogicalPosition } from '@/utils/window';

export const usePageFlip = (
  bookKey: string,
  viewRef: React.MutableRefObject<FoliateView | null>,
  containerRef: React.RefObject<HTMLDivElement>,
) => {
  const { appService } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { hoveredBookKey, setHoveredBookKey } = useReaderStore();
  const { acquireVolumeKeyInterception, releaseVolumeKeyInterception } = useDeviceControlStore();
  const handlePageFlip = async (
    msg: MessageEvent | CustomEvent | React.MouseEvent<HTMLDivElement, MouseEvent>,
  ) => {
    if (msg instanceof MessageEvent) {
      if (msg.data && msg.data.bookKey === bookKey) {
        const viewSettings = getViewSettings(bookKey)!;
        if (msg.data.type === 'iframe-single-click') {
          const viewElement = containerRef.current;
          if (viewElement) {
            const { screenX } = msg.data;
            const viewRect = viewElement.getBoundingClientRect();
            let windowStartX;
            // Currently for tauri APP the window.screenX is always 0
            if (isTauriAppPlatform()) {
              if (appService?.isMobile) {
                windowStartX = 0;
              } else {
                const windowPosition = (await tauriGetWindowLogicalPosition()) as {
                  x: number;
                  y: number;
                };
                windowStartX = windowPosition.x;
              }
            } else {
              windowStartX = window.screenX;
            }
            const viewStartX = windowStartX + viewRect.left;
            const viewCenterX = viewStartX + viewRect.width / 2;
            const consumed = eventDispatcher.dispatchSync('iframe-single-click');
            if (!consumed) {
              const centerStartX = viewStartX + viewRect.width * 0.375;
              const centerEndX = viewStartX + viewRect.width * 0.625;
              if (
                viewSettings.disableClick! ||
                (screenX >= centerStartX && screenX <= centerEndX)
              ) {
                // toggle visibility of the header bar and the footer bar
                setHoveredBookKey(hoveredBookKey ? null : bookKey);
              } else {
                if (hoveredBookKey) {
                  setHoveredBookKey(null);
                  return;
                }
                if (!viewSettings.disableClick! && screenX >= viewCenterX) {
                  if (viewSettings.swapClickArea) {
                    viewRef.current?.goLeft();
                  } else {
                    viewRef.current?.goRight();
                  }
                } else if (!viewSettings.disableClick! && screenX < viewCenterX) {
                  if (viewSettings.swapClickArea) {
                    viewRef.current?.goRight();
                  } else {
                    viewRef.current?.goLeft();
                  }
                }
              }
            }
          }
        } else if (msg.data.type === 'iframe-wheel' && !viewSettings.scrolled) {
          // The wheel event is handled by the iframe itself in scrolled mode.
          const { deltaY } = msg.data;
          if (deltaY > 0) {
            viewRef.current?.next(1);
          } else if (deltaY < 0) {
            viewRef.current?.prev(1);
          }
        } else if (msg.data.type === 'iframe-mouseup') {
          if (msg.data.button === 3) {
            viewRef.current?.history.back();
          } else if (msg.data.button === 4) {
            viewRef.current?.history.forward();
          }
        }
      }
    } else if (msg instanceof CustomEvent) {
      const { keyName } = msg.detail;
      const viewSettings = getViewSettings(bookKey);
      if (viewSettings?.volumeKeysToFlip) {
        setHoveredBookKey('');
        if (keyName === 'VolumeUp') {
          viewRef.current?.goLeft();
        } else if (keyName === 'VolumeDown') {
          viewRef.current?.goRight();
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
    if (!appService?.isMobileApp) return;

    const viewSettings = getViewSettings(bookKey);
    if (viewSettings?.volumeKeysToFlip) {
      acquireVolumeKeyInterception();
    } else {
      releaseVolumeKeyInterception();
    }

    eventDispatcher.on('native-key-down', handlePageFlip);
    return () => {
      releaseVolumeKeyInterception();
      eventDispatcher.off('native-key-down', handlePageFlip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    handlePageFlip,
  };
};
