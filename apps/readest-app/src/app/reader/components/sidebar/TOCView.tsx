import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useOverlayScrollbars } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';

import { BookDoc, TOCItem } from '@/libs/document';
import { BookProgress } from '@/types/book';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { getChapterScreensVersion, subscribeChapterScreens } from '@/utils/chapterScreens';
import {
  getLocationScreenPages,
  getScreenPageInfo,
  usesScreenPages,
} from '../../utils/screenPages';
import { useTextTranslation } from '../../hooks/useTextTranslation';
import {
  buildTOCDisplayItems,
  CurrentPositionRow,
  isCurrentPositionItem,
  isPageThumbnailsItem,
  StaticListRow,
  TOCDisplayItem,
  TOCListItem,
} from './TOCItem';
import { PageThumbnailsRow } from './PageThumbnails';
import {
  buildPageThumbnailRows,
  computeExpandedSet,
  computeTOCPageRanges,
  findActiveRowIndex,
  flattenTOC,
  getItemIdentifier,
  getThumbnailsPerRow,
  getTOCKeyTarget,
  PageRange,
} from './tocTree';

const TREE_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'Enter',
]);

// The focused row: a heading, or 'current' for the "current position" row,
// whose object is rebuilt on every render.
type FocusedRow = TOCItem | 'current';

const getFocusedRow = (row: TOCDisplayItem): FocusedRow | null =>
  isCurrentPositionItem(row) ? 'current' : 'item' in row ? row.item : null;

// A PDF without an outline lists all of its pages instead.
const buildTOCListItems = (
  toc: TOCItem[],
  expandedItems: Set<string>,
  pageRanges: Map<TOCItem, PageRange> | undefined,
  totalPages: number,
  thumbnailsPerRow?: number,
): TOCListItem[] =>
  !toc.length && pageRanges
    ? buildPageThumbnailRows({ start: 0, end: totalPages }, 0, thumbnailsPerRow)
    : flattenTOC(toc, expandedItems, pageRanges, thumbnailsPerRow);

const setsHaveSameContents = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
};

const getInitialScrollTarget = (
  toc: TOCItem[],
  progress: BookProgress | null | undefined,
  pageRanges: Map<TOCItem, PageRange> | undefined,
  totalPages: number,
): { index: number; expanded: Set<string> } => {
  const href = progress?.sectionHref;
  const expanded = computeExpandedSet(toc, href);
  if (!progress) return { index: 0, expanded };
  const rows = buildTOCDisplayItems(
    buildTOCListItems(toc, expanded, pageRanges, totalPages),
    href ?? null,
    progress.page,
  );
  const idx = findActiveRowIndex(rows, href ?? null, pageRanges && progress.section?.current);
  return { index: idx > 0 ? idx : 0, expanded };
};

const TOCView: React.FC<{
  bookKey: string;
  bookDoc: BookDoc;
  toc: TOCItem[];
}> = ({ bookKey, bookDoc, toc }) => {
  const _ = useTranslation();
  const { getView, getViewSettings, getProgress } = useReaderStore();
  const { sideBarBookKey, isSideBarVisible } = useSidebarStore();
  const progress = useBookProgress(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const isEink = !!viewSettings?.isEink;

  // Fixed-layout formats that can render pages (PDF) unfold page thumbnails
  // under each TOC item, unless the reader turned them off for this book.
  const showThumbnails = !!bookDoc.getPageThumbnail && viewSettings?.showTOCThumbnails !== false;
  const totalPages = bookDoc.sections.length;
  const pageRanges = useMemo(
    () => (showThumbnails ? computeTOCPageRanges(toc, totalPages) : undefined),
    [showThumbnails, toc, totalPages],
  );
  const currentPage = pageRanges ? progress?.section?.current : undefined;

  const [initialScrollTarget] = useState(() =>
    getInitialScrollTarget(toc, progress, pageRanges, totalPages),
  );
  const [expandedItems, setExpandedItems] = useState<Set<string>>(initialScrollTarget.expanded);
  const [containerHeight, setContainerHeight] = useState(400);
  const [containerWidth, setContainerWidth] = useState(0);
  const thumbnailsPerRow = getThumbnailsPerRow(containerWidth);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const userScrolledRef = useRef(false);
  const scrollCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollRef = useRef(false);
  const visibleCenterRef = useRef(0);
  const initialScrollHandledRef = useRef(initialScrollTarget.index > 0);
  // Don't honor userScrolledRef before the first post-mount progress arrives.
  // With a pinned sidebar, TOCView mounts before FoliateViewer emits its
  // first relocate; if any programmatic scroll (e.g. OverlayScrollbars'
  // viewport-wrap scrollTop reset) flips userScrolledRef in that window it
  // would otherwise suppress the auto-scroll once progress finally arrives.
  const initialAutoScrollProcessedRef = useRef(false);
  // Mirror the latest active item + flat list so the OverlayScrollbars
  // `initialized` callback (created at mount but fired after a deferred,
  // timing-dependent delay) can re-center on the *current* reading position.
  const activeHrefRef = useRef<string | null>(null);
  const currentPageRef = useRef<number | undefined>(undefined);
  const displayItemsRef = useRef<TOCDisplayItem[]>([]);
  // True once the reader has genuinely driven the list (wheel/touch/pointer/
  // key). Auto-expanding the current volume on open grows the list and fires a
  // synthetic scroll event; without a real gesture behind it, that scroll must
  // not be mistaken for the user taking over and cancel the queued auto-scroll.
  const userInputRef = useRef(false);

  // OverlayScrollbars + Virtuoso integration (same pattern as Bookshelf)
  const osRootRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [initialize, osInstance] = useOverlayScrollbars({
    defer: true,
    options: { scrollbars: { autoHide: 'scroll' } },
    events: {
      initialized(instance) {
        const { viewport } = instance.elements();
        viewport.style.overflowX = 'var(--os-viewport-overflow-x)';
        viewport.style.overflowY = 'var(--os-viewport-overflow-y)';
        // OverlayScrollbars resets the wrapped viewport's scrollTop to 0 as it
        // initializes. On a fresh refresh the auto-scroll to the reading
        // position may already have run by now, so re-apply it here — using the
        // *current* active item, since initialScrollTarget was captured at mount
        // when progress was usually not yet available (index 0). Without this
        // the TOC rewinds to the very top on ~1 in 10 refreshes, depending on
        // whether this deferred init lands before or after the auto-scroll.
        const activeIdx = findActiveRowIndex(
          displayItemsRef.current,
          activeHrefRef.current,
          currentPageRef.current,
        );
        const target = activeIdx > 0 ? activeIdx : initialScrollTarget.index;
        if (target > 0) {
          requestAnimationFrame(() => {
            virtuosoRef.current?.scrollToIndex({
              index: target,
              align: 'center',
              behavior: 'auto',
            });
          });
        }
      },
    },
  });

  useEffect(() => {
    const root = osRootRef.current;
    if (scroller && root) {
      initialize({ target: root, elements: { viewport: scroller } });
    }
    return () => osInstance()?.destroy();
  }, [scroller, initialize, osInstance]);

  // Flag real user gestures so onScroll can tell them apart from the synthetic
  // scroll emitted when the current volume auto-expands on open.
  useEffect(() => {
    if (!scroller) return;
    const markUserInput = () => {
      userInputRef.current = true;
    };
    const passiveCapture = { capture: true, passive: true } as const;
    const capture = { capture: true } as const;
    scroller.addEventListener('wheel', markUserInput, passiveCapture);
    scroller.addEventListener('touchstart', markUserInput, passiveCapture);
    scroller.addEventListener('pointerdown', markUserInput, passiveCapture);
    scroller.addEventListener('keydown', markUserInput, capture);
    return () => {
      scroller.removeEventListener('wheel', markUserInput, passiveCapture);
      scroller.removeEventListener('touchstart', markUserInput, passiveCapture);
      scroller.removeEventListener('pointerdown', markUserInput, passiveCapture);
      scroller.removeEventListener('keydown', markUserInput, capture);
    };
  }, [scroller]);

  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    setScroller(el instanceof HTMLElement ? el : null);
  }, []);

  useTextTranslation(bookKey, containerRef.current, false, 'translation-target-toc');

  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerWidth(rect.width);
        const parentContainer = containerRef.current.closest('.scroll-container');
        if (parentContainer) {
          const parentRect = parentContainer.getBoundingClientRect();
          const availableHeight = parentRect.height - (rect.top - parentRect.top);
          setContainerHeight(Math.max(400, availableHeight));
        }
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      const parentContainer = containerRef.current.closest('.scroll-container');
      if (parentContainer) {
        resizeObserver = new ResizeObserver(updateHeight);
        resizeObserver.observe(parentContainer);
      }
    }
    return () => {
      window.removeEventListener('resize', updateHeight);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, []);

  const activeHref = progress?.sectionHref ?? null;
  const flatItems = useMemo(
    () => buildTOCListItems(toc, expandedItems, pageRanges, totalPages, thumbnailsPerRow),
    [toc, expandedItems, pageRanges, totalPages, thumbnailsPerRow],
  );
  // With Stable Page Numbers off, items and the current position count the
  // screen pages the footer shows.
  const isFixedLayout = useBookDataStore((s) => !!s.getBookData(bookKey)?.isFixedLayout);
  const screenPages = usesScreenPages(viewSettings, isFixedLayout, bookDoc.sections);
  const screensVersion = useSyncExternalStore(subscribeChapterScreens, getChapterScreensVersion);
  const locationScreenPages = useMemo(
    () => (screenPages ? getLocationScreenPages(bookKey, bookDoc.sections) : null),
    [screenPages, bookKey, bookDoc.sections, screensVersion],
  );
  const currentPageNumber =
    screenPages && progress
      ? getScreenPageInfo(bookKey, getView(bookKey), bookDoc.sections, progress).current + 1
      : progress?.page;
  // Inject a "current position" row under the active item showing the current
  // reading page.
  const displayItems = useMemo(
    () => buildTOCDisplayItems(flatItems, activeHref, currentPageNumber),
    [flatItems, activeHref, currentPageNumber],
  );
  // Keep the refs read by the OverlayScrollbars `initialized` callback current.
  activeHrefRef.current = activeHref;
  currentPageRef.current = currentPage;
  displayItemsRef.current = displayItems;

  const handleToggleExpand = useCallback((item: TOCItem) => {
    const itemId = getItemIdentifier(item);
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  }, []);

  const handleItemClick = useCallback(
    (item: TOCItem) => {
      eventDispatcher.dispatch('navigate', { bookKey, href: item.href });
      if (item.href) {
        getView(bookKey)?.goTo(item.href, { focus: true });
      }
    },
    [bookKey, getView],
  );

  const handlePageClick = useCallback(
    (page: number) => {
      eventDispatcher.dispatch('navigate', { bookKey, index: page });
      getView(bookKey)?.goTo(page);
    },
    [bookKey, getView],
  );

  const handleCurrentPositionClick = useCallback(() => {
    const location = getProgress(bookKey)?.location;
    if (!location) return;
    eventDispatcher.dispatch('navigate', { bookKey, cfi: location });
    getView(bookKey)?.goTo(location, { focus: true });
  }, [bookKey, getView, getProgress]);

  // The list is one Tab stop. Keys move a focus marker between rows
  // (aria-activedescendant) rather than DOM focus, so it survives Virtuoso
  // unmounting rows. It follows the row itself, not its index, as rows above it
  // fold and unfold; it starts on the current chapter.
  const treeId = useId();
  const [focusedRow, setFocusedRow] = useState<FocusedRow | null>(null);
  const startIndex = useMemo(() => {
    const idx = displayItems.findIndex((row) => 'item' in row && row.item.href === activeHref);
    return idx !== -1 ? idx : displayItems.findIndex((row) => !isPageThumbnailsItem(row));
  }, [displayItems, activeHref]);
  const focusIndex = useMemo(() => {
    const idx = focusedRow
      ? displayItems.findIndex((row) => getFocusedRow(row) === focusedRow)
      : -1;
    return idx !== -1 ? idx : startIndex;
  }, [displayItems, focusedRow, startIndex]);
  // A PDF without an outline lists only thumbnails, buttons of their own.
  const hasRows = focusIndex !== -1;

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const row = displayItems[focusIndex];
    if (!row || event.target !== event.currentTarget || !TREE_KEYS.has(event.key)) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // Keep the keys from the reader's shortcuts, which would turn the page.
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Enter') {
      if (isCurrentPositionItem(row)) handleCurrentPositionClick();
      else if ('item' in row && row.item.href) handleItemClick(row.item);
      return;
    }
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const target = getTOCKeyTarget(displayItems, focusIndex, event.key, rtl);
    if (!target) return;
    if ('toggle' in target) {
      handleToggleExpand(target.toggle.item);
    } else {
      setFocusedRow(getFocusedRow(displayItems[target.focus]!));
      virtuosoRef.current?.scrollIntoView({ index: target.focus });
    }
  };

  // Only the keyboard focuses the list (see handleTreeMouseDown), so entering
  // it starts on the current chapter and brings that row into view.
  const handleTreeFocus = (event: React.FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setFocusedRow(null);
    if (startIndex !== -1) virtuosoRef.current?.scrollIntoView({ index: startIndex });
  };

  // A click opens a chapter or folds a heading without taking keyboard focus,
  // so the arrow keys keep turning the book's pages.
  const handleTreeMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (event.button === 0) event.preventDefault();
  };

  useEffect(() => {
    if (!isSideBarVisible || sideBarBookKey !== bookKey) {
      userScrolledRef.current = false;
      pendingScrollRef.current = false;
      initialAutoScrollProcessedRef.current = false;
      return;
    }
    if (userScrolledRef.current && initialAutoScrollProcessedRef.current) return;
    setExpandedItems((prev) => {
      const next = computeExpandedSet(toc, progress?.sectionHref);
      return setsHaveSameContents(prev, next) ? prev : next;
    });
    if (progress?.sectionHref || currentPage !== undefined) {
      if (initialScrollHandledRef.current) {
        initialScrollHandledRef.current = false;
      } else {
        pendingScrollRef.current = true;
      }
      initialAutoScrollProcessedRef.current = true;
    }
  }, [isSideBarVisible, sideBarBookKey, bookKey, toc, progress, currentPage]);

  // Resizing the TOC reflows the thumbnail rows; bring the current page back
  // into view unless the reader has scrolled elsewhere.
  const thumbnailsPerRowRef = useRef(thumbnailsPerRow);
  useEffect(() => {
    if (thumbnailsPerRowRef.current === thumbnailsPerRow) return;
    thumbnailsPerRowRef.current = thumbnailsPerRow;
    if (pageRanges && !userScrolledRef.current) pendingScrollRef.current = true;
  }, [thumbnailsPerRow, pageRanges]);

  useEffect(() => {
    if (!pendingScrollRef.current || !isSideBarVisible) return;
    const idx = findActiveRowIndex(displayItems, activeHref, currentPage);
    if (idx === -1) {
      // The active section's parents were just queued to expand by the
      // post-mount progress effect above — displayItems still reflects the
      // pre-update expandedItems. Leave pendingScrollRef set so this
      // effect retries on the next render once displayItems contains the
      // active section. Clearing it here would strand the scroll.
      return;
    }
    // Eink displays ghost previous frames during smooth JS scroll
    // animations; force an instant jump to avoid the artifact. A CSS-only
    // fix is impossible because scrollTo({ behavior: 'smooth' }) overrides
    // CSS scroll-behavior and is not a CSS transition.
    const distance = Math.abs(idx - visibleCenterRef.current);
    const behavior = isEink || distance > 16 ? 'auto' : 'smooth';
    virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior });
    // When the current volume auto-expands on open, the list grows by dozens of
    // rows in this same commit. Virtuoso scrolls before measuring the new rows,
    // so a single scrollToIndex lands short. Re-assert on the next frame (once
    // they're measured) for the instant-jump case so the chapter ends centered.
    if (behavior === 'auto') {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior: 'auto' });
      });
    }
    pendingScrollRef.current = false;
  }, [displayItems, activeHref, currentPage, isSideBarVisible, isEink]);

  return (
    <div ref={containerRef} className='toc-list rounded-sm'>
      <div ref={osRootRef} data-overlayscrollbars-initialize='' style={{ height: containerHeight }}>
        <Virtuoso
          ref={virtuosoRef}
          scrollerRef={handleScrollerRef}
          role={hasRows ? 'tree' : undefined}
          aria-label={hasRows ? _('Table of Contents') : undefined}
          aria-activedescendant={hasRows ? `${treeId}-${focusIndex}` : undefined}
          tabIndex={hasRows ? 0 : -1}
          className='group outline-none'
          onKeyDown={handleTreeKeyDown}
          onFocus={handleTreeFocus}
          onMouseDown={handleTreeMouseDown}
          initialTopMostItemIndex={
            initialScrollTarget.index > 0
              ? { index: initialScrollTarget.index, align: 'center' }
              : 0
          }
          rangeChanged={({ startIndex, endIndex }) => {
            visibleCenterRef.current = Math.floor((startIndex + endIndex) / 2);
          }}
          onScroll={() => {
            // A scroll arriving while a pending auto-scroll is still queued
            // (idx === -1, waiting on flatItems to expand) normally means the
            // user is now driving — drop the queued auto-scroll so the next
            // render doesn't yank them away. But auto-expanding the current
            // volume on open grows the list and emits a synthetic scroll with
            // no gesture behind it; ignore that so the initial auto-scroll
            // survives. A real user scroll still cancels it via userInputRef.
            if (pendingScrollRef.current && !userInputRef.current) return;
            pendingScrollRef.current = false;
            userScrolledRef.current = true;
            if (scrollCooldownRef.current) clearTimeout(scrollCooldownRef.current);
            scrollCooldownRef.current = setTimeout(() => {
              userScrolledRef.current = false;
            }, 10000);
          }}
          style={{ height: containerHeight }}
          totalCount={displayItems.length}
          itemContent={(index) => {
            const row = displayItems[index]!;
            if (isPageThumbnailsItem(row)) {
              return (
                <PageThumbnailsRow
                  bookKey={bookKey}
                  bookDoc={bookDoc}
                  depth={row.depth}
                  pages={row.pages}
                  columns={thumbnailsPerRow}
                  currentPage={currentPage}
                  onPageClick={handlePageClick}
                />
              );
            }
            const id = `${treeId}-${index}`;
            if (isCurrentPositionItem(row)) {
              return (
                <CurrentPositionRow
                  id={id}
                  isFocused={index === focusIndex}
                  depth={row.depth}
                  page={row.page}
                  onClick={handleCurrentPositionClick}
                />
              );
            }
            return (
              <StaticListRow
                id={id}
                isFocused={index === focusIndex}
                bookKey={bookKey}
                flatItem={row}
                activeHref={activeHref}
                screenPage={
                  row.item.location ? locationScreenPages?.get(row.item.location) : undefined
                }
                onToggleExpand={handleToggleExpand}
                onItemClick={handleItemClick}
              />
            );
          }}
          overscan={500}
        />
      </div>
    </div>
  );
};
export default TOCView;
