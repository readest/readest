import React, { useEffect, useRef, useState } from 'react';
import { BookDoc, getDirection } from '@/libs/document';
import { BookConfig } from '@/types/book';
import { FoliateView, wrappedFoliateView } from '@/types/view';
import { useReaderStore } from '@/store/readerStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { useClickEvent, useTouchEvent } from '../hooks/useIframeEvents';
import { useFoliateEvents } from '../hooks/useFoliateEvents';
import { useProgressSync } from '../hooks/useProgressSync';
import { useProgressAutoSave } from '../hooks/useProgressAutoSave';
import { useAutoHideScrollbar } from '../hooks/useAutoHideScrollbar';
import { getStyles, mountAdditionalFonts } from '@/utils/style';
import { getBookDirFromWritingMode } from '@/utils/book';
import { useTheme } from '@/hooks/useTheme';
import { ONE_COLUMN_MAX_INLINE_SIZE } from '@/services/constants';
import {
  handleKeydown,
  handleMousedown,
  handleMouseup,
  handleClick,
  handleWheel,
  handleTouchStart,
  handleTouchMove,
  handleTouchEnd,
} from '../utils/iframeEventHandlers';

const FoliateViewer: React.FC<{
  bookKey: string;
  bookDoc: BookDoc;
  config: BookConfig;
}> = ({ bookKey, bookDoc, config }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const isViewCreated = useRef(false);
  const { getView, setView: setFoliateView, setProgress } = useReaderStore();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const { getParallels } = useParallelViewStore();
  const { themeCode } = useTheme();

  const [toastMessage, setToastMessage] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setToastMessage(''), 2000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  useProgressSync(bookKey);
  useProgressAutoSave(bookKey);

  const progressRelocateHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    setProgress(bookKey, detail.cfi, detail.tocItem, detail.section, detail.location, detail.range);
  };

  const { shouldAutoHideScrollbar, handleScrollbarAutoHide } = useAutoHideScrollbar();
  const docLoadHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    console.log('doc loaded:', detail);
    if (detail.doc) {
      const writingDir = viewRef.current?.renderer.setStyles && getDirection(detail.doc);
      const viewSettings = getViewSettings(bookKey)!;
      viewSettings.vertical = writingDir?.vertical || false;
      setViewSettings(bookKey, viewSettings);
      if (viewSettings.scrolled && shouldAutoHideScrollbar) {
        handleScrollbarAutoHide(detail.doc);
      }

      mountAdditionalFonts(detail.doc);

      if (!detail.doc.isEventListenersAdded) {
        detail.doc.isEventListenersAdded = true;
        detail.doc.addEventListener('keydown', handleKeydown.bind(null, bookKey));
        detail.doc.addEventListener('mousedown', handleMousedown.bind(null, bookKey));
        detail.doc.addEventListener('mouseup', handleMouseup.bind(null, bookKey));
        detail.doc.addEventListener('click', handleClick.bind(null, bookKey));
        detail.doc.addEventListener('wheel', handleWheel.bind(null, bookKey));
        detail.doc.addEventListener('touchstart', handleTouchStart.bind(null, bookKey));
        detail.doc.addEventListener('touchmove', handleTouchMove.bind(null, bookKey));
        detail.doc.addEventListener('touchend', handleTouchEnd.bind(null, bookKey));
      }
    }
  };

  const docRelocateHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail.reason !== 'scroll' && detail.reason !== 'page') return;

    if (detail.reason === 'scroll') {
      const renderer = viewRef.current?.renderer;
      if (renderer) {
        if (renderer.start <= 0) {
          viewRef.current?.prev(1);
          // sometimes viewSize has subpixel value that the end never reaches
        } else if (renderer.end + 1 >= renderer.viewSize) {
          viewRef.current?.next(1);
        }
      }
    }
    const parallelViews = getParallels(bookKey);
    if (parallelViews && parallelViews.size > 0) {
      parallelViews.forEach((key) => {
        if (key !== bookKey) {
          const target = getView(key)?.renderer;
          if (target) {
            target.goTo?.({ index: detail.index, anchor: detail.fraction });
          }
        }
      });
    }
  };

  useTouchEvent(bookKey, viewRef);
  const { handleTurnPage } = useClickEvent(bookKey, viewRef, containerRef);

  useFoliateEvents(viewRef.current, {
    onLoad: docLoadHandler,
    onRelocate: progressRelocateHandler,
    onRendererRelocate: docRelocateHandler,
  });

  useEffect(() => {
    if (viewRef.current && viewRef.current.renderer) {
      const viewSettings = getViewSettings(bookKey)!;
      viewRef.current.renderer.setStyles?.(getStyles(viewSettings, themeCode));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeCode]);

  useEffect(() => {
    if (isViewCreated.current) return;
    isViewCreated.current = true;

    const openBook = async () => {
      console.log('Opening book', bookKey);
      await import('foliate-js/view.js');
      const view = wrappedFoliateView(document.createElement('foliate-view') as FoliateView);
      document.body.append(view);
      containerRef.current?.appendChild(view);

      await view.open(bookDoc);
      // make sure we can listen renderer events after opening book
      viewRef.current = view;
      setFoliateView(bookKey, view);

      const viewSettings = getViewSettings(bookKey)!;
      view.renderer.setStyles?.(getStyles(viewSettings, themeCode));

      const writingMode = viewSettings.writingMode;
      if (writingMode) {
        view.book.dir = getBookDirFromWritingMode(writingMode);
      }

      const isScrolled = viewSettings.scrolled!;
      const marginPx = viewSettings.marginPx!;
      const gapPercent = viewSettings.gapPercent!;
      const animated = viewSettings.animated!;
      const maxColumnCount = viewSettings.maxColumnCount!;
      const maxInlineSize =
        maxColumnCount === 1 || isScrolled
          ? ONE_COLUMN_MAX_INLINE_SIZE
          : viewSettings.maxInlineSize!;
      const maxBlockSize = viewSettings.maxBlockSize!;
      if (animated) {
        view.renderer.setAttribute('animated', '');
      } else {
        view.renderer.removeAttribute('animated');
      }
      view.renderer.setAttribute('flow', isScrolled ? 'scrolled' : 'paginated');
      view.renderer.setAttribute('margin', `${marginPx}px`);
      view.renderer.setAttribute('gap', `${gapPercent}%`);
      view.renderer.setAttribute('max-column-count', maxColumnCount);
      view.renderer.setAttribute('max-inline-size', `${maxInlineSize}px`);
      view.renderer.setAttribute('max-block-size', `${maxBlockSize}px`);

      const lastLocation = config.location;
      if (lastLocation) {
        await view.init({ lastLocation });
      } else {
        await view.goToFraction(0);
      }
    };

    openBook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div
        className='foliate-viewer h-[100%] w-[100%]'
        onClick={(event) => handleTurnPage(event)}
        ref={containerRef}
      />
    </>
  );
};

export default FoliateViewer;
