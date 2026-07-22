import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { FoliateView } from '@/types/view';
import { useReaderStore } from '@/store/readerStore';
import { eventDispatcher } from '@/utils/event';
import { Autoscroller, AutoscrollAxis } from '../utils/autoscroller';
import { setAutoscrollArmed, setAutoscrollTracking } from '../utils/iframeEventHandlers';

export interface AutoscrollAnchor {
  left: number;
  top: number;
  axis: AutoscrollAxis;
}

// Middle-click autoscroll (#4951): desktop-only, scrolled mode. A middle-button
// press in the book iframe plants an anchor; pointer distance from it drives the
// scroll velocity (see Autoscroller). Movement is tracked in screen coordinates
// so iframe/window coordinate spaces and transforms don't matter; the returned
// anchor is in reading-container coordinates for the indicator overlay.
export const useMiddleClickAutoscroll = (
  bookKey: string,
  viewRef: React.RefObject<FoliateView | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
) => {
  const { appService } = useEnv();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);
  const [anchor, setAnchor] = useState<AutoscrollAnchor | null>(null);

  const armed = !!appService?.isDesktopApp && !!viewSettings?.scrolled;
  const armedRef = useRef(armed);
  armedRef.current = armed;

  // Undoes the per-session wiring (window listeners, cursors); set on start.
  const sessionCleanupRef = useRef<(() => void) | null>(null);
  // A left click that ends a sticky session must only end it, not also turn the
  // page; single clicks arrive well after the mousedown, hence a time window.
  const swallowClicksBeforeRef = useRef(0);

  const scrollerRef = useRef<Autoscroller | null>(null);
  if (!scrollerRef.current) {
    scrollerRef.current = new Autoscroller({
      scrollBy: (delta) => {
        const renderer = viewRef.current?.renderer;
        if (renderer) renderer.containerPosition += delta;
      },
      onStop: () => {
        setAnchor(null);
        setAutoscrollTracking(false);
        sessionCleanupRef.current?.();
        sessionCleanupRef.current = null;
      },
    });
  }

  const startSession = (windowX: number, windowY: number, screenX: number, screenY: number) => {
    const scroller = scrollerRef.current!;
    const renderer = viewRef.current?.renderer;
    const container = containerRef.current;
    if (!renderer?.scrolled || !container) return;
    // Vertical-writing books scroll along the horizontal axis in scrolled mode.
    const axis: AutoscrollAxis = renderer.scrollProp === 'scrollLeft' ? 'x' : 'y';
    scroller.start(screenX, screenY, axis);

    const cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';
    const docs = renderer.getContents().map(({ doc }) => doc);
    docs.forEach((doc) => (doc.documentElement.style.cursor = cursor));
    container.style.cursor = cursor;

    const onMousemove = (event: MouseEvent) => scroller.move(event.screenX, event.screenY);
    const onMousedown = () => scroller.stop();
    const onMouseup = (event: MouseEvent) => {
      if (event.button === 1) scroller.release();
    };
    const onWheel = () => scroller.stop();
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') scroller.stop();
    };
    const onBlur = () => scroller.stop();
    window.addEventListener('mousemove', onMousemove, true);
    window.addEventListener('mousedown', onMousedown, true);
    window.addEventListener('mouseup', onMouseup, true);
    window.addEventListener('wheel', onWheel, true);
    window.addEventListener('keydown', onKeydown, true);
    window.addEventListener('blur', onBlur);
    sessionCleanupRef.current = () => {
      docs.forEach((doc) => (doc.documentElement.style.cursor = ''));
      container.style.cursor = '';
      window.removeEventListener('mousemove', onMousemove, true);
      window.removeEventListener('mousedown', onMousedown, true);
      window.removeEventListener('mouseup', onMouseup, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('keydown', onKeydown, true);
      window.removeEventListener('blur', onBlur);
    };
    setAutoscrollTracking(true);

    const containerRect = container.getBoundingClientRect();
    setAnchor({ left: windowX - containerRect.left, top: windowY - containerRect.top, axis });
  };

  useEffect(() => {
    const scroller = scrollerRef.current!;
    const onMessage = (msg: MessageEvent) => {
      const data = msg.data;
      if (!data?.type) return;
      switch (data.type) {
        case 'iframe-mousedown':
          if (scroller.active) {
            // Any press ends the session; a left press would otherwise also
            // click through to a page turn, so swallow its click.
            if (data.button === 0) swallowClicksBeforeRef.current = Date.now() + 500;
            scroller.stop();
          } else if (data.bookKey === bookKey && data.button === 1 && armedRef.current) {
            startSession(
              data.windowX ?? data.clientX,
              data.windowY ?? data.clientY,
              data.screenX,
              data.screenY,
            );
          }
          break;
        case 'iframe-mouseup':
          if (data.button === 1) scroller.release();
          break;
        case 'iframe-mousemove':
          scroller.move(data.screenX, data.screenY);
          break;
        case 'iframe-wheel':
          scroller.stop();
          break;
        case 'iframe-keydown':
          if (data.key === 'Escape') scroller.stop();
          break;
      }
    };
    const onSingleClick = () => Date.now() < swallowClicksBeforeRef.current;
    window.addEventListener('message', onMessage);
    eventDispatcher.onSync('iframe-single-click', onSingleClick);
    return () => {
      window.removeEventListener('message', onMessage);
      eventDispatcher.offSync('iframe-single-click', onSingleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  useEffect(() => {
    setAutoscrollArmed(bookKey, armed);
    if (!armed) scrollerRef.current?.stop();
    return () => setAutoscrollArmed(bookKey, false);
  }, [bookKey, armed]);

  useEffect(() => {
    return () => scrollerRef.current?.stop();
  }, []);

  return anchor;
};
