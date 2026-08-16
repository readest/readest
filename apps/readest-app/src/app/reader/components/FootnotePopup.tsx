import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MdArrowBack } from 'react-icons/md';

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
import { getFootnoteStyles, getStyles, getThemeCode } from '@/utils/style';
import { getPopupPosition, getPosition, Position } from '@/utils/sel';
import { FootnoteHandler } from 'foliate-js/footnotes.js';
import { mountAdditionalFonts, mountCustomFont } from '@/styles/fonts';
import { eventDispatcher } from '@/utils/event';
import { getCfiSpinePrefix } from '@/utils/cfi';
import { shouldCheckAsFootnote } from '../utils/footnoteHeuristics';
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
}

const popupWidth = 360;
const popupHeight = 88;

const FootnotePopup: React.FC<FootnotePopupProps> = ({ bookKey, bookDoc }) => {
  const footnoteRef = useRef<HTMLDivElement>(null);
  const footnoteViewRef = useRef<FoliateView | null>(null);
  const trianglePositionRef = useRef<Position | null>(null);
  const [trianglePosition, setTrianglePosition] = useState<Position | null>();
  const [popupPosition, setPopupPosition] = useState<Position | null>();
  const [showPopup, setShowPopup] = useState(false);

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
  const canGoBackRef = useRef(canGoBack);
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

  const [gridRect, setGridRect] = useState<DOMRect | null>(null);
  const [responsiveWidth, setResponsiveWidth] = useState(popupWidth);
  const [responsiveHeight, setResponsiveHeight] = useState(popupHeight);
  const sizeAdjustCountRef = useRef(0);
  const maxSizeAdjustCount = 3;
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
        canGoBackRef.current = true;
        footnoteHandler.handle(bookDoc, e)?.catch((err) => {
          console.warn(err);
          getView(bookKey)?.goTo(popupLinkDetail.href);
          flashLinkTarget(popupLinkDetail.href);
          setShowPopup(false);
        });
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
        const report = () => {
          if (!doc.defaultView) return; // popup already torn down
          const sel = doc.getSelection();
          if (!sel || sel.isCollapsed || !sel.toString().trim()) {
            eventDispatcher.dispatch('footnote-selection', { key: bookKey });
            return;
          }
          const range = sel.getRangeAt(0);
          const info = popupMapRef.current;
          const extract = info && info.index === index ? info.extract : null;
          const cfi = extract
            ? (getFootnoteSelectionCfi(range, extract, popupView.getCFI(index)) ?? undefined)
            : undefined;
          eventDispatcher.dispatch('footnote-selection', {
            key: bookKey,
            range,
            index,
            cfi,
            href: footnoteHrefRef.current?.split('#')[0],
          });
        };
        let selectionTimer: ReturnType<typeof setTimeout> | null = null;
        doc.addEventListener('selectionchange', () => {
          if (selectionTimer) clearTimeout(selectionTimer);
          selectionTimer = setTimeout(report, 250);
        });
        doc.addEventListener('pointerup', () => {
          if (selectionTimer) clearTimeout(selectionTimer);
          report();
        });
        if (appService?.isMobile) {
          // Same as the main view: the selection handles suffice on mobile.
          doc.addEventListener('contextmenu', (ev: Event) => ev.preventDefault());
        }

        const info = popupMapRef.current;
        if (info && info.index === index) {
          popupMapRef.current = { ...info, doc };
        }
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
        });
      });
      footnoteViewRef.current = popupView;
      footnoteRef.current?.replaceChildren(popupView);
      const { renderer } = popupView;
      const viewSettings = getViewSettings(bookKey)!;
      const backButtonMargin = canGoBackRef.current ? 32 : 0;
      renderer.setAttribute('flow', 'scrolled');
      renderer.setAttribute('no-preload', '');
      renderer.setAttribute('no-background', '');
      renderer.setAttribute('margin-top', `${viewSettings.vertical ? 0 : backButtonMargin}px`);
      renderer.setAttribute('margin-right', `${viewSettings.vertical ? backButtonMargin : 0}px`);
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
      resetPopupAnnotationState({ index: index ?? -1, extract: extract ?? null });
      sizeAdjustCountRef.current = 0;
      view.addEventListener('relocate', () => {
        if (sizeAdjustCountRef.current >= maxSizeAdjustCount) return;
        sizeAdjustCountRef.current += 1;
        const { renderer } = view as FoliateView;
        const viewSettings = getViewSettings(bookKey)!;
        if (viewSettings.vertical) {
          const responsiveWidth = clipPopupWith(
            Math.min(getResponsivePopupSize(renderer.viewSize, true), getMaxWidth()),
          );
          setResponsiveWidth(responsiveWidth);
          const scrollRatio = renderer.viewSize / responsiveWidth;
          if (scrollRatio > 1.5) {
            setResponsiveHeight(
              clipPopupHeight(Math.min(popupWidth * scrollRatio, getMaxHeight())),
            );
          }
        } else {
          const responsiveHeight = clipPopupHeight(
            Math.min(getResponsivePopupSize(renderer.viewSize, false), getMaxHeight()),
          );
          setResponsiveHeight(responsiveHeight);
          const scrollRatio = renderer.viewSize / responsiveHeight;
          if (scrollRatio > 1.5) {
            setResponsiveWidth(clipPopupWith(Math.min(popupWidth * scrollRatio, getMaxWidth())));
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

  useEffect(() => {
    if (viewSettings.vertical) {
      setResponsiveWidth(clipPopupWith(popupHeight));
      setResponsiveHeight(clipPopupHeight(Math.max(popupWidth, window.innerHeight / 4)));
    } else {
      setResponsiveWidth(clipPopupWith(Math.max(popupWidth, window.innerWidth / 4)));
      setResponsiveHeight(clipPopupHeight(popupHeight));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSettings, trianglePosition]);

  useEffect(() => {
    if (trianglePosition && gridRect) {
      const popupPos = getPopupPosition(
        trianglePosition,
        gridRect,
        responsiveWidth,
        responsiveHeight,
        popupPadding,
      );
      setPopupPosition(popupPos);
    }
  }, [trianglePosition, gridRect, responsiveWidth, responsiveHeight, popupPadding]);

  const docLinkHandler = async (event: Event) => {
    const detail = (event as CustomEvent).detail;
    // console.log('doc link click', detail);
    const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
    if (!gridFrame) return;
    const rect = gridFrame.getBoundingClientRect();
    const viewSettings = getViewSettings(bookKey)!;
    const triangPos = getPosition(detail.a, rect, popupPadding, viewSettings.vertical);
    setGridRect(rect);
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
    canGoBackRef.current = false;
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
    canGoBackRef.current = newIndex > 0;
    const detail = history.items[newIndex]!;
    const syntheticEvent = new CustomEvent('link', {
      detail: { ...detail, follow: true },
      cancelable: true,
    });
    footnoteHandler.handle(bookDoc, syntheticEvent);
  };

  const closePopup = () => {
    const view = footnoteRef.current?.querySelector('foliate-view') as FoliateView;
    view?.close();
    view?.remove();
  };

  const handleDismissPopup = () => {
    closePopup();
    resetPopupAnnotationState();
    historyRef.current = { items: [], index: -1 };
    canGoBackRef.current = false;
    sizeAdjustCountRef.current = 0;
    trianglePositionRef.current = null;
    setCanGoBack(false);
    setGridRect(null);
    setPopupPosition(null);
    setTrianglePosition(null);
    setResponsiveWidth(popupWidth);
    setResponsiveHeight(popupHeight);
    setShowPopup(false);
  };

  // Handle custom footnote popup event from iframe event
  const handleFootnotePopupEvent = (event: CustomEvent) => {
    const { element, footnote } = event.detail;
    const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
    if (!gridFrame) return;
    // This popup shows text synthesized from a data/alt attribute in the host
    // document: there is no book document behind it, so no CFI mapping.
    footnoteViewRef.current = null;
    resetPopupAnnotationState();
    const rect = gridFrame.getBoundingClientRect();
    const viewSettings = getViewSettings(bookKey)!;
    const triangPos = getPosition(element, rect, popupPadding, viewSettings.vertical);
    if (footnoteRef.current) {
      const elem = document.createElement('p');
      elem.textContent = footnote;
      elem.setAttribute('style', `padding: 1em; hanging-punctuation: allow-end last;`);
      elem.style.visibility = 'hidden';
      if (viewSettings.vertical) {
        elem.style.height = `${responsiveHeight}px`;
      } else {
        elem.style.width = `${responsiveWidth}px`;
      }
      document.body.appendChild(elem);
      const popupSize = elem.getBoundingClientRect();
      if (viewSettings.vertical) {
        setResponsiveWidth(getResponsivePopupSize(popupSize.width, true));
      } else {
        setResponsiveHeight(getResponsivePopupSize(popupSize.height, false));
      }
      document.body.removeChild(elem);

      elem.style.visibility = 'visible';
      footnoteRef.current.replaceChildren(elem);
      setGridRect(rect);
      setTrianglePosition(triangPos);
      trianglePositionRef.current = triangPos;
      setShowPopup(true);
    }
  };

  useFoliateEvents(view, {
    onLinkClick: docLinkHandler,
  });

  useEffect(() => {
    window.addEventListener('resize', handleDismissPopup);
    eventDispatcher.on('footnote-popup', handleFootnotePopupEvent);
    return () => {
      window.removeEventListener('resize', handleDismissPopup);
      eventDispatcher.off('footnote-popup', handleFootnotePopupEvent);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (footnoteViewRef.current) {
      footnoteRef.current?.replaceChildren(footnoteViewRef.current);
    }
  }, [footnoteRef]);

  // Mirror the book's highlight annotations into the popup document: draw the
  // ones whose CFIs map into the extracted fragment, keep them in sync as the
  // user highlights/restyles/deletes via the selection toolbar, and remove
  // overlays whose records are gone. The popup view resolves the mapped local
  // CFI itself and calls the draw-annotation listener registered above.
  useEffect(() => {
    const view = footnoteViewRef.current;
    const info = popupMapRef.current;
    const doc = info?.doc;
    if (!showPopup || !view || !doc || !info.extract) return;
    const drawn = drawnNotesRef.current;
    const seen = new Set<string>();
    // A unified record draws two overlays like in the main view: the
    // highlight (value = local cfi, keyed by id) and the note bubble
    // (value = NOTE_PREFIX + local cfi, keyed by `id#note`).
    const upsert = (key: string, value: string, note: BookNote) => {
      seen.add(key);
      const prev = drawn.get(key);
      if (prev && prev.updatedAt === note.updatedAt && prev.value === value) return;
      if (prev && prev.value !== value) {
        view.addAnnotation({ ...note, value: prev.value }, true);
      }
      view.addAnnotation({ ...note, value });
      drawn.set(key, { value, updatedAt: note.updatedAt });
    };
    // Only notes anchored in the popup's own section can map into it, and a
    // heavy library carries thousands elsewhere. Reject those with a pure
    // string compare of the spine prefix (id assertions stripped, since a
    // foreign/imported CFI may spell them differently) before paying for the
    // parse and DOM work inside getFootnoteLocalCfi.
    const stripAssertions = (prefix: string | null) => prefix?.replace(/\[[^\]]*\]/g, '') ?? null;
    const sectionPrefix = stripAssertions(getCfiSpinePrefix(view.getCFI(info.index)));
    for (const note of booknotes ?? []) {
      if (note.type !== 'annotation' || note.deletedAt || (!note.style && !note.note)) continue;
      if (sectionPrefix && stripAssertions(getCfiSpinePrefix(note.cfi)) !== sectionPrefix) continue;
      const value = getFootnoteLocalCfi(note.cfi, info.extract, doc);
      if (!value) continue;
      if (note.style) upsert(note.id, value, note);
      if (note.note) upsert(`${note.id}#note`, `${NOTE_PREFIX}${value}`, note);
    }
    for (const [key, prev] of drawn) {
      if (seen.has(key)) continue;
      view.addAnnotation({ value: prev.value } as BookNote & { value: string }, true);
      drawn.delete(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booknotes, showPopup, popupContentEpoch]);

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
      <Popup
        isOpen={showPopup}
        width={responsiveWidth}
        height={responsiveHeight}
        position={showPopup ? popupPosition! : undefined}
        trianglePosition={showPopup ? trianglePosition! : undefined}
        className='select-text overflow-y-auto'
        onDismiss={handleDismissPopup}
      >
        {canGoBack && (
          <div
            className={clsx(
              'absolute flex h-8 w-full pt-2',
              viewSettings.vertical ? 'justify-end pe-2' : 'justify-start ps-2',
            )}
          >
            <button
              type='button'
              onClick={handleBack}
              className={clsx(
                'btn btn-ghost btn-circle eink-bordered text-base-content bg-base-200/80 hover:bg-base-200',
                'z-10 h-8 min-h-8 w-8 p-0 shadow-sm',
              )}
            >
              <MdArrowBack size={size18} />
            </button>
          </div>
        )}
        <div
          className='footnote-content'
          ref={footnoteRef}
          style={{
            width: `${responsiveWidth}px`,
            height: `${responsiveHeight}px`,
          }}
        ></div>
      </Popup>
    </div>
  );
};

export default FootnotePopup;
