import React, { useEffect, useRef, useState, useCallback } from 'react';
import { convertBlobUrlToDataUrl, BookDoc, getDirection } from '@/libs/document';
import { BookConfig, PageInfo } from '@/types/book';
import { FoliateView, wrappedFoliateView } from '@/types/view';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomFontStore } from '@/store/customFontStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { useMouseEvent, useTouchEvent, useLongPressEvent } from '../hooks/useIframeEvents';
import { usePagination } from '../hooks/usePagination';
import { useFoliateEvents } from '../hooks/useFoliateEvents';
import { useProgressSync } from '../hooks/useProgressSync';
import { useProgressAutoSave } from '../hooks/useProgressAutoSave';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { useTranslation } from '@/hooks/useTranslation';
import { useEinkMode } from '@/hooks/useEinkMode';
import { useKOSync } from '../hooks/useKOSync';
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
import { mountAdditionalFonts, mountCustomFont } from '@/styles/fonts';
import { getBookDirFromLanguage, getBookDirFromWritingMode } from '@/utils/book';
import { useUICSS } from '@/hooks/useUICSS';
import {
  handleKeydown,
  handleKeyup,
  handleMousedown,
  handleMouseup,
  handleClick,
  handleWheel,
  handleTouchStart,
  handleTouchMove,
  handleTouchEnd,
  addLongPressListeners,
} from '../utils/iframeEventHandlers';
import { getMaxInlineSize } from '@/utils/config';
import { getDirFromUILanguage } from '@/utils/rtl';
import { isTauriAppPlatform } from '@/services/environment';
import { TransformContext } from '@/services/transformers/types';
import { transformContent } from '@/services/transformService';
import { lockScreenOrientation } from '@/utils/bridge';
import { useTextTranslation } from '../hooks/useTextTranslation';
import { useBookCoverAutoSave } from '../hooks/useAutoSaveBookCover';
import { useDiscordPresence } from '@/hooks/useDiscordPresence';
import { manageSyntaxHighlighting } from '@/utils/highlightjs';
import { getViewInsets } from '@/utils/insets';
import { handleA11yNavigation } from '@/utils/a11y';
import { isCJKLang } from '@/utils/lang';
import { getLocale } from '@/utils/misc';
import { ParagraphControl } from './paragraph';
import Spinner from '@/components/Spinner';
import KOSyncConflictResolver from './KOSyncResolver';
import ImageViewer from './ImageViewer';
import TableViewer from './TableViewer';

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
  const bookData = getBookData(bookKey);
  const viewState = getViewState(bookKey);
  const viewSettings = getViewSettings(bookKey);

  const viewRef = useRef<FoliateView | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isViewCreated = useRef(false);
  const doubleClickDisabled = useRef(!!viewSettings?.disableDoubleClick);
  const [toastMessage, setToastMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const docLoaded = useRef(false);

  useAutoFocus<HTMLDivElement>({ ref: containerRef });

  useDiscordPresence(
    bookData?.book || null,
    !!viewState?.isPrimary,
    settings.discordRichPresenceEnabled,
  );

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
    const atEnd = viewRef.current?.renderer.atEnd || false;
    const { current, next, total } = detail.location as PageInfo;
    const currentPage = atEnd && total > 0 ? total - 1 : current;
    const pageInfo = { current: currentPage, next, total };
    setProgress(
      bookKey,
      detail.cfi,
      detail.tocItem,
      detail.section,
      pageInfo,
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
          const bookData = getBookData(bookKey);
          if (viewSettings && detail.type === 'text/css')
            return transformStylesheet(data, width, height, viewSettings.vertical);
          const isHtml = detail.type === 'application/xhtml+xml' || detail.type === 'text/html';
          if (viewSettings && bookData && isHtml) {
            const ctx: TransformContext = {
              bookKey,
              viewSettings,
              width,
              height,
              primaryLanguage: bookData.book?.primaryLanguage,
              userLocale: getLocale(),
              content: data,
              sectionHref: detail.name,
              transformers: [
                'style',
                'punctuation',
                'footnote',
                'whitespace',
                'language',
                'sanitizer',
                'simplecc',
                'proofread',
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

      if (!bookData?.isFixedLayout) {
        mountAdditionalFonts(detail.doc, isCJKLang(bookData.book?.primaryLanguage));
      }

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
      handleA11yNavigation(viewRef.current, detail.doc, detail.index);

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

      if (!detail.doc.isEventListenersAdded) {
        // listened events in iframes are posted to the main window
        // and then used by useMouseEvent and useTouchEvent
        // and more gesture events can be detected in the iframeEventHandlers
        detail.doc.isEventListenersAdded = true;
        detail.doc.addEventListener('keydown', handleKeydown.bind(null, bookKey));
        detail.doc.addEventListener('keyup', handleKeyup.bind(null, bookKey));
        detail.doc.addEventListener('mousedown', handleMousedown.bind(null, bookKey));
        detail.doc.addEventListener('mouseup', handleMouseup.bind(null, bookKey));
        detail.doc.addEventListener('click', handleClick.bind(null, bookKey, doubleClickDisabled));
        detail.doc.addEventListener('wheel', handleWheel.bind(null, bookKey));
        detail.doc.addEventListener('touchstart', handleTouchStart.bind(null, bookKey));
        detail.doc.addEventListener('touchmove', handleTouchMove.bind(null, bookKey));
        detail.doc.addEventListener('touchend', handleTouchEnd.bind(null, bookKey));
        addLongPressListeners(bookKey, detail.doc);
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

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedTableHtml, setSelectedTableHtml] = useState<string | null>(null);
  const [imageList, setImageList] = useState<{ src: string; cfi: string | null }[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);

  const handleImagePress = useCallback(async (src: string) => {
    try {
      // Get all images from the current document
      const docs = viewRef.current?.renderer.getContents();
      const allImages: { src: string; cfi: string | null }[] = [];

      docs?.forEach(({ doc, index }) => {
        const images = doc.querySelectorAll('img');
        images.forEach((img) => {
          if (img.src && index !== undefined && img.parentNode) {
            const range = doc.createRange();
            range.selectNodeContents(img);
            const cfi = viewRef.current?.getCFI(index, range) || null;
            allImages.push({ src: img.src, cfi });
          }
        });
      });

      // Find the index of the pressed image
      const index = allImages.findIndex((img) => img.src === src);

      setImageList(allImages);
      setCurrentImageIndex(index >= 0 ? index : 0);

      const dataUrl = await convertBlobUrlToDataUrl(src);
      setSelectedImage(dataUrl);
    } catch (error) {
      console.error('Failed to load image:', error);
    }
  }, []);

  const handleTablePress = useCallback((html: string) => {
    setSelectedTableHtml(html);
  }, []);

  const handlePreviousImage = useCallback(async () => {
    if (currentImageIndex > 0 && imageList.length > 0) {
      const newIndex = currentImageIndex - 1;
      setCurrentImageIndex(newIndex);
      try {
        const { src, cfi } = imageList[newIndex]!;
        const dataUrl = await convertBlobUrlToDataUrl(src);
        setSelectedImage(dataUrl);
        if (cfi && viewRef.current) {
          viewRef.current?.goTo(cfi);
        }
      } catch (error) {
        console.error('Failed to load previous image:', error);
      }
    }
  }, [currentImageIndex, imageList]);

  const handleNextImage = useCallback(async () => {
    if (currentImageIndex < imageList.length - 1 && imageList.length > 0) {
      const newIndex = currentImageIndex + 1;
      setCurrentImageIndex(newIndex);
      try {
        const { src, cfi } = imageList[newIndex]!;
        const dataUrl = await convertBlobUrlToDataUrl(src);
        setSelectedImage(dataUrl);
        if (cfi && viewRef.current) {
          viewRef.current?.goTo(cfi);
        }
      } catch (error) {
        console.error('Failed to load next image:', error);
      }
    }
  }, [currentImageIndex, imageList]);

  const handleCloseImage = useCallback(() => {
    setSelectedImage(null);
    setImageList([]);
    setCurrentImageIndex(0);
  }, []);

  useLongPressEvent(bookKey, handleImagePress, handleTablePress);

  useFoliateEvents(viewRef.current, {
    onLoad: docLoadHandler,
    onRelocate: progressRelocateHandler,
    onRendererRelocate: docRelocateHandler,
  });

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

      book.transformTarget?.addEventListener('load', (event: Event) => {
        const { detail } = event as CustomEvent;
        if (detail.isScript) {
          detail.allow = viewSettings.allowScript ?? false;
        }
      });
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
    const viewMargins = viewSettings.showMarginsOnScroll && viewSettings.scrolled;

    viewRef.current?.renderer.setAttribute('margin-top', `${viewMargins ? 0 : topMargin}px`);
    viewRef.current?.renderer.setAttribute('margin-right', `${rightMargin}px`);
    viewRef.current?.renderer.setAttribute('margin-bottom', `${viewMargins ? 0 : bottomMargin}px`);
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

  const showViewMargins = viewSettings?.showMarginsOnScroll && viewSettings?.scrolled;

  return (
    <>
      {selectedImage && (
        <ImageViewer
          src={selectedImage}
          onClose={handleCloseImage}
          onPrevious={currentImageIndex > 0 ? handlePreviousImage : undefined}
          onNext={currentImageIndex < imageList.length - 1 ? handleNextImage : undefined}
        />
      )}
      {selectedTableHtml && (
        <TableViewer
          html={selectedTableHtml}
          isDarkMode={isDarkMode}
          onClose={() => setSelectedTableHtml(null)}
        />
      )}
      <div
        ref={containerRef}
        tabIndex={-1}
        role='document'
        aria-label={_('Book Content')}
        className='foliate-viewer h-[100%] w-[100%] focus:outline-none'
        style={{
          paddingTop: showViewMargins ? insets.top : 0,
          paddingBottom: showViewMargins ? insets.bottom : 0,
        }}
        {...mouseHandlers}
        {...touchHandlers}
      />
      <ParagraphControl bookKey={bookKey} viewRef={viewRef} gridInsets={gridInsets} />
      {!docLoaded.current && loading && <Spinner loading={true} />}
      {syncState === 'conflict' && conflictDetails && (
        <KOSyncConflictResolver
          details={conflictDetails}
          onResolveWithLocal={resolveWithLocal}
          onResolveWithRemote={resolveWithRemote}
          onClose={resolveWithLocal}
        />
      )}
    </>
  );
};

export default FoliateViewer;
