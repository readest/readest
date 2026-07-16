import clsx from 'clsx';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { convertBlobUrlToDataUrl, BookDoc, getDirection } from '@/libs/document';
import { BOOK_IDS_SEPARATOR } from '@/services/constants';
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
import { useMouseEvent, useTouchEvent, useOpenMediaEvent } from '../hooks/useIframeEvents';
import { useCapturedTurn, applyPageTurnAttributes } from '../hooks/useCapturedTurn';
import { useBrightnessGesture } from '../hooks/useBrightnessGesture';
import BrightnessOverlay from './BrightnessOverlay';
import { usePagination, viewPagination } from '../hooks/usePagination';
import { useFoliateEvents } from '../hooks/useFoliateEvents';
import { useProgressSync } from '../hooks/useProgressSync';
import { useProgressAutoSave } from '../hooks/useProgressAutoSave';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { useTranslation } from '@/hooks/useTranslation';
import { useEinkMode } from '@/hooks/useEinkMode';
import { useKOSync } from '../hooks/useKOSync';
import { useFileSync } from '../hooks/useFileSync';
import {
  applyFixedlayoutStyles,
  applyImageStyle,
  applyScrollbarStyle,
  applyScrollModeClass,
  applyThemeModeClass,
  applyTranslationStyle,
  getStyles,
  getThemeCode,
  keepTextAlignment,
  transformStylesheet,
} from '@/utils/style';
import { applyScrollableStyle, applyTableTouchScroll } from '@/utils/scrollable';
import { mountAdditionalFonts, mountCustomFont } from '@/styles/fonts';
import { layoutWarichu, relayoutWarichu } from '@/utils/warichu';
import { refreshSectionGlosses } from '@/app/reader/utils/wordlensSection';
import { getBookDirFromLanguage, getBookDirFromWritingMode } from '@/utils/book';
import { getIndexFromCfi } from '@/utils/cfi';
import { useUICSS } from '@/hooks/useUICSS';
import {
  handleKeydown,
  handleKeyup,
  handleMousedown,
  handleMouseup,
  handleMousemove,
  handleAuxclick,
  handleClick,
  handleWheel,
  handleTouchStart,
  handleTouchMove,
  handleTouchEnd,
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
import { footerReservesBand } from '../utils/footerBand';
import { handleA11yNavigation } from '@/utils/a11y';
import { isCJKLang } from '@/utils/lang';
import { getLocale } from '@/utils/misc';
import { isMetered } from '@/utils/network';
import { eventDispatcher } from '@/utils/event';
import { isFontType } from '@/utils/font';
import { getScrollGapAttr } from '@/utils/webtoon';
import { useMiddleClickAutoscroll } from '../hooks/useMiddleClickAutoscroll';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { ParagraphControl } from './paragraph';
import AutoscrollIndicator from './AutoscrollIndicator';
import AutoScrollControl from './AutoScrollControl';
import Spinner from '@/components/Spinner';
import KOSyncConflictResolver from './KOSyncResolver';
import ImageViewer from './ImageViewer';
import TableViewer from './TableViewer';
import {
  getTTSMiniPlayerBottomOffset,
  TTS_MINI_PLAYER_HEIGHT,
} from '../utils/ttsMiniPlayerPosition';

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
  const searchParams = useSearchParams();
  const { appService, envConfig } = useEnv();
  const { themeCode, isDarkMode } = useThemeStore();
  const { settings } = useSettingsStore();
  const { loadFont, loadCustomFonts, getLoadedFonts, getAvailableFonts } = useCustomFontStore();
  // Per-field selectors — see store/readerProgressStore.ts header for the
  // "destructure-subscribes-the-whole-store" rationale.
  const getView = useReaderStore((s) => s.getView);
  const setFoliateView = useReaderStore((s) => s.setView);
  const setViewInited = useReaderStore((s) => s.setViewInited);
  const setProgress = useReaderStore((s) => s.setProgress);
  const setPreviewMode = useReaderStore((s) => s.setPreviewMode);
  const getViewState = useReaderStore((s) => s.getViewState);
  const getProgress = useReaderStore((s) => s.getProgress);
  const getViewSettings = useReaderStore((s) => s.getViewSettings);
  const setViewSettings = useReaderStore((s) => s.setViewSettings);
  const getParallels = useParallelViewStore((s) => s.getParallels);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const { applyBackgroundTexture } = useBackgroundTexture();
  const { applyEinkMode } = useEinkMode();
  const { registerBrightnessListeners, overlayVisible, overlayLevel } =
    useBrightnessGesture(bookKey);
  const bookData = getBookData(bookKey);
  const viewState = getViewState(bookKey);
  const viewSettings = getViewSettings(bookKey);

  const viewRef = useRef<FoliateView | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isViewCreated = useRef(false);
  const doubleClickDisabled = useRef(!!viewSettings?.disableDoubleClick);
  const [toastMessage, setToastMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const navSpinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrollMargins, setScrollMargins] = useState({ top: 0, bottom: 0 });
  const docLoaded = useRef(false);

  // A pending anti-flash timer must not fire setNavigating on an unmounted component.
  useEffect(() => {
    return () => {
      if (navSpinnerTimerRef.current) clearTimeout(navSpinnerTimerRef.current);
    };
  }, []);

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
  useFileSync(bookKey);
  useTextTranslation(bookKey, viewRef.current);

  // Coalesce setProgress writes within a single animation frame.
  //
  // Why: foliate fires `relocate` multiple times during a swipe burst
  // (one per snap step / intermediate stabilize). Each call ends up in
  // `setProgress`, which writes to readerProgressStore + bookDataStore.
  // Even after we split progress into its own store, running the writes
  // back-to-back on the same frame is still wasted work — only the
  // last detail in the burst is what the user sees on screen.
  //
  // Earlier this used requestIdleCallback to defer the commit further,
  // but profiling on Android showed Fire Idle Callback ballooning to
  // 2.0+ seconds of total time per ~28 s session: rIC backed up under
  // sustained pressure and dumped the whole queue into the post-swipe
  // pause, producing exactly the "feels sluggish right after I let go"
  // jank we were trying to fix. rAF runs once per frame, gets scheduled
  // by the browser's normal vsync loop, and doesn't accumulate when
  // the page is busy — which is the behaviour we want here.
  const pendingRelocateRef = useRef<CustomEvent | null>(null);
  const relocateRafRef = useRef<number | null>(null);
  const cancelRelocateScheduled = useCallback(() => {
    const id = relocateRafRef.current;
    if (id == null) return;
    relocateRafRef.current = null;
    cancelAnimationFrame(id);
  }, []);
  const commitRelocate = useCallback(() => {
    relocateRafRef.current = null;
    const event = pendingRelocateRef.current;
    pendingRelocateRef.current = null;
    if (!event) return;
    const detail = event.detail;
    const atEnd = viewRef.current?.renderer.atEnd || false;
    const { current, next, total } = detail.location as PageInfo;
    const currentPage = atEnd && total > 0 ? total - 1 : current;
    const pageInfo = { current: currentPage, next, total };
    setProgress(
      bookKey,
      detail.cfi,
      detail.tocItem,
      detail.pageItem,
      detail.section,
      pageInfo,
      detail.time,
      detail.range,
      detail.fraction,
    );
  }, [bookKey, setProgress]);

  const progressRelocateHandler = (event: Event) => {
    // Always stash the latest detail; if another rAF is already pending
    // it'll pick this up and the intermediate states are skipped.
    pendingRelocateRef.current = event as CustomEvent;
    // requestAnimationFrame is paused while the WebView is backgrounded, so the
    // rAF-coalesced commit below would never run during background TTS - which
    // freezes book.progress (and readerProgressStore, and the home-screen
    // widget that reads them). Commit synchronously when hidden so progress
    // stays current. The page-follow relocate still fires; only the commit was
    // being deferred.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      if (relocateRafRef.current != null) {
        cancelAnimationFrame(relocateRafRef.current);
        relocateRafRef.current = null;
      }
      commitRelocate();
      return;
    }
    if (relocateRafRef.current != null) return;
    relocateRafRef.current = requestAnimationFrame(commitRelocate);
  };

  useEffect(() => {
    // On unmount: flush any pending commit synchronously before tearing
    // down — otherwise the last page-turn before the user closes the
    // book could be lost. Then cancel the scheduled handle to be safe
    // against double-fire.
    return () => {
      if (pendingRelocateRef.current) {
        try {
          commitRelocate();
        } catch {
          // Tearing down — last-effort save shouldn't crash the unmount
        }
      }
      cancelRelocateScheduled();
      pendingRelocateRef.current = null;
    };
  }, [cancelRelocateScheduled, commitRelocate]);

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
              isFixedLayout: bookData.isFixedLayout,
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
                'nbsp',
                'proofread',
                'warichu',
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

  const skipToReadingPosition = useCallback(() => {
    const view = getView(bookKey);
    const progress = getProgress(bookKey);
    if (view && progress) {
      view.renderer.scrollToAnchor?.(progress.range);
    }
  }, [getView, getProgress, bookKey]);

  const skipToNextSection = useCallback(() => {
    const view = getView(bookKey);
    const viewSettings = getViewSettings(bookKey);
    viewPagination(view, viewSettings, 'down', 'section');
  }, [bookKey]);

  const docLoadHandler = (event: Event) => {
    docLoaded.current = true;
    if (bookDoc.rendition?.layout === 'pre-paginated') {
      setLoading(false); // Fixed layout doesn't emit 'stabilized' event
    }
    const detail = (event as CustomEvent).detail;
    console.log('doc index loaded:', detail.index);
    if (detail.doc) {
      const renderer = viewRef.current?.renderer;
      const writingDir = renderer?.setStyles && getDirection(detail.doc);
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
        const themeCode = getThemeCode();
        if (bookData.book?.format === 'PDF' && themeCode && renderer) {
          renderer.pageColors = viewSettings.applyThemeToPDF
            ? {
                background: themeCode.bg,
                foreground: themeCode.fg,
              }
            : undefined;
        }
      }

      applyImageStyle(detail.doc);
      applyScrollableStyle(detail.doc);
      applyTableTouchScroll(detail.doc);
      applyThemeModeClass(detail.doc, isDarkMode);
      applyScrollModeClass(detail.doc, viewSettings.scrolled || false);
      applyScrollbarStyle(document, viewSettings.hideScrollbar || false);
      keepTextAlignment(detail.doc);
      handleA11yNavigation(viewRef.current, detail.doc, {
        skipToLastPosCallback: skipToReadingPosition,
        skipToLastPosLabel: _('Skip to last reading position'),
        skipToNextSectionCallback: skipToNextSection,
        skipToNextSectionLabel: _('End of this section. Continue to the next.'),
      });

      // Inline scripts in tauri platforms are not executed by default
      if (viewSettings.allowScript && isTauriAppPlatform()) {
        evalInlineScripts(detail.doc);
      }

      // only call on load if we have highlighting turned on.
      if (viewSettings.codeHighlighting) {
        manageSyntaxHighlighting(detail.doc, viewSettings);
      }

      setTimeout(() => {
        const sectionIndex = detail.index;
        const booknotes = config.booknotes || [];
        booknotes
          .filter(
            (item) =>
              !item.deletedAt &&
              item.type === 'annotation' &&
              item.style &&
              getIndexFromCfi(item.cfi) === sectionIndex,
          )
          .map((annotation) => {
            try {
              viewRef.current?.addAnnotation(annotation);
            } catch (err) {
              console.warn('Failed to add annotation', { annotation, error: err });
            }
          });
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
        detail.doc.addEventListener('mousemove', handleMousemove.bind(null, bookKey));
        detail.doc.addEventListener('auxclick', handleAuxclick.bind(null, bookKey));
        detail.doc.addEventListener(
          'click',
          handleClick.bind(null, bookKey, doubleClickDisabled, !!bookData?.isFixedLayout),
        );
        detail.doc.addEventListener('wheel', handleWheel.bind(null, bookKey));
        detail.doc.addEventListener('touchstart', handleTouchStart.bind(null, bookKey));
        detail.doc.addEventListener('touchmove', handleTouchMove.bind(null, bookKey));
        detail.doc.addEventListener('touchend', handleTouchEnd.bind(null, bookKey));
        registerBrightnessListeners(detail.doc);
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

  // Build the Word Lens refresh context: gate silent auto-download on the global
  // toggle AND a best-effort metered-connection check, and show a single
  // "Downloading…" toast on the first progress tick (the per-percent progress
  // lives in the Word Lens settings panel). `wordLensToastShownRef` de-dupes the
  // toast across the multiple section docs a refresh pass touches.
  const wordLensToastShownRef = useRef(false);
  const buildWordLensCtx = (bookLang?: string | null) => {
    // Read the live setting (not the first-render `settings` snapshot closed over
    // by the empty-deps `stabilizedHandler`) so toggling Auto-download mid-session
    // takes effect on the next section refresh.
    const liveSettings = useSettingsStore.getState().settings;
    const allowDownload =
      (liveSettings.globalReadSettings.wordLensAutoDownload ?? true) && !isMetered();
    return {
      appService: appService!,
      bookLang,
      appLang: getLocale().split('-')[0] || 'en',
      allowDownload,
      onProgress: () => {
        if (wordLensToastShownRef.current) return;
        wordLensToastShownRef.current = true;
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Downloading Word Lens data…'),
        });
      },
    };
  };

  const navigateStartHandler = useCallback(() => {
    if (navSpinnerTimerRef.current) clearTimeout(navSpinnerTimerRef.current);
    // Delay so instant same-section jumps don't flash the spinner.
    navSpinnerTimerRef.current = setTimeout(() => setNavigating(true), 200);
  }, []);

  const navigateEndHandler = useCallback(() => {
    if (navSpinnerTimerRef.current) {
      clearTimeout(navSpinnerTimerRef.current);
      navSpinnerTimerRef.current = null;
    }
    setNavigating(false);
  }, []);

  const stabilizedHandler = useCallback(() => {
    setLoading(false);
    // Layout/relayout warichu after paginator has set column-width via columnize()
    const contents = viewRef.current?.renderer?.getContents?.() || [];
    const vs = getViewSettings(bookKey);
    const bookLang = getBookData(bookKey)?.book?.primaryLanguage;
    // Fixed-layout (pre-paginated) books have no reflow room; injecting ruby
    // would overflow their fixed boxes, so skip Word Lens glosses there.
    const isFixedLayout = bookDoc.rendition?.layout === 'pre-paginated';
    for (const { doc } of contents) {
      if (doc) {
        const hasPending = doc.querySelectorAll('.warichu-pending').length > 0;
        const hasExisting = doc.querySelectorAll('.warichu-head').length > 0;
        if (hasPending) {
          layoutWarichu(doc);
        } else if (hasExisting) {
          relayoutWarichu(doc);
        }
        if (vs && appService && !isFixedLayout) {
          void refreshSectionGlosses(doc, vs, buildWordLensCtx(bookLang));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const docRelocateHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail.reason !== 'scroll' && detail.reason !== 'page') return;

    // First user-initiated navigation after a deep-link landing — promote
    // the preview into the real reading position. Subsequent progress writes
    // can flow normally.
    setPreviewMode(bookKey, false);

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

  const { handlePageFlip } = usePagination(bookKey, viewRef, containerRef);
  const mouseHandlers = useMouseEvent(bookKey, handlePageFlip);
  const touchHandlers = useTouchEvent(bookKey);
  const autoscrollAnchor = useMiddleClickAutoscroll(bookKey, viewRef, containerRef);
  const autoScroll = useAutoScroll(bookKey, viewRef);

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
        const elements = doc.querySelectorAll('img, svg');
        elements.forEach((el) => {
          if (index === undefined) return;
          if (el.localName === 'img') {
            const img = el as HTMLImageElement;
            if (img.src && img.parentNode) {
              const range = doc.createRange();
              range.selectNodeContents(img);
              const cfi = viewRef.current?.getCFI(index, range) || null;
              allImages.push({ src: img.src, cfi });
            }
          } else if (el.localName === 'svg') {
            const svg = el as unknown as SVGSVGElement;
            const svgImage = svg.querySelector('image');
            const href =
              svgImage?.getAttribute('href') ||
              svgImage?.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
            if (href) {
              const range = doc.createRange();
              range.selectNodeContents(svg);
              const cfi = viewRef.current?.getCFI(index, range) || null;
              allImages.push({ src: href, cfi });
            }
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

  useOpenMediaEvent(bookKey, handleImagePress, handleTablePress);

  useCapturedTurn(bookKey, viewRef);

  useFoliateEvents(viewRef.current, {
    onLoad: docLoadHandler,
    onStabilized: stabilizedHandler,
    onRelocate: progressRelocateHandler,
    onRendererRelocate: docRelocateHandler,
    onNavigateStart: navigateStartHandler,
    onNavigateEnd: navigateEndHandler,
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

      book.transformTarget?.addEventListener('load', async (event: Event) => {
        const { detail } = event as CustomEvent<{
          isScript: boolean;
          type: string;
          href: string;
          url?: string;
          allow?: boolean;
        }>;
        if (detail.isScript) {
          detail.allow = viewSettings.allowScript ?? false;
        }
        if (isFontType(detail.type) && detail.href?.startsWith('fonts/')) {
          const fontFileName = detail.href.split('/').pop()?.toLowerCase();
          getAvailableFonts().forEach(async (font) => {
            const customFontFileName = font.path.split('/').pop()?.toLowerCase();
            if (fontFileName && fontFileName === customFontFileName) {
              if (!font.loaded) {
                const loadedFont = await loadFont(envConfig, font.id);
                font.blobUrl = loadedFont?.blobUrl;
              }
              if (font.blobUrl) {
                detail.url = font.blobUrl;
              }
            }
          });
        }
      });
      const viewWidth = appService?.isMobile ? screen.width : window.innerWidth;
      const viewHeight = appService?.isMobile ? screen.height : window.innerHeight;
      const width = viewWidth - insets.left - insets.right;
      const height = viewHeight - insets.top - insets.bottom;
      book.transformTarget?.addEventListener('data', getDocTransformHandler({ width, height }));
      view.renderer.setStyles?.(getStyles(viewSettings, undefined, getLoadedFonts()));
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
      applyPageTurnAttributes(view, viewSettings, bookDoc.rendition?.layout === 'pre-paginated');
      // iOS WebKit composites large/persistent page layers without the Android
      // high-DPR Blink freeze, so opt this renderer into the GPU-accelerated
      // page-turn path (persistent compositor layers + no main-thread
      // rafAnimateScroll fallback) to keep 120Hz ProMotion turns smooth
      // (readest#4768).
      if (appService?.isIOSApp) {
        view.renderer.setAttribute('gpu-composite', '');
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
        view.renderer.setAttribute('scroll-gap', getScrollGapAttr(viewSettings.webtoonMode));
      } else {
        view.renderer.setAttribute('max-column-count', maxColumnCount);
        view.renderer.setAttribute('max-inline-size', `${maxInlineSize}px`);
        view.renderer.setAttribute('max-block-size', `${maxBlockSize}px`);
      }
      applyMarginAndGap();

      // If the URL carries ?cfi=... (e.g. opened from a deep link / annotation
      // export link), use it as the initial location instead of the saved one.
      // Only applies to the primary book — first id in the route's `ids` —
      // so parallel views don't all jump to the same CFI.
      const cfiParam = searchParams?.get('cfi');
      const idsParam =
        searchParams?.get('ids') ?? window.location.pathname.split('/reader/')[1] ?? '';
      const primaryId = idsParam.split(BOOK_IDS_SEPARATOR).filter(Boolean)[0];
      const thisId = bookKey.split('-')[0];
      const overrideLocation = cfiParam && primaryId === thisId ? cfiParam : null;

      const lastLocation = overrideLocation ?? config.location;
      if (lastLocation) {
        await view.init({ lastLocation });
      } else {
        await view.goToFraction(0);
      }
      setViewInited(bookKey, true);

      // The reader is showing a deep-link target, not the user's actual reading
      // position. Mark the view as a preview so progress writers (auto-save,
      // cloud sync, kosync) skip until the user takes a reading action. The
      // flag clears on the first user-initiated relocate (page / scroll) in
      // docRelocateHandler below.
      if (overrideLocation) {
        setPreviewMode(bookKey, true);
      }
    };

    openBook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyMarginAndGap = () => {
    // Invoked from effects/observers that can fire after the book is torn down,
    // when getViewSettings(bookKey) returns null. The `!` assertion hid that, so
    // the reads below (getViewInsets, viewSettings.showHeader) crashed on null
    // (READEST-2V). Bail: there is no view left to lay out.
    const viewSettings = getViewSettings(bookKey);
    if (!viewSettings) return;
    const viewState = getViewState(bookKey);
    const bookData = getBookData(bookKey);
    const viewInsets = getViewInsets(viewSettings);
    const showDoubleBorder = viewSettings.vertical && viewSettings.doubleBorder;
    const showDoubleBorderHeader = showDoubleBorder && viewSettings.showHeader;
    const showDoubleBorderFooter = showDoubleBorder && viewSettings.showFooter;
    const showTopHeader = viewSettings.showHeader && !viewSettings.vertical;
    // The bottom band is reserved only while the footer displays something
    // there (and never in scrolled mode, where the info floats in pills) —
    // see footerReservesBand. Otherwise the empty reservation shows as a
    // full-width blank bar that steals space from the book text.
    const showBottomFooter = footerReservesBand(viewSettings) && !viewSettings.vertical;
    const moreTopInset = showTopHeader ? Math.max(0, 16 - insets.top) : 0;
    // Resting position (bottom bar dismissed): the card stacks above the
    // footer band, so the reserved clearance is its bottom offset plus the
    // card height.
    const miniPlayerClearance = viewState?.ttsEnabled
      ? getTTSMiniPlayerBottomOffset(viewSettings) +
        TTS_MINI_PLAYER_HEIGHT +
        gridInsets.bottom * 0.33
      : 0;
    const moreBottomInset = showBottomFooter
      ? Math.max(0, Math.max(miniPlayerClearance, 16) - insets.bottom)
      : Math.max(0, miniPlayerClearance);
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

    if (viewSettings.scrolled) {
      const headerVisible = showTopHeader;
      const footerVisible = showBottomFooter;
      const safeBottomPadding = appService?.hasSafeAreaInset ? gridInsets.bottom * 0.33 : 0;
      const footerBarHeight = safeBottomPadding + viewSettings.marginBottomPx;
      const scrollTop = headerVisible ? gridInsets.top + viewSettings.marginTopPx : 0;
      const scrollBottom = footerVisible
        ? Math.max(footerBarHeight, miniPlayerClearance)
        : miniPlayerClearance;
      setScrollMargins({ top: bookData?.isFixedLayout ? 0 : scrollTop, bottom: scrollBottom });
    } else {
      setScrollMargins({ top: 0, bottom: 0 });
    }
    viewRef.current?.renderer.setAttribute('gap', `${viewSettings.gapPercent}%`);
    if (viewSettings.scrolled) {
      viewRef.current?.renderer.setAttribute('flow', 'scrolled');
      if (viewSettings.noContinuousScroll) {
        viewRef.current?.renderer.setAttribute('no-continuous-scroll', '');
      } else {
        viewRef.current?.renderer.removeAttribute('no-continuous-scroll');
      }
    }
  };

  useEffect(() => {
    if (viewRef.current && viewRef.current.renderer) {
      const renderer = viewRef.current.renderer;
      const viewSettings = getViewSettings(bookKey)!;
      viewRef.current.renderer.setStyles?.(getStyles(viewSettings, undefined, getLoadedFonts()));
      const docs = viewRef.current.renderer.getContents();
      docs.forEach(({ doc }) => {
        if (bookDoc.rendition?.layout === 'pre-paginated') {
          applyFixedlayoutStyles(doc, viewSettings);
        }
        applyThemeModeClass(doc, isDarkMode);
        applyScrollModeClass(doc, viewSettings.scrolled || false);
        applyScrollbarStyle(document, viewSettings.hideScrollbar || false);
      });

      if (bookData?.book?.format === 'PDF' && themeCode && renderer) {
        renderer.pageColors = viewSettings.applyThemeToPDF
          ? {
              background: themeCode.bg,
              foreground: themeCode.fg,
            }
          : undefined;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    themeCode,
    isDarkMode,
    viewSettings?.scrolled,
    viewSettings?.overrideColor,
    viewSettings?.invertImgColorInDark,
    viewSettings?.applyThemeToPDF,
    viewSettings?.contrast,
    viewSettings?.hideScrollbar,
  ]);

  useEffect(() => {
    const contents = viewRef.current?.renderer?.getContents?.() || [];
    const vs = getViewSettings(bookKey);
    if (!vs || !appService) return;
    const bookLang = getBookData(bookKey)?.book?.primaryLanguage;
    const isFixedLayout = bookDoc.rendition?.layout === 'pre-paginated';
    if (isFixedLayout) return;
    // A settings change is the moment a fresh download may start; let the
    // one-time "Downloading…" toast fire again for it.
    wordLensToastShownRef.current = false;
    for (const { doc } of contents) {
      if (doc) void refreshSectionGlosses(doc, vs, buildWordLensCtx(bookLang));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSettings?.wordLensEnabled, viewSettings?.wordLensLevel, viewSettings?.wordLensHintLang]);

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
    viewSettings?.scrolled,
    viewSettings?.noContinuousScroll,
    viewState?.ttsEnabled,
    // footerReservesBand inputs: the band must collapse/return live when the
    // user flips these settings.
    viewSettings?.showStickyProgressBar,
    viewSettings?.showRemainingTime,
    viewSettings?.showRemainingPages,
    viewSettings?.showProgressInfo,
    viewSettings?.showCurrentTime,
    viewSettings?.showCurrentBatteryStatus,
  ]);

  return (
    <>
      {selectedImage && (
        <ImageViewer
          gridInsets={gridInsets}
          src={selectedImage}
          onClose={handleCloseImage}
          onPrevious={currentImageIndex > 0 ? handlePreviousImage : undefined}
          onNext={currentImageIndex < imageList.length - 1 ? handleNextImage : undefined}
        />
      )}
      {selectedTableHtml && (
        <TableViewer
          gridInsets={gridInsets}
          html={selectedTableHtml}
          isDarkMode={isDarkMode}
          onClose={() => setSelectedTableHtml(null)}
        />
      )}
      <div
        ref={containerRef}
        role='main'
        aria-label={_('Book Content')}
        className={clsx(
          'foliate-viewer absolute h-[100%] w-[100%] focus:outline-none',
          viewState?.loading && 'bg-base-100',
        )}
        style={{
          paddingTop: scrollMargins.top,
          paddingBottom: scrollMargins.bottom,
        }}
        {...mouseHandlers}
        {...touchHandlers}
      />
      {autoscrollAnchor && <AutoscrollIndicator anchor={autoscrollAnchor} />}
      {autoScroll.active && (
        <AutoScrollControl
          bookKey={bookKey}
          paused={autoScroll.paused}
          speed={autoScroll.speed}
          onTogglePause={autoScroll.togglePause}
          onAdjustSpeed={autoScroll.adjustSpeed}
          onStop={autoScroll.stop}
          gridInsets={gridInsets}
        />
      )}
      <BrightnessOverlay visible={overlayVisible} level={overlayLevel} />
      <ParagraphControl bookKey={bookKey} viewRef={viewRef} gridInsets={gridInsets} />
      {((!docLoaded.current && loading) || navigating || viewState?.loading) && (
        <div className='absolute left-0 top-0 z-10 flex h-full w-full items-center justify-center'>
          <Spinner loading={true} />
        </div>
      )}
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
