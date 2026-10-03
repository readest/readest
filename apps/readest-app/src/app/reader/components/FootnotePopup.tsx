import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdArrowBack, MdOutlineArrowOutward } from 'react-icons/md';

import { BookDoc } from '@/libs/document';
import { BookNote } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { useFoliateEvents } from '../hooks/useFoliateEvents';
import { useCustomFontStore } from '@/store/customFontStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getBaseFontFamily,
  getBaseFontSize,
  getFootnoteStyles,
  getStyles,
  getThemeCode,
} from '@/utils/style';
import { getPopupPosition, getPosition, Position } from '@/utils/sel';
import { getPopupBounds, offsetPosition, PopupBounds } from '@/utils/insets';
import { Insets } from '@/types/misc';
import { FootnoteHandler } from 'foliate-js/footnotes.js';
import { mountAdditionalFonts, mountCustomFont } from '@/styles/fonts';
import { eventDispatcher } from '@/utils/event';
import { getCfiSpinePrefix } from '@/utils/cfi';
import { isLinkTargetVisible, shouldCheckAsFootnote } from '../utils/footnoteHeuristics';
import { showTransientHighlight } from '../utils/transientHighlight';
import { drawAnnotationOverlay } from '../utils/annotatorUtil';
import {
  FootnoteExtractMapping,
  getFootnoteLocalCfi,
  getFootnoteSelectionCfi,
} from '../utils/footnoteCfi';
import { FoliateView, NOTE_PREFIX } from '@/types/view';
import { isCJKLang } from '@/utils/lang';
import { Overlay } from '@/components/Overlay';
import Popup from '@/components/Popup';

interface FootnotePopupProps {
  bookKey: string;
  bookDoc: BookDoc;
  gridInsets?: Insets;
}

const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

const popupWidth = 360;
const popupHeight = 88;
// `#popup-container` sizes itself as a border box and draws a 1px border, so
// the content it holds gets `2 * popupBorder` less than the popup size handed
// to it. Sizing the content to the popup size instead overflowed the box by
// those two pixels on both axes, and `overflow-y-auto` promotes `overflow-x`
// to `auto` too, so the popup wrapped its document in a spurious vertical and
// horizontal scrollbar (#5999).
const popupBorder = 1;
// Every size the popup computes comes from measuring content — the paginator's
// `viewSize`, the height of the synthesized paragraph — but the number handed
// to `Popup` is the outer box. Grow the measurement by the border, or the
// content ends up 2px short of the room it asked for and scrolls for it.
const popupSizeForContent = (contentSize: number) => contentSize + 2 * popupBorder;

const chromeButtonClassName = clsx(
  'btn btn-ghost btn-circle eink-bordered text-base-content bg-base-200/80 hover:bg-base-200',
  'h-8 min-h-8 w-8 p-0 shadow-xs',
);

const FootnotePopup: React.FC<FootnotePopupProps> = ({
  bookKey,
  bookDoc,
  gridInsets = ZERO_INSETS,
}) => {
  const footnoteRef = useRef<HTMLDivElement>(null);
  const footnoteViewRef = useRef<FoliateView | null>(null);
  const trianglePositionRef = useRef<Position | null>(null);
  // The link and footnote-popup handlers are bound once per view, so they read
  // the cell's insets through a ref: iPhone Duo's side strip can change edge
  // after the view opens (#6307).
  const gridInsetsRef = useRef(gridInsets);
  gridInsetsRef.current = gridInsets;
  const [trianglePosition, setTrianglePosition] = useState<Position | null>();
  // The highlight toolbar, when it had to open on this popup's side of the
  // tapped word for lack of room on the other (#6390): open beyond it. Kept
  // until the popup closes, so the popup never moves under the reader.
  const [toolbarBlock, setToolbarBlock] = useState<{ dir: Position['dir']; size: number } | null>(
    null,
  );
  const anchor = useMemo(() => {
    if (!trianglePosition || !toolbarBlock || toolbarBlock.dir !== trianglePosition.dir) {
      return trianglePosition;
    }
    const { point, dir } = trianglePosition;
    const shift = dir === 'up' || dir === 'left' ? -toolbarBlock.size : toolbarBlock.size;
    return dir === 'up' || dir === 'down'
      ? { dir, point: { x: point.x, y: point.y + shift } }
      : { dir, point: { x: point.x + shift, y: point.y } };
  }, [trianglePosition, toolbarBlock]);
  const [popupPosition, setPopupPosition] = useState<Position | null>();
  const [showPopup, setShowPopup] = useState(false);

  const _ = useTranslation();
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getView, getViewSettings } = useReaderStore();
  const { getLoadedFonts } = useCustomFontStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const [footnoteHandler] = useState(() => new FootnoteHandler());
  const containerRef = useRef<HTMLDivElement>(null);
  const footnoteHrefRef = useRef<string | null>(null);
  // How the current popup document maps back onto the pristine section (from
  // the footnote handler's render event), plus the popup document itself once
  // loaded. Null while no mappable popup is open.
  const popupMapRef = useRef<{
    index: number;
    extract: FootnoteExtractMapping | null;
    doc?: Document;
  } | null>(null);
  // Annotation overlays currently drawn in the popup document, keyed by
  // booknote id, so the sync effect below can restyle/remove them.
  const drawnNotesRef = useRef(new Map<string, { value: string; updatedAt: number }>());
  const [popupContentEpoch, setPopupContentEpoch] = useState(0);
  const booknotes = useBookDataStore((s) => s.booksData[bookKey.split('-')[0]!]?.config?.booknotes);

  // Point the popup at a new (or no) source document: drop the CFI mapping and
  // the drawn-overlay bookkeeping, and tell the Annotator that any selection
  // made in the previous popup document is gone.
  const resetPopupAnnotationState = (
    map: { index: number; extract: FootnoteExtractMapping | null; doc?: Document } | null = null,
  ) => {
    popupMapRef.current = map;
    drawnNotesRef.current.clear();
    eventDispatcher.dispatch('footnote-selection', { key: bookKey });
  };
  const historyRef = useRef<{ items: Record<string, unknown>[]; index: number }>({
    items: [],
    index: -1,
  });
  const [canGoBack, setCanGoBack] = useState(false);
  // The book location the popup is currently showing, when that location is
  // somewhere the reader can actually be taken. Null for a popup with no book
  // document behind it, and for a target the stylesheet hides, so this doubles
  // as the gate for the jump button.
  const [sourceHref, setSourceHref] = useState<string | null>(null);

  // Inline footnote bodies are hidden by the reader's own stylesheet, so a
  // link pointing at one has nowhere to take the reader and earns no button.
  const getJumpHref = (href: string | undefined | null) => {
    const mainView = getView(bookKey);
    return href && mainView && isLinkTargetVisible(mainView, href) ? href : null;
  };
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A link that jumps in-page instead of opening a popup (undetected or
  // unextractable footnotes, note backlinks) lands without any visual cue;
  // briefly highlight the target like a library search hit does (#5647).
  const flashLinkTarget = async (href: string) => {
    const view = getView(bookKey);
    if (!view) return;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = await showTransientHighlight(view, href);
  };

  const [popupBounds, setPopupBounds] = useState<PopupBounds | null>(null);
  const [responsiveWidth, setResponsiveWidth] = useState(popupWidth);
  const [responsiveHeight, setResponsiveHeight] = useState(popupHeight);
  const sizeAdjustCountRef = useRef(0);
  const maxSizeAdjustCount = 3;
  const contentSizeObserverRef = useRef<ResizeObserver | null>(null);
  const contentSizeFrameRef = useRef<number | null>(null);
  const size18 = useResponsiveSize(18);
  const popupPadding = useResponsiveSize(10);

  const getMaxHeight = useCallback(() => {
    let availableHeight = window.innerHeight - 2 * popupPadding;
    if (trianglePositionRef.current?.dir === 'up') {
      availableHeight = trianglePositionRef.current.point.y - popupPadding;
    } else if (trianglePositionRef.current?.dir === 'down') {
      availableHeight = window.innerHeight - trianglePositionRef.current.point.y - popupPadding;
    }
    return availableHeight;
  }, [popupPadding]);

  const getMaxWidth = useCallback(() => {
    let availableWidth = Math.min(window.innerWidth - 2 * popupPadding, 720);
    if (trianglePositionRef.current?.dir === 'left') {
      availableWidth = trianglePositionRef.current.point.x - popupPadding;
    } else if (trianglePositionRef.current?.dir === 'right') {
      availableWidth = window.innerWidth - trianglePositionRef.current.point.x - popupPadding;
    }
    return availableWidth;
  }, [popupPadding]);

  const getResponsivePopupSize = (size: number, isVertical: boolean) => {
    const maxSize = isVertical ? window.innerWidth : window.innerHeight;
    return Math.min(size, maxSize - popupPadding - 12);
  };

  const clipPopupWith = (size: number) => {
    return Math.min(size, window.innerWidth - popupPadding - 12);
  };

  const clipPopupHeight = (size: number) => {
    return Math.min(size, window.innerHeight - popupPadding - 12);
  };

  // Imperative, not an effect keyed on the trigger position: that effect ran
  // after the commit and overwrote the size just measured from the content.
  const seedPopupSize = (isVertical: boolean) => {
    const size = isVertical
      ? {
          width: clipPopupWith(popupHeight),
          height: clipPopupHeight(Math.max(popupWidth, window.innerHeight / 4)),
        }
      : {
          width: clipPopupWith(Math.max(popupWidth, window.innerWidth / 4)),
          height: clipPopupHeight(popupHeight),
        };
    setResponsiveWidth(size.width);
    setResponsiveHeight(size.height);
    return size;
  };

  // Fits the box along the reading axis and returns the size it applied.
  const fitPopupToContent = (view: FoliateView) => {
    const { renderer } = view;
    if (!renderer) return 0;
    const vertical = getViewSettings(bookKey)!.vertical;
    const box = popupSizeForContent(renderer.viewSize);
    const size = vertical
      ? clipPopupWith(Math.min(getResponsivePopupSize(box, true), getMaxWidth()))
      : clipPopupHeight(Math.min(getResponsivePopupSize(box, false), getMaxHeight()));
    if (vertical) setResponsiveWidth(size);
    else setResponsiveHeight(size);
    return size;
  };

  // The document keeps growing after the first `relocate` — the section may
  // still be parsing, fonts and images arrive later — so measuring once left
  // the popup cut to whatever it held at that instant.
  const trackPopupContentSize = (view: FoliateView, doc: Document) => {
    stopTrackingPopupContentSize();
    const observer = new ResizeObserver(() => {
      if (contentSizeFrameRef.current) cancelAnimationFrame(contentSizeFrameRef.current);
      contentSizeFrameRef.current = requestAnimationFrame(() => {
        // Showing the popup only from `relocate` left one whose visible content
        // is elements alone — an image, a bare figure — parked off-screen for
        // good: an element-only visible range collapses, so foliate's paginator
        // returns before it ever dispatches `relocate`. A measured content size
        // is the same promise that event was standing in for.
        if (fitPopupToContent(view) > 0) setShowPopup(true);
      });
    });
    observer.observe(doc.documentElement);
    contentSizeObserverRef.current = observer;
  };

  const stopTrackingPopupContentSize = () => {
    if (contentSizeFrameRef.current) cancelAnimationFrame(contentSizeFrameRef.current);
    contentSizeFrameRef.current = null;
    contentSizeObserverRef.current?.disconnect();
    contentSizeObserverRef.current = null;
  };

  useEffect(() => {
    const getHashFromHref = (href: string | null) => {
      if (!href) return null;
      const hashIndex = href.indexOf('#');
      if (hashIndex !== -1) {
        return href.substring(hashIndex + 1);
      }
      return null;
    };
    const handleBeforeRender = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const { view: popupView } = detail;
      // Whether the Annotator is showing a text selection reported from this
      // view, as opposed to nothing or a highlight's toolbar opened by a tap.
      let selectionReported = false;
      // Maps a range in this view's document into the pristine section, when
      // the extraction mapping allows it.
      const getPopupCfiMapper = (index: number) => {
        const info = popupMapRef.current;
        const extract = info && info.index === index ? info.extract : null;
        if (!extract) return undefined;
        return (range: Range) =>
          getFootnoteSelectionCfi(range, extract, popupView.getCFI(index)) ?? undefined;
      };
      popupView.addEventListener('link', (e: Event) => {
        e.preventDefault();
        const { detail: popupLinkDetail } = e as CustomEvent;
        const footnoteAnchorId = getHashFromHref(footnoteHrefRef.current);
        const linkAnchor = popupLinkDetail.a as HTMLAnchorElement;
        if (linkAnchor && linkAnchor.getAttribute('id') === footnoteAnchorId) return;

        popupLinkDetail['follow'] = true;
        const history = historyRef.current;
        const items = [...history.items.slice(0, history.index + 1), popupLinkDetail];
        historyRef.current = { items, index: items.length - 1 };
        setCanGoBack(true);
        footnoteHandler.handle(bookDoc, e)?.catch((err) => {
          console.warn(err);
          getView(bookKey)?.goTo(popupLinkDetail.href);
          flashLinkTarget(popupLinkDetail.href);
          setShowPopup(false);
        });
      });
      // Hand external links to the main view so they get its confirmation.
      popupView.addEventListener('external-link', (e: Event) => {
        e.preventDefault();
        const { detail } = e as CustomEvent;
        getView(bookKey)?.dispatchEvent(new CustomEvent('external-link', { detail }));
      });
      popupView.addEventListener('load', (e: CustomEvent) => {
        const { doc, index } = e.detail as { doc: Document; index: number };
        const bookData = getBookData(bookKey)!;
        mountAdditionalFonts(doc, isCJKLang(bookData.book?.primaryLanguage));
        getLoadedFonts().forEach((font) => {
          mountCustomFont(doc, font);
        });

        // Surface text selections made inside the popup document to the
        // Annotator. The CFI is mapped into the pristine section when the
        // extraction mapping allows it; without one the toolbar still shows,
        // with the CFI-dependent tools disabled.
        // A tap reports an empty selection so it dismisses the toolbar; a mere
        // caret only clears a selection reported before. On touch devices the
        // caret a tap on a highlight drops lands after the click that opened
        // its toolbar, and used to close it again (#6395).
        const report = (tap: boolean) => {
          if (!doc.defaultView) return; // popup already torn down
          const sel = doc.getSelection();
          if (!sel || sel.isCollapsed || !sel.toString().trim()) {
            if (tap || selectionReported) {
              eventDispatcher.dispatch('footnote-selection', { key: bookKey });
            }
            selectionReported = false;
            return;
          }
          selectionReported = true;
          const range = sel.getRangeAt(0);
          const getPopupCfi = getPopupCfiMapper(index);
          eventDispatcher.dispatch('footnote-selection', {
            key: bookKey,
            range,
            index,
            cfi: getPopupCfi?.(range),
            href: footnoteHrefRef.current?.split('#')[0],
            getPopupCfi,
          });
        };
        let selectionTimer: ReturnType<typeof setTimeout> | null = null;
        doc.addEventListener('selectionchange', () => {
          if (selectionTimer) clearTimeout(selectionTimer);
          selectionTimer = setTimeout(() => report(false), 250);
        });
        doc.addEventListener('pointerup', () => {
          if (selectionTimer) clearTimeout(selectionTimer);
          report(true);
        });
        if (appService?.isMobile) {
          // Same as the main view: the selection handles suffice on mobile.
          doc.addEventListener('contextmenu', (ev: Event) => ev.preventDefault());
        }

        // Each request builds its own view; a superseded one still loads, and
        // must not resize or repaint the popup the newer request now owns.
        if (popupView !== footnoteViewRef.current) return;
        const info = popupMapRef.current;
        if (info && info.index === index) {
          popupMapRef.current = { ...info, doc };
        }
        trackPopupContentSize(popupView, doc);
        setPopupContentEpoch((epoch) => epoch + 1);
      });
      // Style callback for annotation overlays drawn in the popup document
      // (the annotation-sync effect below adds them with mapped local CFIs).
      popupView.addEventListener('draw-annotation', (e: Event) => {
        const viewSettings = getViewSettings(bookKey)!;
        drawAnnotationOverlay((e as CustomEvent).detail, {
          settings: useSettingsStore.getState().settings,
          viewSettings,
          isDarkMode: useThemeStore.getState().isDarkMode,
          isMobile: !!appService?.isMobile,
        });
      });
      // A click on a drawn overlay reports the popup-local value; map it back
      // to its booknote and open the toolbar in the annotated state so the
      // highlight can be restyled or deleted, like in the main view.
      popupView.addEventListener('show-annotation', (e: Event) => {
        const detail = (e as CustomEvent).detail as {
          value: string;
          index: number;
          range: Range;
          rect?: { left: number; right: number; top: number; bottom: number };
        };
        let noteId: string | null = null;
        for (const [key, drawn] of drawnNotesRef.current) {
          if (drawn.value === detail.value) {
            noteId = key.split('#')[0]!;
            break;
          }
        }
        if (!noteId) return;
        const shard = bookKey.split('-')[0]!;
        const note = (useBookDataStore.getState().booksData[shard]?.config?.booknotes ?? []).find(
          (n) => n.id === noteId && !n.deletedAt,
        );
        if (!note) return;
        selectionReported = false;
        const isNote = detail.value.startsWith(NOTE_PREFIX);
        eventDispatcher.dispatch('footnote-selection', {
          key: bookKey,
          range: detail.range,
          index: detail.index,
          cfi: note.cfi,
          href: footnoteHrefRef.current?.split('#')[0],
          annotated: true,
          isNote,
          rect: isNote ? detail.rect : undefined,
          getPopupCfi: getPopupCfiMapper(detail.index),
        });
      });
      footnoteViewRef.current = popupView;
      footnoteRef.current?.replaceChildren(popupView);
      const { renderer } = popupView;
      const viewSettings = getViewSettings(bookKey)!;
      renderer.setAttribute('flow', 'scrolled');
      renderer.setAttribute('no-preload', '');
      renderer.setAttribute('no-background', '');
      renderer.setAttribute('margin-top', '0px');
      renderer.setAttribute('margin-right', '0px');
      renderer.setAttribute('margin-bottom', '0px');
      renderer.setAttribute('margin-left', '0px');
      renderer.setAttribute('gap', '0%');
      const themeCode = getThemeCode();
      const popupTheme = { ...themeCode };
      const popupContainer = document.getElementById('popup-container');
      if (popupContainer) {
        const backgroundColor = getComputedStyle(popupContainer).backgroundColor;
        popupTheme.bg = backgroundColor;
      }
      const mainStyles = getStyles(viewSettings, popupTheme, getLoadedFonts());
      const footnoteStyles = getFootnoteStyles();
      renderer.setStyles?.(`${mainStyles}\n${footnoteStyles}`);
    };

    const handleRender = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // console.log('render footnote', detail);
      const { view, href, index, extract } = detail;
      footnoteHrefRef.current = href;
      setSourceHref(getJumpHref(href));
      resetPopupAnnotationState({ index: index ?? -1, extract: extract ?? null });
      sizeAdjustCountRef.current = 0;
      view.addEventListener('relocate', () => {
        const readingAxisSize = fitPopupToContent(view as FoliateView);
        // The cross-axis widening reflows the document, so keep it capped.
        if (readingAxisSize > 0 && sizeAdjustCountRef.current < maxSizeAdjustCount) {
          sizeAdjustCountRef.current += 1;
          const { renderer } = view as FoliateView;
          const viewSettings = getViewSettings(bookKey)!;
          const scrollRatio = renderer.viewSize / readingAxisSize;
          if (scrollRatio > 1.5) {
            if (viewSettings.vertical) {
              setResponsiveHeight(
                clipPopupHeight(Math.min(popupWidth * scrollRatio, getMaxHeight())),
              );
            } else {
              setResponsiveWidth(clipPopupWith(Math.min(popupWidth * scrollRatio, getMaxWidth())));
            }
          }
        }
        setShowPopup(true);
      });
    };

    footnoteHandler.addEventListener('before-render', handleBeforeRender);
    footnoteHandler.addEventListener('render', handleRender);
    return () => {
      footnoteHandler.removeEventListener('before-render', handleBeforeRender);
      footnoteHandler.removeEventListener('render', handleRender);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (showPopup) {
      containerRef.current?.focus();
    }
  }, [showPopup]);

  // A tap on a highlighted link opens the highlight's toolbar at the same word
  // as this popup; tell it which side is taken so the two don't stack (#6390).
  const anchorDir = showPopup ? (trianglePosition?.dir ?? null) : null;
  useEffect(() => {
    eventDispatcher.dispatch('footnote-popup-anchor', { key: bookKey, dir: anchorDir });
  }, [bookKey, anchorDir]);

  useEffect(() => {
    if (!showPopup) seedPopupSize(viewSettings.vertical);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSettings, showPopup]);

  useEffect(() => {
    const onToolbarBlock = (event: CustomEvent) => {
      const { key, block } = event.detail as {
        key: string;
        block: { dir: Position['dir']; size: number } | null;
      };
      if (key === bookKey && block) setToolbarBlock(block);
    };
    eventDispatcher.on('annotation-toolbar-block', onToolbarBlock);
    return () => eventDispatcher.off('annotation-toolbar-block', onToolbarBlock);
  }, [bookKey]);

  // The room the popup measured itself against moves with the anchor.
  useEffect(() => {
    if (!anchor) return;
    trianglePositionRef.current = anchor;
    const view = footnoteViewRef.current;
    if (showPopup && view) fitPopupToContent(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  useEffect(() => {
    if (anchor && popupBounds) {
      // The anchor is in cell coordinates; getPopupPosition works relative
      // to the bounds' origin, so shift there and back (a no-op off the Duo).
      const { rect, origin } = popupBounds;
      const popupPos = getPopupPosition(
        offsetPosition(anchor, { x: -origin.x, y: -origin.y }),
        rect,
        responsiveWidth,
        responsiveHeight,
        popupPadding,
      );
      setPopupPosition(offsetPosition(popupPos, origin));
    }
  }, [anchor, popupBounds, responsiveWidth, responsiveHeight, popupPadding]);

  const docLinkHandler = async (event: Event) => {
    const detail = (event as CustomEvent).detail;
    // console.log('doc link click', detail);
    const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
    if (!gridFrame) return;
    // On iPhone Duo clamp to the safe region, not the physical cell: its
    // status-bar strip can otherwise sit under a popup (#6307).
    const bounds = getPopupBounds(
      gridFrame.getBoundingClientRect(),
      gridInsetsRef.current,
      useThemeStore.getState().isIPhoneDuo,
    );
    const viewSettings = getViewSettings(bookKey)!;
    const triangPos = offsetPosition(
      getPosition(detail.a, bounds.rect, popupPadding, viewSettings.vertical),
      bounds.origin,
    );
    stopTrackingPopupContentSize();
    seedPopupSize(viewSettings.vertical);
    setPopupBounds(bounds);
    setTrianglePosition(triangPos);
    trianglePositionRef.current = triangPos;

    const { a: anchor } = detail as { a: HTMLAnchorElement };
    const footnoteClasses = ['duokan-footnote', 'footnote-link', 'footnote'];
    if (footnoteClasses.some((cls) => anchor.classList.contains(cls))) {
      detail['follow'] = true;
    }
    if (shouldCheckAsFootnote(anchor)) {
      detail['check'] = true;
    }
    historyRef.current = { items: [detail], index: 0 };
    setCanGoBack(false);
    setToolbarBlock(null);
    const popupPromise = footnoteHandler.handle(bookDoc, event);
    if (popupPromise) {
      popupPromise.catch((err: unknown) => {
        console.warn(err);
        const detail = (event as CustomEvent).detail;
        view?.goTo(detail.href);
        flashLinkTarget(detail.href);
      });
    } else if (!event.defaultPrevented) {
      // Not handled as a footnote: foliate's default link handling will
      // navigate in-page.
      flashLinkTarget(detail.href);
    }
  };

  const handleBack = () => {
    const history = historyRef.current;
    if (history.index <= 0) return;
    const newIndex = history.index - 1;
    historyRef.current = { ...history, index: newIndex };
    setCanGoBack(newIndex > 0);
    const detail = history.items[newIndex]!;
    const syntheticEvent = new CustomEvent('link', {
      detail: { ...detail, follow: true },
      cancelable: true,
    });
    footnoteHandler.handle(bookDoc, syntheticEvent);
  };

  // Leave the popup for the real page it stands in for: a link to an appendix
  // or a long section only ever extracts as its heading, and a note's backlink
  // is worth following to its surrounding context (#5766).
  const handleGoToSource = () => {
    const href = sourceHref;
    handleDismissPopup();
    if (!href) return;
    view?.goTo(href);
    flashLinkTarget(href);
  };

  const closePopup = () => {
    const view = footnoteRef.current?.querySelector('foliate-view') as FoliateView;
    view?.close();
    view?.remove();
  };

  const handleDismissPopup = () => {
    closePopup();
    stopTrackingPopupContentSize();
    resetPopupAnnotationState();
    historyRef.current = { items: [], index: -1 };
    sizeAdjustCountRef.current = 0;
    trianglePositionRef.current = null;
    setCanGoBack(false);
    setPopupBounds(null);
    setPopupPosition(null);
    setTrianglePosition(null);
    setToolbarBlock(null);
    setResponsiveWidth(popupWidth);
    setResponsiveHeight(popupHeight);
    setShowPopup(false);
    setSourceHref(null);
  };

  // Handle custom footnote popup event from iframe event
  const handleFootnotePopupEvent = (event: CustomEvent) => {
    const { element, footnote } = event.detail;
    const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
    if (!gridFrame) return;
    // This popup shows text synthesized from a data/alt attribute in the host
    // document: there is no book document behind it, so no CFI mapping.
    footnoteViewRef.current = null;
    setSourceHref(null);
    stopTrackingPopupContentSize();
    resetPopupAnnotationState();
    const bounds = getPopupBounds(
      gridFrame.getBoundingClientRect(),
      gridInsetsRef.current,
      useThemeStore.getState().isIPhoneDuo,
    );
    const viewSettings = getViewSettings(bookKey)!;
    const triangPos = offsetPosition(
      getPosition(element, bounds.rect, popupPadding, viewSettings.vertical),
      bounds.origin,
    );
    const seed = seedPopupSize(viewSettings.vertical);
    if (footnoteRef.current) {
      const elem = document.createElement('p');
      elem.textContent = footnote;
      elem.setAttribute('style', `padding: 1em; hanging-punctuation: allow-end last;`);
      // The note sits in the host document, outside the book iframe, so it
      // takes the reader's typography rather than the app's (#3602).
      elem.style.fontFamily = getBaseFontFamily(viewSettings);
      elem.style.fontSize = `${getBaseFontSize(viewSettings)}px`;
      elem.style.lineHeight = `${viewSettings.lineHeight}`;
      elem.style.fontWeight = `${viewSettings.fontWeight}`;
      // Measure the text in the room the popup actually gives it — the seed
      // less the container border — so the paragraph wraps identically once
      // mounted (#5999).
      const fitToNote = () => {
        const probe = elem.cloneNode(true) as HTMLElement;
        probe.style.visibility = 'hidden';
        if (viewSettings.vertical) {
          probe.style.height = `${seed.height - 2 * popupBorder}px`;
        } else {
          probe.style.width = `${seed.width - 2 * popupBorder}px`;
        }
        document.body.appendChild(probe);
        const popupSize = probe.getBoundingClientRect();
        probe.remove();
        if (viewSettings.vertical) {
          setResponsiveWidth(getResponsivePopupSize(popupSizeForContent(popupSize.width), true));
        } else {
          setResponsiveHeight(getResponsivePopupSize(popupSizeForContent(popupSize.height), false));
        }
      };
      fitToNote();
      // Laying the note out starts loading the reader font in this document,
      // and the fallback face it was measured in wraps it differently.
      if (document.fonts?.status === 'loading') {
        document.fonts.ready.then(() => {
          if (elem.isConnected) fitToNote();
        });
      }

      footnoteRef.current.replaceChildren(elem);
      setPopupBounds(bounds);
      setTrianglePosition(triangPos);
      trianglePositionRef.current = triangPos;
      setShowPopup(true);
    }
  };

  useFoliateEvents(view, {
    onLinkClick: docLinkHandler,
  });

  useEffect(() => {
    // Android fires a resize when the soft keyboard comes up without the
    // window changing width, which closed the popup under the note editor a
    // highlight in it had opened (#6390). Only a width change (rotation, a
    // window resize) moves the anchor out from under the popup.
    let windowWidth = window.innerWidth;
    const handleResize = () => {
      if (window.innerWidth === windowWidth) return;
      windowWidth = window.innerWidth;
      handleDismissPopup();
    };
    window.addEventListener('resize', handleResize);
    eventDispatcher.on('footnote-popup', handleFootnotePopupEvent);
    return () => {
      window.removeEventListener('resize', handleResize);
      eventDispatcher.off('footnote-popup', handleFootnotePopupEvent);
      stopTrackingPopupContentSize();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (footnoteViewRef.current) {
      footnoteRef.current?.replaceChildren(footnoteViewRef.current);
    }
  }, [footnoteRef]);

  // Draws a booknote's overlays in the popup document when its CFI maps into
  // the extracted fragment, restyling or moving the ones already drawn. A
  // unified record draws two overlays like in the main view: the highlight
  // (value = local cfi, keyed by id) and the note bubble (value = NOTE_PREFIX +
  // local cfi, keyed by `id#note`). Returns the keys it drew.
  const drawPopupNote = (note: BookNote): string[] => {
    const view = footnoteViewRef.current;
    const info = popupMapRef.current;
    const doc = info?.doc;
    if (!view || !doc || !info.extract) return [];
    const value = getFootnoteLocalCfi(note.cfi, info.extract, doc);
    if (!value) return [];
    const drawn = drawnNotesRef.current;
    const upsert = (key: string, value: string) => {
      const prev = drawn.get(key);
      if (prev && prev.updatedAt === note.updatedAt && prev.value === value) return;
      if (prev && prev.value !== value) {
        view.addAnnotation({ ...note, value: prev.value }, true);
      }
      view.addAnnotation({ ...note, value });
      drawn.set(key, { value, updatedAt: note.updatedAt });
    };
    const keys: string[] = [];
    if (note.style) {
      upsert(note.id, value);
      keys.push(note.id);
    }
    if (note.note) {
      upsert(`${note.id}#note`, `${NOTE_PREFIX}${value}`);
      keys.push(`${note.id}#note`);
    }
    return keys;
  };

  // Only notes anchored in the popup's own section can map into it. Compare
  // spine prefixes (id assertions stripped, since a foreign/imported CFI may
  // spell them differently) as a pure string check, which also spares a heavy
  // library the parse and DOM work inside getFootnoteLocalCfi.
  const stripAssertions = (prefix: string | null) => prefix?.replace(/\[[^\]]*\]/g, '') ?? null;
  const getPopupSectionPrefix = () => {
    const view = footnoteViewRef.current;
    const info = popupMapRef.current;
    return view && info ? stripAssertions(getCfiSpinePrefix(view.getCFI(info.index))) : null;
  };
  const isInPopupSection = (note: BookNote, sectionPrefix: string | null) =>
    !sectionPrefix || stripAssertions(getCfiSpinePrefix(note.cfi)) === sectionPrefix;

  // Mirror the book's highlight annotations into the popup document: draw the
  // ones whose CFIs map into the extracted fragment, keep them in sync as the
  // user highlights/restyles/deletes via the selection toolbar, and remove
  // overlays whose records are gone. The popup view resolves the mapped local
  // CFI itself and calls the draw-annotation listener registered above.
  useEffect(() => {
    const view = footnoteViewRef.current;
    const info = popupMapRef.current;
    if (!showPopup || !view || !info?.doc || !info.extract) return;
    const drawn = drawnNotesRef.current;
    const seen = new Set<string>();
    const sectionPrefix = getPopupSectionPrefix();
    for (const note of booknotes ?? []) {
      if (note.type !== 'annotation' || note.deletedAt || (!note.style && !note.note)) continue;
      if (!isInPopupSection(note, sectionPrefix)) continue;
      drawPopupNote(note).forEach((key) => seen.add(key));
    }
    for (const [key, prev] of drawn) {
      if (seen.has(key)) continue;
      view.addAnnotation({ value: prev.value } as BookNote & { value: string }, true);
      drawn.delete(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booknotes, showPopup, popupContentEpoch]);

  // A highlight whose range handles are being dragged in the popup is only
  // saved on release; follow the drag here meanwhile (#6390). A preview is
  // sent after an await, so it can land once the popup shows another section.
  useEffect(() => {
    const onPreview = (event: CustomEvent) => {
      const { key, note } = event.detail as { key: string; note: BookNote };
      if (key !== bookKey || !isInPopupSection(note, getPopupSectionPrefix())) return;
      drawPopupNote(note);
    };
    eventDispatcher.on('footnote-annotation-preview', onPreview);
    return () => eventDispatcher.off('footnote-annotation-preview', onPreview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  // Data-attribute footnotes render a plain <p> in the host document; watch
  // the host selection while such a popup is open and surface it to the
  // Annotator (without a CFI — synthesized text has no anchor in the book).
  useEffect(() => {
    if (!showPopup) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let hadSelection = false;
    const report = () => {
      if (footnoteViewRef.current) return; // a real footnote popup owns its own doc
      const container = footnoteRef.current;
      const sel = document.getSelection();
      if (!container || !sel) return;
      const range = sel.isCollapsed || !sel.toString().trim() ? null : sel.getRangeAt(0);
      if (range && container.contains(range.commonAncestorContainer)) {
        hadSelection = true;
        eventDispatcher.dispatch('footnote-selection', { key: bookKey, range, index: -1 });
      } else if (hadSelection) {
        hadSelection = false;
        eventDispatcher.dispatch('footnote-selection', { key: bookKey });
      }
    };
    const onSelectionChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(report, 250);
    };
    // Report the finished drag immediately instead of waiting out the debounce,
    // matching the popup-document path.
    const onPointerUp = () => {
      if (timer) clearTimeout(timer);
      report();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerup', onPointerUp);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerup', onPointerUp);
    };
  }, [showPopup, bookKey]);

  return (
    <div ref={containerRef} role='toolbar' tabIndex={-1}>
      {showPopup && <Overlay onDismiss={handleDismissPopup} />}
      {/* The note's text is selectable, so the selection toolbar and the range
          handles open against a selection that lives inside this popup — they
          have to draw over it, exactly as they do over the book page. That used
          to fall out of DOM order (BooksGrid mounts Annotator after this) while
          both surfaces were z-50, until #6036 moved the toolbar into its own
          `z-[43]` band and this popup's z-50 buried it along with the
          dictionary button (#6145). So this popup gets a band of its own:
          below the toolbar (z-[43]) and the handles (z-[44]), above the
          paragraph overlay and the TTS mini player (z-40). The lookup popups
          opened from the toolbar stay at z-50 and still cover the note.

          `absolute`, never `fixed`: the popup's coordinates are book-cell
          relative, and the cell is its `relative` ancestor, so insetting the
          wrapper to the cell makes the stacking context without moving
          anything. `pointer-events-none` keeps the cell-covering wrapper from
          swallowing the outside taps the Overlay above dismisses on. */}
      <div className='pointer-events-none absolute inset-0 z-[42]'>
        <Popup
          isOpen={showPopup}
          width={responsiveWidth}
          height={responsiveHeight}
          position={showPopup ? popupPosition! : undefined}
          trianglePosition={showPopup ? anchor! : undefined}
          // Scroll along the note's block axis and clip the other one. A note
          // that wraps can never need a horizontal scrollbar, but leaving that
          // axis `visible` promotes it to `auto` (CSS resolves `visible` to
          // `auto` next to a non-`visible` value), so any stray pixel of
          // cross-axis overflow bought a second scrollbar (#5999).
          className={clsx(
            'select-text pointer-events-auto',
            viewSettings.vertical
              ? 'overflow-x-auto overflow-y-hidden'
              : 'overflow-y-auto overflow-x-hidden',
          )}
          onDismiss={handleDismissPopup}
        >
          {canGoBack && (
            // The chrome floats over the text rather than pushing it down, so
            // the strip must not swallow taps meant for the words beneath it.
            <div
              className={clsx(
                'pointer-events-none absolute z-10 flex gap-1',
                viewSettings.vertical
                  ? 'bottom-2 end-2 top-2 w-8 flex-col items-end'
                  : 'end-2 start-2 top-2 h-8 flex-row items-start',
              )}
            >
              <button
                type='button'
                onClick={handleBack}
                aria-label={_('Back')}
                title={_('Back')}
                className={clsx(chromeButtonClassName, 'pointer-events-auto')}
              >
                <MdArrowBack size={size18} />
              </button>
            </div>
          )}
          {sourceHref && (
            // Park it where the note's last line runs out instead of over its
            // opening words (#5998). Physical sides, not logical ones: the corner
            // follows the book's own direction, which the popup's `dir` (the UI
            // language) does not track.
            <button
              type='button'
              onClick={handleGoToSource}
              aria-label={_('Jump to Location')}
              title={_('Jump to Location')}
              className={clsx(
                chromeButtonClassName,
                'absolute bottom-2 z-10',
                viewSettings.vertical || viewSettings.rtl ? 'left-2' : 'right-2',
              )}
            >
              <MdOutlineArrowOutward size={size18} />
            </button>
          )}
          {/* Fill the popup's content box rather than restating its border-box
              size, which overflowed it by the border on both axes (#5999). */}
          <div className='footnote-content h-full w-full' ref={footnoteRef}></div>
        </Popup>
      </div>
    </div>
  );
};

export default FootnotePopup;
