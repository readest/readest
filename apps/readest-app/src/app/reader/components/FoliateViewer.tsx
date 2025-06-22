import React, { useEffect, useRef, useState } from 'react';
import { BookDoc, getDirection } from '@/libs/document';
import { BookConfig } from '@/types/book';
import { FoliateView, wrappedFoliateView } from '@/types/view';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { useMouseEvent, useTouchEvent } from '../hooks/useIframeEvents';
import { usePagination } from '../hooks/usePagination';
import { useFoliateEvents } from '../hooks/useFoliateEvents';
import { useProgressSync } from '../hooks/useProgressSync';
import { useProgressAutoSave } from '../hooks/useProgressAutoSave';
import { getStyles, transformStylesheet } from '@/utils/style';
import { mountAdditionalFonts } from '@/utils/font';
import { getBookDirFromLanguage, getBookDirFromWritingMode } from '@/utils/book';
import { useUICSS } from '@/hooks/useUICSS';
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
import { getMaxInlineSize } from '@/utils/config';
import { getDirFromUILanguage } from '@/utils/rtl';
import { isCJKLang } from '@/utils/lang';
import { isTauriAppPlatform } from '@/services/environment';
import { transformContent } from '@/services/transformService';
import { lockScreenOrientation } from '@/utils/bridge';
import { useTextTranslation } from '../hooks/useTextTranslation';
import { manageSyntaxHighlighting } from '@/utils/highlightjs';
import { getViewInsets } from '@/utils/insets';

declare global {
  interface Window {
    eval(script: string): void;
  }
}

const FoliateViewer: React.FC<{
  bookKey: string;
  bookDoc: BookDoc;
  config: BookConfig;
  contentInsets: Insets;
}> = ({ bookKey, bookDoc, config, contentInsets: insets }) => {
  const { getView, setView: setFoliateView, setProgress } = useReaderStore();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const { getParallels } = useParallelViewStore();
  const { getBookData } = useBookDataStore();
  const { appService } = useEnv();
  const { themeCode, isDarkMode } = useThemeStore();
  const viewSettings = getViewSettings(bookKey);

  const viewRef = useRef<FoliateView | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isViewCreated = useRef(false);
  const [toastMessage, setToastMessage] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setToastMessage(''), 2000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  useUICSS(bookKey);
  useProgressSync(bookKey);
  useProgressAutoSave(bookKey);
  useTextTranslation(bookKey, viewRef.current);

  const progressRelocateHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    setProgress(
      bookKey,
      detail.cfi,
      detail.tocItem,
      detail.section,
      detail.location,
      detail.time,
      detail.range,
    );
  };

  const getDocTransformHandler = ({ width, height }: { width: number; height: number }) => {
    return (event: Event) => {
      const { detail } = event as CustomEvent;
      detail.data = Promise.resolve(detail.data)
        .then((data) => {
          const viewSettings = getViewSettings(bookKey);
          if (viewSettings && detail.type === 'text/css')
            return transformStylesheet(width, height, data);
          if (viewSettings && detail.type === 'application/xhtml+xml') {
            const ctx = {
              bookKey,
              viewSettings,
              content: data,
              transformers: ['punctuation', 'footnote'],
            };
            return Promise.resolve(transformContent(ctx));
          }
          return data;
        })
        .catch((e) => {
          console.error(new Error(`Failed to load ${detail.name}`, { cause: e }));
          return '';
        });
    };
  };

  const docLoadHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    console.log('doc index loaded:', detail.index);
    if (detail.doc) {
      const writingDir = viewRef.current?.renderer.setStyles && getDirection(detail.doc);
      const viewSettings = getViewSettings(bookKey)!;
      const bookData = getBookData(bookKey)!;
      viewSettings.vertical =
        writingDir?.vertical || viewSettings.writingMode.includes('vertical') || false;
      viewSettings.rtl =
        writingDir?.rtl ||
        getDirFromUILanguage() === 'rtl' ||
        viewSettings.writingMode.includes('rl') ||
        false;
      setViewSettings(bookKey, { ...viewSettings });

      mountAdditionalFonts(detail.doc, isCJKLang(bookData.book?.primaryLanguage));

      // Inline scripts in tauri platforms are not executed by default
      if (viewSettings.allowScript && isTauriAppPlatform()) {
        evalInlineScripts(detail.doc);
      }

      // only call on load if we have highlighting turned on.
      if (viewSettings.codeHighlighting) {
        manageSyntaxHighlighting(detail.doc, viewSettings);
      }

      if (!detail.doc.isEventListenersAdded) {
        // listened events in iframes are posted to the main window
        // and then used by useMouseEvent and useTouchEvent
        // and more gesture events can be detected in the iframeEventHandlers
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

  const evalInlineScripts = (doc: Document) => {
    if (doc.defaultView && doc.defaultView.frameElement) {
      const iframe = doc.defaultView.frameElement as HTMLIFrameElement;
      const scripts = doc.querySelectorAll('script:not([src])');
      scripts.forEach((script, index) => {
        const scriptContent = script.textContent || script.innerHTML;
        try {
          console.warn('Evaluating inline scripts in iframe');
          iframe.contentWindow?.eval(scriptContent);
        } catch (error) {
          console.error(`Error executing iframe script ${index + 1}:`, error);
        }
      });
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

  const { handlePageFlip, handleContinuousScroll } = usePagination(bookKey, viewRef, containerRef);
  const mouseHandlers = useMouseEvent(bookKey, handlePageFlip, handleContinuousScroll);
  const touchHandlers = useTouchEvent(bookKey, handleContinuousScroll);

  useFoliateEvents(viewRef.current, {
    onLoad: docLoadHandler,
    onRelocate: progressRelocateHandler,
    onRendererRelocate: docRelocateHandler,
  });

  useEffect(() => {
    if (isViewCreated.current) return;
    isViewCreated.current = true;

    const openBook = async () => {
      console.log('Opening book', bookKey);
      await import('foliate-js/view.js');
      const view = wrappedFoliateView(document.createElement('foliate-view') as FoliateView);
      view.id = `foliate-view-${bookKey}`;
      document.body.append(view);
      containerRef.current?.appendChild(view);

      const viewSettings = getViewSettings(bookKey)!;
      const writingMode = viewSettings.writingMode;
      if (writingMode) {
        const settingsDir = getBookDirFromWritingMode(writingMode);
        const languageDir = getBookDirFromLanguage(bookDoc.metadata.language);
        if (settingsDir !== 'auto') {
          bookDoc.dir = settingsDir;
        } else if (languageDir !== 'auto') {
          bookDoc.dir = languageDir;
        }
      }

      await view.open(bookDoc);
      // make sure we can listen renderer events after opening book
      viewRef.current = view;
      setFoliateView(bookKey, view);

      const { book } = view;

      book.transformTarget?.addEventListener('load', (event: Event) => {
        const { detail } = event as CustomEvent;
        if (detail.isScript) {
          detail.allowScript = viewSettings.allowScript ?? false;
        }
      });
      const viewWidth = appService?.isMobile ? screen.width : window.innerWidth;
      const viewHeight = appService?.isMobile ? screen.height : window.innerHeight;
      const width = viewWidth - insets.left - insets.right;
      const height = viewHeight - insets.top - insets.bottom;
      book.transformTarget?.addEventListener('data', getDocTransformHandler({ width, height }));
      view.renderer.setStyles?.(getStyles(viewSettings));

      const animated = viewSettings.animated!;
      const maxColumnCount = viewSettings.maxColumnCount!;
      const maxInlineSize = getMaxInlineSize(viewSettings);
      const maxBlockSize = viewSettings.maxBlockSize!;
      const screenOrientation = viewSettings.screenOrientation!;
      if (appService?.isMobileApp) {
        await lockScreenOrientation({ orientation: screenOrientation });
      }
      if (animated) {
        view.renderer.setAttribute('animated', '');
      } else {
        view.renderer.removeAttribute('animated');
      }
      view.renderer.setAttribute('max-column-count', maxColumnCount);
      view.renderer.setAttribute('max-inline-size', `${maxInlineSize}px`);
      view.renderer.setAttribute('max-block-size', `${maxBlockSize}px`);
      applyMarginAndGap();

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

  const applyMarginAndGap = () => {
    const viewSettings = getViewSettings(bookKey)!;
    const viewInsets = getViewInsets(viewSettings);
    const showDoubleBorder = viewSettings.vertical && viewSettings.doubleBorder;
    const showDoubleBorderHeader = showDoubleBorder && viewSettings.showHeader;
    const showDoubleBorderFooter = showDoubleBorder && viewSettings.showFooter;
    const showTopHeader = viewSettings.showHeader && !viewSettings.vertical;
    const showBottomFooter = viewSettings.showFooter && !viewSettings.vertical;
    const moreTopInset = showTopHeader ? Math.max(0, 44 - insets.top) : 0;
    const moreBottomInset = showBottomFooter ? Math.max(0, 44 - insets.bottom) : 0;
    const moreRightInset = showDoubleBorderHeader ? 32 : 0;
    const moreLeftInset = showDoubleBorderFooter ? 32 : 0;
    const topMargin = (showTopHeader ? insets.top : viewInsets.top) + moreTopInset;
    const rightMargin = insets.right + moreRightInset;
    const bottomMargin = (showBottomFooter ? insets.bottom : viewInsets.bottom) + moreBottomInset;
    const leftMargin = insets.left + moreLeftInset;

    viewRef.current?.renderer.setAttribute('margin-top', `${topMargin}px`);
    viewRef.current?.renderer.setAttribute('margin-right', `${rightMargin}px`);
    viewRef.current?.renderer.setAttribute('margin-bottom', `${bottomMargin}px`);
    viewRef.current?.renderer.setAttribute('margin-left', `${leftMargin}px`);
    viewRef.current?.renderer.setAttribute('gap', `${viewSettings.gapPercent}%`);
    if (viewSettings.scrolled) {
      viewRef.current?.renderer.setAttribute('flow', 'scrolled');
    }
  };

  useEffect(() => {
    if (viewRef.current && viewRef.current.renderer) {
      const viewSettings = getViewSettings(bookKey)!;
      viewRef.current.renderer.setStyles?.(getStyles(viewSettings));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeCode, isDarkMode]);

  useEffect(() => {
    if (viewRef.current && viewRef.current.renderer && viewSettings) {
      applyMarginAndGap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    insets.top,
    insets.right,
    insets.bottom,
    insets.left,
    viewSettings?.doubleBorder,
    viewSettings?.showHeader,
    viewSettings?.showFooter,
  ]);

  return (
    <div
      ref={containerRef}
      className='foliate-viewer h-[100%] w-[100%]'
      {...mouseHandlers}
      {...touchHandlers}
    />
  );
};

export default FoliateViewer;
