import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useOverlayScrollbars } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';

import { TOCItem } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { findParentPath } from '@/services/nav';
import { eventDispatcher } from '@/utils/event';
import { useTextTranslation } from '../../hooks/useTextTranslation';
import { FlatTOCItem, StaticListRow } from './TOCItem';

const getItemIdentifier = (item: TOCItem) => {
  const href = item.href || '';
  return `toc-item-${item.id}-${href}`;
};

const flattenTOC = (items: TOCItem[], expandedItems: Set<string>, depth = 0): FlatTOCItem[] => {
  const result: FlatTOCItem[] = [];
  items.forEach((item, index) => {
    const isExpanded = expandedItems.has(getItemIdentifier(item));
    result.push({ item, depth, index, isExpanded });
    if (item.subitems && isExpanded) {
      result.push(...flattenTOC(item.subitems, expandedItems, depth + 1));
    }
  });
  return result;
};

const computeExpandedSet = (toc: TOCItem[], href: string | undefined): Set<string> => {
  const topLevel = toc.filter((item) => item.subitems?.length).map(getItemIdentifier);
  const parents = href ? findParentPath(toc, href).map(getItemIdentifier).filter(Boolean) : [];
  return new Set([...topLevel, ...parents]);
};

const setsHaveSameContents = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
};

const getInitialScrollTarget = (
  toc: TOCItem[],
  href: string | undefined,
): { index: number; expanded: Set<string> } => {
  const expanded = computeExpandedSet(toc, href);
  if (!href) return { index: 0, expanded };
  const flat = flattenTOC(toc, expanded);
  const idx = flat.findIndex((f) => f.item.href === href);
  return { index: idx > 0 ? idx : 0, expanded };
};

const TOCView: React.FC<{
  bookKey: string;
  toc: TOCItem[];
}> = ({ bookKey, toc }) => {
  const { getView, getViewSettings, getProgress } = useReaderStore();
  const { sideBarBookKey, isSideBarVisible } = useSidebarStore();
  const progress = getProgress(bookKey);
  const isEink = !!getViewSettings(bookKey)?.isEink;

  const [initialScrollTarget] = useState(() => getInitialScrollTarget(toc, progress?.sectionHref));
  const [expandedItems, setExpandedItems] = useState<Set<string>>(initialScrollTarget.expanded);
  const [containerHeight, setContainerHeight] = useState(400);

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
        const target = initialScrollTarget.index;
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

  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    setScroller(el instanceof HTMLElement ? el : null);
  }, []);

  useTextTranslation(bookKey, containerRef.current, false, 'translation-target-toc');

  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
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
  const flatItems = useMemo(() => flattenTOC(toc, expandedItems), [toc, expandedItems]);

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
        getView(bookKey)?.goTo(item.href);
      }
    },
    [bookKey, getView],
  );

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
    if (progress?.sectionHref) {
      if (initialScrollHandledRef.current) {
        initialScrollHandledRef.current = false;
      } else {
        pendingScrollRef.current = true;
      }
      initialAutoScrollProcessedRef.current = true;
    }
  }, [isSideBarVisible, sideBarBookKey, bookKey, toc, progress]);

  useEffect(() => {
    if (!pendingScrollRef.current || !activeHref || !isSideBarVisible) return;
    const idx = flatItems.findIndex((f) => f.item.href === activeHref);
    if (idx === -1) {
      // The active section's parents were just queued to expand by the
      // post-mount progress effect above — flatItems still reflects the
      // pre-update expandedItems. Leave pendingScrollRef set so this
      // effect retries on the next render once flatItems contains the
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
    pendingScrollRef.current = false;
  }, [flatItems, activeHref, isSideBarVisible, isEink]);

  return (
    <div ref={containerRef} className='toc-list rounded' role='tree'>
      <div ref={osRootRef} data-overlayscrollbars-initialize='' style={{ height: containerHeight }}>
        <Virtuoso
          ref={virtuosoRef}
          scrollerRef={handleScrollerRef}
          initialTopMostItemIndex={
            initialScrollTarget.index > 0
              ? { index: initialScrollTarget.index, align: 'center' }
              : 0
          }
          rangeChanged={({ startIndex, endIndex }) => {
            visibleCenterRef.current = Math.floor((startIndex + endIndex) / 2);
          }}
          onScroll={() => {
            // A scroll arriving while a pending auto-scroll is still
            // queued (idx === -1, waiting on flatItems to expand) means
            // the user is now driving — drop the queued auto-scroll so
            // the next render doesn't yank them away.
            pendingScrollRef.current = false;
            userScrolledRef.current = true;
            if (scrollCooldownRef.current) clearTimeout(scrollCooldownRef.current);
            scrollCooldownRef.current = setTimeout(() => {
              userScrolledRef.current = false;
            }, 10000);
          }}
          style={{ height: containerHeight }}
          totalCount={flatItems.length}
          itemContent={(index) => (
            <StaticListRow
              bookKey={bookKey}
              flatItem={flatItems[index]!}
              activeHref={activeHref}
              onToggleExpand={handleToggleExpand}
              onItemClick={handleItemClick}
            />
          )}
          overscan={500}
        />
      </div>
    </div>
  );
};
export default TOCView;
