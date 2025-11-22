import Spinner from '@/components/Spinner';
import { useEnv } from '@/context/EnvContext';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { useEinkMode } from '@/hooks/useEinkMode';
import { useTranslation } from '@/hooks/useTranslation';
import { useUICSS } from '@/hooks/useUICSS';
import { BookDoc, getDirection } from '@/libs/document';
import { isTauriAppPlatform } from '@/services/environment';
import { TransformContext } from '@/services/transformers/types';
import { transformContent } from '@/services/transformService';
import { useBookDataStore } from '@/store/bookDataStore';
import { useCustomFontStore } from '@/store/customFontStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { mountAdditionalFonts, mountCustomFont } from '@/styles/fonts';
import { BookConfig } from '@/types/book';
import { Insets } from '@/types/misc';
import { FoliateView, wrappedFoliateView } from '@/types/view';
import { removeTabIndex } from '@/utils/a11y';
import { getBookDirFromLanguage, getBookDirFromWritingMode } from '@/utils/book';
import { lockScreenOrientation } from '@/utils/bridge';
import { getMaxInlineSize } from '@/utils/config';
import { manageSyntaxHighlighting } from '@/utils/highlightjs';
import { getViewInsets } from '@/utils/insets';
import { isCJKLang } from '@/utils/lang';
import { getDirFromUILanguage } from '@/utils/rtl';
import {
  applyFixedlayoutStyles,
  applyImageStyle,
  applyScrollModeClass,
  applyTableStyle,
  applyThemeModeClass,
  applyTranslationStyle,
  getStyles,
  keepTextAlignment,
  transformStylesheet,
} from '@/utils/style';
import React, { useEffect, useRef, useState } from 'react';
import { useBookCoverAutoSave } from '../hooks/useAutoSaveBookCover';
import { useFoliateEvents } from '../hooks/useFoliateEvents';
import { useMouseEvent, useTouchEvent } from '../hooks/useIframeEvents';
import { useKOSync } from '../hooks/useKOSync';
import { usePagination } from '../hooks/usePagination';
import { useProgressAutoSave } from '../hooks/useProgressAutoSave';
import { useProgressSync } from '../hooks/useProgressSync';
import { useTextTranslation } from '../hooks/useTextTranslation';
import {
  handleClick,
  handleKeydown,
  handleMousedown,
  handleMouseup,
  handleTouchEnd,
  handleTouchMove,
  handleTouchStart,
  handleWheel,
} from '../utils/iframeEventHandlers';
import ImageViewerModal from './ImageViewerModal';
import KOSyncConflictResolver from './KOSyncResolver';

declare global {
  interface Window {
    eval(script: string): void;
  }
}

const FoliateViewer: React.FC<{
  bookKey: string;
  bookDoc: BookDoc;
  config: BookConfig;
  gridInsets: Insets;
  contentInsets: Insets;
}> = ({ bookKey, bookDoc, config, gridInsets, contentInsets: insets }) => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const { themeCode, isDarkMode } = useThemeStore();
  const { settings } = useSettingsStore();
  const { loadCustomFonts, getLoadedFonts } = useCustomFontStore();
  const { getView, setView: setFoliateView, setViewInited, setProgress } = useReaderStore();
  const { getViewState, getViewSettings, setViewSettings } = useReaderStore();
  const { getParallels } = useParallelViewStore();
  const { getBookData } = useBookDataStore();
  const { applyBackgroundTexture } = useBackgroundTexture();
  const { applyEinkMode } = useEinkMode();
  const viewState = getViewState(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | undefined>(undefined);
  const [savedLocation, setSavedLocation] = useState<any>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isViewCreated = useRef(false);
  const doubleClickDisabled = useRef(!!viewSettings?.disableDoubleClick);
  const [toastMessage, setToastMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const docLoaded = useRef(false);

  useAutoFocus<HTMLDivElement>({ ref: containerRef });

  useEffect(() => {
    const timer = setTimeout(() => setToastMessage(''), 2000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  useUICSS(bookKey);
  useProgressSync(bookKey);
  useProgressAutoSave(bookKey);
  useBookCoverAutoSave(bookKey);
  const { syncState, conflictDetails, resolveWithLocal, resolveWithRemote } = useKOSync(bookKey);
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

  const makeImageOverlayScript = (bookKey: string) => {
    return `
  (function(){
    try {
      const BOOK_KEY = ${JSON.stringify(bookKey)};
      function addButtons() {
        try {
          document.querySelectorAll('img').forEach(img => {
            if (img.dataset.readestEnlarger) return;
            img.dataset.readestEnlarger = '1';
            const wrapper = document.createElement('span');
            wrapper.style.position = 'relative';
            wrapper.style.display = 'inline-block';
            img.parentNode && img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('aria-label','Enlarge image');
            btn.innerHTML = '⛶';
            btn.title = 'Click to enlarge image';
            Object.assign(btn.style, {
              position: 'absolute',
              top: '8px',
              right: '8px',
              zIndex: '99999',
              background: 'rgba(0,0,0,0.7)',
              color: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: '0.8',
              transition: 'opacity 0.2s'
            });
            btn.addEventListener('mouseenter', function() {
              this.style.opacity = '1';
            });
            btn.addEventListener('mouseleave', function() {
              this.style.opacity = '0.8';
            });
            btn.addEventListener('click', function(e){
              e.stopPropagation();
              e.preventDefault();
              try {
                window.parent.postMessage({ type: 'iframe-image-click', bookKey: BOOK_KEY, src: img.currentSrc || img.src }, '*');
              } catch (err) {
                console.warn('[readest-image-inject] postMessage failed', err);
              }
            }, false);
            wrapper.appendChild(btn);
          });
        } catch (err) {
          console.warn('[readest-image-inject] addButtons', err);
        }
      }
      addButtons();
      const obs = new MutationObserver(addButtons);
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch(e){
      console.warn('[readest-image-inject] outer', e);
    }
  })();
  `;
  };

  const getDocTransformHandler = ({ width, height }: { width: number; height: number }) => {
    return (event: Event) => {
      const { detail } = event as CustomEvent;
      detail.data = Promise.resolve(detail.data)
        .then((data) => {
          const viewSettings = getViewSettings(bookKey);
          const bookData = getBookData(bookKey);
          if (viewSettings && detail.type === 'text/css')
            return transformStylesheet(width, height, data);
          if (viewSettings && bookData && detail.type === 'application/xhtml+xml') {
            const ctx: TransformContext = {
              bookKey,
              viewSettings,
              width,
              height,
              primaryLanguage: bookData.book?.primaryLanguage,
              content: data,
              transformers: [
                'style',
                'punctuation',
                'footnote',
                'whitespace',
                'language',
                'sanitizer',
              ],
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
    setLoading(false);
    docLoaded.current = true;
    const detail = (event as CustomEvent).detail;
    console.log('doc index loaded:', detail.index);

    if (detail.doc) {
      const writingDir = viewRef.current?.renderer.setStyles && getDirection(detail.doc);
      const viewSettings = getViewSettings(bookKey)!;
      const bookData = getBookData(bookKey)!;

      const newVertical =
        writingDir?.vertical || viewSettings.writingMode.includes('vertical') || false;
      const newRtl =
        writingDir?.rtl ||
        getDirFromUILanguage() === 'rtl' ||
        viewSettings.writingMode.includes('rl') ||
        false;
      if (viewSettings.vertical !== newVertical || viewSettings.rtl !== newRtl) {
        viewSettings.vertical = newVertical;
        viewSettings.rtl = newRtl;
        setViewSettings(bookKey, { ...viewSettings });
      }

      mountAdditionalFonts(detail.doc, isCJKLang(bookData.book?.primaryLanguage));

      getLoadedFonts().forEach((font) => {
        mountCustomFont(detail.doc, font);
      });

      if (bookDoc.rendition?.layout === 'pre-paginated') {
        applyFixedlayoutStyles(detail.doc, viewSettings);
      }

      applyImageStyle(detail.doc);
      applyTableStyle(detail.doc);
      applyThemeModeClass(detail.doc, isDarkMode);
      applyScrollModeClass(detail.doc, viewSettings.scrolled || false);
      keepTextAlignment(detail.doc);
      removeTabIndex(detail.doc);

      // Inline scripts in tauri platforms are not executed by default
      if (viewSettings.allowScript && isTauriAppPlatform()) {
        evalInlineScripts(detail.doc);
      }

      // only call on load if we have highlighting turned on.
      if (viewSettings.codeHighlighting) {
        manageSyntaxHighlighting(detail.doc, viewSettings);
      }

      setTimeout(() => {
        const booknotes = config.booknotes || [];
        booknotes
          .filter((item) => !item.deletedAt && item.type === 'annotation' && item.style)
          .forEach((annotation) => viewRef.current?.addAnnotation(annotation));
      }, 100);

      try {
        const injectionCode = makeImageOverlayScript(bookKey);
        const docWindow = detail.doc?.defaultView;
        if (docWindow && docWindow.frameElement) {
          try {
            // eval inside iframe context (same-origin EPUB content should allow this)
            (docWindow as any).eval?.(injectionCode);
            console.log('[readest-image-inject] injected via iframe eval into', docWindow.location?.href);
          } catch (evalErr) {
            console.warn('[readest-image-inject] iframe eval failed, falling back to appending script', evalErr);
            const script = detail.doc.createElement('script');
            script.type = 'text/javascript';
            script.textContent = injectionCode;
            const parentEl = detail.doc.head || detail.doc.documentElement || detail.doc.body;
            if (parentEl) parentEl.appendChild(script);
            console.log('[readest-image-inject] injected via appended <script>');
          }
        } else {
          // Not in an iframe: append script directly to the document
          const script = detail.doc.createElement('script');
          script.type = 'text/javascript';
          script.textContent = injectionCode;
          const parentEl = detail.doc.head || detail.doc.documentElement || detail.doc.body;
          if (parentEl) parentEl.appendChild(script);
          console.log('[readest-image-inject] injected via appended <script> (no iframe)');
        }
      } catch (injectionErr) {
        console.warn('[readest-image-inject] injection error', injectionErr);
      }

      if (!detail.doc.isEventListenersAdded) {
        // listened events in iframes are posted to the main window
        // and then used by useMouseEvent and useTouchEvent
        // and more gesture events can be detected in the iframeEventHandlers
        detail.doc.isEventListenersAdded = true;
        detail.doc.addEventListener('keydown', handleKeydown.bind(null, bookKey));
        detail.doc.addEventListener('mousedown', handleMousedown.bind(null, bookKey));
        detail.doc.addEventListener('mouseup', handleMouseup.bind(null, bookKey));
        detail.doc.addEventListener('click', handleClick.bind(null, bookKey, doubleClickDisabled));
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
  const touchHandlers = useTouchEvent(bookKey, handlePageFlip, handleContinuousScroll);

  useFoliateEvents(viewRef.current, {
    onLoad: docLoadHandler,
    onRelocate: progressRelocateHandler,
    onRendererRelocate: docRelocateHandler,
  });

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data || {};
      if (data && data.type === 'iframe-image-click' && data.bookKey === bookKey) {
        try {
          const renderer = viewRef.current?.renderer;
          let save: any = null;
          if (renderer && (renderer as any).position) {
            save = { index: (renderer as any).position.index, fraction: (renderer as any).position.anchor };
          }
          // fallback: capture CFI from view if available: (viewRef.current as any)?.getCFI(...)
          setSavedLocation(save);
        } catch (err) {
          console.warn('[readest-image-inject] capture location failed', err);
        }

        setImageSrc(data.src);
        setImageModalOpen(true);
      }
    };

    window.addEventListener('message', onMessage, false);
    return () => window.removeEventListener('message', onMessage, false);
  }, [bookKey]);

  useEffect(() => {
    if (isViewCreated.current) return;
    isViewCreated.current = true;

    setTimeout(() => setLoading(true), 200);

    const openBook = async () => {
      console.log('Opening book', bookKey);
      await import('foliate-js/view.js');
      const view = wrappedFoliateView(document.createElement('foliate-view') as FoliateView);
      view.id = `foliate-view-${bookKey}`;
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

      if (bookDoc.rendition?.layout === 'pre-paginated' && bookDoc.sections) {
        bookDoc.rendition.spread = viewSettings.spreadMode;
        const coverSide = bookDoc.dir === 'rtl' ? 'right' : 'left';
        bookDoc.sections[0]!.pageSpread = viewSettings.keepCoverSpread ? '' : coverSide;
      }

      await view.open(bookDoc);
      // make sure we can listen renderer events after opening book
      viewRef.current = view;
      setFoliateView(bookKey, view);

      const { book } = view;

      const viewWidth = appService?.isMobile ? screen.width : window.innerWidth;
      const viewHeight = appService?.isMobile ? screen.height : window.innerHeight;
      const width = viewWidth - insets.left - insets.right;
      const height = viewHeight - insets.top - insets.bottom;
      book.transformTarget?.addEventListener('data', getDocTransformHandler({ width, height }));
      view.renderer.setStyles?.(getStyles(viewSettings));
      applyTranslationStyle(viewSettings);

      doubleClickDisabled.current = viewSettings.disableDoubleClick!;
      const animated = viewSettings.animated!;
      const eink = viewSettings.isEink!;
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
      if (appService?.isAndroidApp) {
        if (eink) {
          view.renderer.setAttribute('eink', '');
        } else {
          view.renderer.removeAttribute('eink');
        }
        applyEinkMode(eink);
      }
      if (bookDoc?.rendition?.layout === 'pre-paginated') {
        view.renderer.setAttribute('zoom', viewSettings.zoomMode);
        view.renderer.setAttribute('spread', viewSettings.spreadMode);
        view.renderer.setAttribute('scale-factor', viewSettings.zoomLevel);
      } else {
        view.renderer.setAttribute('max-column-count', maxColumnCount);
        view.renderer.setAttribute('max-inline-size', `${maxInlineSize}px`);
        view.renderer.setAttribute('max-block-size', `${maxBlockSize}px`);
      }
      applyMarginAndGap();

      const lastLocation = config.location;
      if (lastLocation) {
        await view.init({ lastLocation });
      } else {
        await view.goToFraction(0);
      }
      setViewInited(bookKey, true);
    };

    openBook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyMarginAndGap = () => {
    const viewSettings = getViewSettings(bookKey)!;
    const viewState = getViewState(bookKey);
    const viewInsets = getViewInsets(viewSettings);
    const showDoubleBorder = viewSettings.vertical && viewSettings.doubleBorder;
    const showDoubleBorderHeader = showDoubleBorder && viewSettings.showHeader;
    const showDoubleBorderFooter = showDoubleBorder && viewSettings.showFooter;
    const showTopHeader = viewSettings.showHeader && !viewSettings.vertical;
    const showBottomFooter = viewSettings.showFooter && !viewSettings.vertical;
    const moreTopInset = showTopHeader ? Math.max(0, 44 - insets.top) : 0;
    const ttsBarHeight =
      viewState?.ttsEnabled && viewSettings.showTTSBar ? 52 + gridInsets.bottom * 0.33 : 0;
    const moreBottomInset = showBottomFooter
      ? Math.max(0, Math.max(ttsBarHeight, 44) - insets.bottom)
      : Math.max(0, ttsBarHeight);
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
      const docs = viewRef.current.renderer.getContents();
      docs.forEach(({ doc }) => {
        if (bookDoc.rendition?.layout === 'pre-paginated') {
          applyFixedlayoutStyles(doc, viewSettings);
        }
        applyThemeModeClass(doc, isDarkMode);
        applyScrollModeClass(doc, viewSettings.scrolled || false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    themeCode,
    isDarkMode,
    viewSettings?.scrolled,
    viewSettings?.overrideColor,
    viewSettings?.invertImgColorInDark,
  ]);

  useEffect(() => {
    const mountCustomFonts = async () => {
      await loadCustomFonts(envConfig);
      getLoadedFonts().forEach((font) => {
        mountCustomFont(document, font);
        const docs = viewRef.current?.renderer.getContents();
        docs?.forEach(({ doc }) => mountCustomFont(doc, font));
      });
    };
    if (settings.customFonts) {
      mountCustomFonts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.customFonts, envConfig]);

  useEffect(() => {
    if (!viewSettings) return;
    applyBackgroundTexture(envConfig, viewSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewSettings?.backgroundTextureId,
    viewSettings?.backgroundOpacity,
    viewSettings?.backgroundSize,
    applyBackgroundTexture,
  ]);

  useEffect(() => {
    if (viewRef.current && viewRef.current.renderer) {
      doubleClickDisabled.current = !!viewSettings?.disableDoubleClick;
    }
  }, [viewSettings?.disableDoubleClick]);

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
    viewSettings?.showTTSBar,
    viewState?.ttsEnabled,
  ]);

  return (
    <>
      <div
        ref={containerRef}
        tabIndex={-1}
        role='document'
        aria-label={_('Book Content')}
        className='foliate-viewer h-[100%] w-[100%] focus:outline-none'
        {...mouseHandlers}
        {...touchHandlers}
      />
      {!docLoaded.current && loading && <Spinner loading={true} />}
      {syncState === 'conflict' && conflictDetails && (
        <KOSyncConflictResolver
          details={conflictDetails}
          onResolveWithLocal={resolveWithLocal}
          onResolveWithRemote={resolveWithRemote}
          onClose={resolveWithLocal}
        />
      )}
      
      <ImageViewerModal
        key={imageSrc}
        open={imageModalOpen}
        src={imageSrc}
        alt={''}
        onClose={() => {
          setImageModalOpen(false);
          // Restore the saved location when closing the modal
          if (savedLocation) {
            try {
              if (savedLocation.index != null && savedLocation.fraction != null) {
                viewRef.current?.renderer?.goTo?.({ 
                  index: savedLocation.index, 
                  anchor: savedLocation.fraction 
                });
              } else if ((viewRef.current as any)?.goTo && savedLocation.cfi) {
                (viewRef.current as any).goTo(savedLocation.cfi);
              }
            } catch (e) {
              console.warn('[readest-image-inject] restore failed', e);
            } finally {
              setSavedLocation(null);
            }
          }
        }}
      />
    </>
  );
};

export default FoliateViewer;