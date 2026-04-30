import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { FoliateView } from '@/types/view';
import { ViewSettings } from '@/types/book';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { eventDispatcher } from '@/utils/event';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriGetWindowLogicalPosition } from '@/utils/window';
import { getReadingRulerMoveDirection } from '../utils/readingRuler';
import { SmoothScroller, type SmoothScrollTarget } from '../utils/smoothWheelScroll';
import { useTouchInterceptor } from './useTouchInterceptor';

export type ScrollSource = 'touch' | 'mouse';

type PaginationSide = 'left' | 'right' | 'up' | 'down';
type PaginationMode = 'pan' | 'page' | 'section';

const swapLeftRight = (side: PaginationSide) => {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return side;
};

const isPanningView = (view: FoliateView | null, viewSettings: ViewSettings | null | undefined) => {
  if (!view || !viewSettings) return false;
  return (
    view.book.rendition?.layout === 'pre-paginated' &&
    (viewSettings.zoomLevel > 100 || viewSettings.zoomMode !== 'fit-page')
  );
};

const hasHorizontalPanning = (
  view: FoliateView | null,
  viewSettings: ViewSettings | null | undefined,
) => {
  if (!view || !viewSettings) return false;
  return isPanningView(view, viewSettings) && view.isOverflowX();
};

const hasVerticalPanning = (
  view: FoliateView | null,
  viewSettings: ViewSettings | null | undefined,
) => {
  if (!view || !viewSettings) return false;
  return isPanningView(view, viewSettings) && view.isOverflowY();
};

export const viewPagination = (
  view: FoliateView | null,
  viewSettings: ViewSettings | null | undefined,
  side: PaginationSide,
  mode: PaginationMode = 'page',
  panDistance: number = 50,
) => {
  if (!view || !viewSettings) return;
  const renderer = view.renderer;
  if (viewSettings.rtl) {
    side = swapLeftRight(side);
  }
  if (renderer.scrolled) {
    const { size } = renderer;
    const showHeader = viewSettings.showHeader && viewSettings.showBarsOnScroll;
    const showFooter = viewSettings.showFooter && viewSettings.showBarsOnScroll;
    const scrollingOverlap = viewSettings.scrollingOverlap;
    const distance = size - scrollingOverlap - (showHeader ? 44 : 0) - (showFooter ? 44 : 0);
    switch (mode) {
      case 'section':
        if (side === 'left' || side === 'up') {
          return view.renderer.prevSection?.();
        } else {
          return view.renderer.nextSection?.();
        }
      case 'pan':
      case 'page':
      default:
        return side === 'left' || side === 'up' ? view.prev(distance) : view.next(distance);
    }
  } else if (mode === 'pan' && isPanningView(view, viewSettings)) {
    if (hasHorizontalPanning(view, viewSettings) && (side === 'left' || side === 'right')) {
      return view.pan(side === 'left' ? -panDistance : panDistance, 0);
    } else if (hasVerticalPanning(view, viewSettings) && (side === 'up' || side === 'down')) {
      return view.pan(0, side === 'up' ? -panDistance : panDistance);
    } else {
      return side === 'left' || side === 'up' ? view.prev() : view.next();
    }
  } else {
    switch (mode) {
      case 'section':
        if (side === 'left' || side === 'up') {
          return view.renderer.prevSection?.();
        } else {
          return view.renderer.nextSection?.();
        }
      case 'pan':
      case 'page':
      default:
        return side === 'left' || side === 'up' ? view.prev() : view.next();
    }
  }
};

export const usePagination = (
  bookKey: string,
  viewRef: React.RefObject<FoliateView | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
) => {
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getViewSettings, getViewState } = useReaderStore();
  const { hoveredBookKey, setHoveredBookKey } = useReaderStore();
  const { acquireVolumeKeyInterception, releaseVolumeKeyInterception } = useDeviceControlStore();
  const smoothScrollerRef = useRef<SmoothScroller | null>(null);
  const smoothScrollTargetRef = useRef<SmoothScrollTarget>({
    get position() {
      return viewRef.current?.renderer.containerPosition ?? 0;
    },
    set position(value: number) {
      const renderer = viewRef.current?.renderer;
      if (renderer) renderer.containerPosition = value;
    },
  });

  const handlePageFlip = async (
    msg: MessageEvent | CustomEvent | React.MouseEvent<HTMLDivElement, MouseEvent>,
  ) => {
    const viewState = getViewState(bookKey);
    const bookData = getBookData(bookKey);
    if (!viewState?.inited || !bookData) return;

    const dispatchReadingRulerMove = (side: PaginationSide) => {
      return eventDispatcher.dispatchSync('reading-ruler-move', {
        bookKey,
        direction: getReadingRulerMoveDirection(side, viewRef.current?.book.dir),
      });
    };

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
                return;
              }

              if (hoveredBookKey) {
                setHoveredBookKey(null);
                return;
              }

              const side: PaginationSide =
                screenX >= viewCenterX
                  ? viewSettings.fullscreenClickArea
                    ? 'down'
                    : viewSettings.swapClickArea
                      ? 'left'
                      : 'right'
                  : viewSettings.fullscreenClickArea
                    ? 'down'
                    : viewSettings.swapClickArea
                      ? 'right'
                      : 'left';

              if (viewSettings.readingRulerEnabled && dispatchReadingRulerMove(side)) {
                return;
              }

              viewPagination(viewRef.current, viewSettings, side);
            }
          }
        } else if (msg.data.type === 'iframe-wheel') {
          const { deltaY, deltaX, isMouseWheel } = msg.data;
          if (
            viewSettings.scrolled &&
            isMouseWheel &&
            !isPanningView(viewRef.current, viewSettings)
          ) {
            // Mouse wheels deliver one large quantised delta per notch which
            // Chromium would scroll without interpolation, producing the
            // jerky one-step-per-frame motion reported on Windows. The
            // iframe handler already preventDefault'd the native scroll —
            // here we replay the delta as a smooth animation instead.
            if (!smoothScrollerRef.current) {
              smoothScrollerRef.current = new SmoothScroller();
            }
            smoothScrollerRef.current.scrollBy(smoothScrollTargetRef.current, deltaY);
          } else if (!viewSettings.scrolled && !isPanningView(viewRef.current, viewSettings)) {
            // Paginated mode: wheel always flips a page (the iframe doesn't
            // scroll because the container has overflow:hidden).
            if (deltaY > 0) {
              viewPagination(viewRef.current, viewSettings, 'down');
            } else if (deltaY < 0) {
              viewPagination(viewRef.current, viewSettings, 'up');
            } else if (deltaX < 0) {
              viewPagination(viewRef.current, viewSettings, 'left');
            } else if (deltaX > 0) {
              viewPagination(viewRef.current, viewSettings, 'right');
            }
          }
          // Otherwise (scrolled mode + trackpad/high-resolution input) the
          // browser's native scroll already runs and is pixel-precise.
        } else if (msg.data.type === 'iframe-mouseup') {
          if (msg.data.button === 3) {
            viewRef.current?.history.back();
          } else if (msg.data.button === 4) {
            viewRef.current?.history.forward();
          }
        }
      }
    } else if (msg instanceof CustomEvent) {
      const viewSettings = getViewSettings(bookKey);
      if (msg.type === 'native-key-down' && viewSettings?.volumeKeysToFlip) {
        const { keyName } = msg.detail;
        setHoveredBookKey('');
        if (keyName === 'VolumeUp') {
          if (viewSettings.readingRulerEnabled && dispatchReadingRulerMove('up')) {
            return;
          }
          viewPagination(viewRef.current, viewSettings, 'up');
        } else if (keyName === 'VolumeDown') {
          if (viewSettings.readingRulerEnabled && dispatchReadingRulerMove('down')) {
            return;
          }
          viewPagination(viewRef.current, viewSettings, 'down');
        }
      }
    } else {
      if (msg.type === 'click') {
        const { clientX } = msg;
        const width = window.innerWidth;
        const leftThreshold = width * 0.5;
        const rightThreshold = width * 0.5;
        const viewSettings = getViewSettings(bookKey);
        if (!viewSettings?.disableClick) {
          if (clientX < leftThreshold) {
            viewPagination(viewRef.current, viewSettings, 'left');
          } else if (clientX > rightThreshold) {
            viewPagination(viewRef.current, viewSettings, 'right');
          }
        }
      }
    }
  };

  useEffect(() => {
    return () => {
      smoothScrollerRef.current?.cancel();
    };
  }, []);

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

  // Touch swipe page flip for fixed-layout books — registered as a touch interceptor
  // so it participates in the priority-based consumption chain.
  useTouchInterceptor(
    `swipe-flip-${bookKey}`,
    (bk, detail) => {
      if (bk !== bookKey || detail.phase !== 'end') return false;
      const bookData = getBookData(bookKey);
      const viewSettings = getViewSettings(bookKey);
      if (!bookData?.isFixedLayout || viewSettings?.scrolled) return false;
      if (isPanningView(viewRef.current, viewSettings)) return false;

      const { deltaX, deltaY, deltaT } = detail;
      const vx = Math.abs(deltaX / (deltaT || 1));
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 30 && vx > 0.2) {
        viewPagination(viewRef.current, viewSettings, deltaX > 0 ? 'left' : 'right');
        return true;
      }
      return false;
    },
    0,
  );

  return {
    handlePageFlip,
  };
};
