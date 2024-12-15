import React, { useEffect, useRef } from 'react';
import { BookDoc, getDirection } from '@/libs/document';
import { BookConfig, BookNote, BookSearchConfig, BookSearchResult } from '@/types/book';
import { useReaderStore } from '@/store/readerStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { useFoliateEvents } from '../hooks/useFoliateEvents';
import { getOSPlatform } from '@/utils/misc';
import { getStyles, mountAdditionalFonts } from '@/utils/style';
import { useTheme } from '@/hooks/useTheme';
import { ONE_COLUMN_MAX_INLINE_SIZE } from '@/services/constants';
import {
  handleKeydown,
  handleMousedown,
  handleMouseup,
  handleClick,
  handleWheel,
} from '../utils/iframeEventHandlers';
import { eventDispatcher } from '@/utils/event';

export interface FoliateView extends HTMLElement {
  open: (book: BookDoc) => Promise<void>;
  close: () => void;
  init: (options: { lastLocation: string }) => void;
  goTo: (href: string) => void;
  goToFraction: (fraction: number) => void;
  prev: (distance: number) => void;
  next: (distance: number) => void;
  goLeft: () => void;
  goRight: () => void;
  getCFI: (index: number, range: Range) => string;
  addAnnotation: (note: BookNote, remove?: boolean) => { index: number; label: string };
  search: (config: BookSearchConfig) => AsyncGenerator<BookSearchResult | string, void, void>;
  clearSearch: () => void;
  select: (target: string | number | { fraction: number }) => void;
  deselect: () => void;
  history: {
    canGoBack: boolean;
    canGoForward: boolean;
    back: () => void;
    forward: () => void;
    clear: () => void;
  };
  renderer: {
    scrolled?: boolean;
    viewSize: number;
    setAttribute: (name: string, value: string | number) => void;
    removeAttribute: (name: string) => void;
    next: () => Promise<void>;
    prev: () => Promise<void>;
    goTo?: (params: { index: number; anchor: number }) => void;
    setStyles?: (css: string) => void;
    addEventListener: (type: string, listener: EventListener) => void;
    removeEventListener: (type: string, listener: EventListener) => void;
  };
}

const wrappedFoliateView = (originalView: FoliateView): FoliateView => {
  const originalAddAnnotation = originalView.addAnnotation.bind(originalView);
  originalView.addAnnotation = (note: BookNote, remove = false) => {
    // transform BookNote to foliate annotation
    const annotation = {
      value: note.cfi,
      ...note,
    };
    return originalAddAnnotation(annotation, remove);
  };
  return originalView;
};

const FoliateViewer: React.FC<{
  bookKey: string;
  bookDoc: BookDoc;
  config: BookConfig;
}> = ({ bookKey, bookDoc, config }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const isViewCreated = useRef(false);
  const { getView, setView: setFoliateView, setProgress, getViewSettings } = useReaderStore();
  const { hoveredBookKey, setHoveredBookKey, setViewSettings } = useReaderStore();
  const { getParallels } = useParallelViewStore();
  const { themeCode } = useTheme();

  const shouldAutoHideScrollbar = ['macos', 'ios'].includes(getOSPlatform());

  const progressRelocateHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    // console.log('relocate:', detail);
    setProgress(bookKey, detail.cfi, detail.tocItem, detail.section, detail.location, detail.range);
  };

  const handleScrollbarAutoHide = (doc: Document) => {
    if (doc && doc.defaultView && doc.defaultView.frameElement) {
      const iframe = doc.defaultView.frameElement as HTMLIFrameElement;
      const container = iframe.parentElement?.parentElement;
      if (!container) return;

      let hideScrollbarTimeout: ReturnType<typeof setTimeout>;
      const showScrollbar = () => {
        container.style.overflow = 'auto';
        container.style.scrollbarWidth = 'thin';
      };

      const hideScrollbar = () => {
        container.style.overflow = 'hidden';
        container.style.scrollbarWidth = 'none';
        requestAnimationFrame(() => {
          container.style.overflow = 'auto';
        });
      };
      container.addEventListener('scroll', () => {
        showScrollbar();
        clearTimeout(hideScrollbarTimeout);
        hideScrollbarTimeout = setTimeout(hideScrollbar, 1000);
      });
      hideScrollbar();
    }
  };

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
      }
    }
  };

  const docRelocateHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail.reason !== 'scroll' && detail.reason !== 'page') return;
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
    <div
      className='foliate-viewer h-[100%] w-[100%]'
      onClick={(event) => handleTurnPage(event)}
      ref={containerRef}
    />
  );
};

export default FoliateViewer;
