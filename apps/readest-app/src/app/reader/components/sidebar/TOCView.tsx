import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle, Components } from 'react-virtuoso';

import { SectionItem, TOCItem } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { findParentPath } from '@/utils/toc';
import { eventDispatcher } from '@/utils/event';
import { useTextTranslation } from '../../hooks/useTextTranslation';
import { FlatTOCItem, StaticListRow } from './TOCItem';

const getItemIdentifier = (item: TOCItem) => {
  const href = item.href || '';
  return `toc-item-${item.id}-${href}`;
};

const useFlattenedTOC = (toc: TOCItem[], expandedItems: Set<string>) => {
  return useMemo(() => {
    const flattenTOC = (items: TOCItem[], depth = 0): FlatTOCItem[] => {
      const result: FlatTOCItem[] = [];
      items.forEach((item, index) => {
        const isExpanded = expandedItems.has(getItemIdentifier(item));
        result.push({ item, depth, index, isExpanded });
        if (item.subitems && isExpanded) {
          result.push(...flattenTOC(item.subitems, depth + 1));
        }
      });
      return result;
    };
    return flattenTOC(toc);
  }, [toc, expandedItems]);
};

// Custom scroller with CSS-only auto-hide overlay scrollbar.
// Works across all Tauri targets (WebView2/WKWebView/WebKitGTK/Android).
// On mobile the WebView hides scrollbars natively, so the CSS is a no-op there.
const TOCScroller = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (props, ref) => <div {...props} ref={ref} className='toc-scroller' />,
);
TOCScroller.displayName = 'TOCScroller';

const VIRTUOSO_COMPONENTS: Components = { Scroller: TOCScroller };

const TOCView: React.FC<{
  bookKey: string;
  toc: TOCItem[];
  sections?: SectionItem[];
}> = ({ bookKey, toc }) => {
  const { getView, getProgress } = useReaderStore();
  const { sideBarBookKey, isSideBarVisible } = useSidebarStore();
  const progress = getProgress(bookKey);

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [containerHeight, setContainerHeight] = useState(400);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const userScrolledRef = useRef(false);
  // Set to true when the sidebar opens; the flatItems effect executes the scroll
  // after expandParents has updated flatItems, ensuring the correct index.
  const needsScrollRef = useRef(false);
  // activeHrefRef kept fresh each render so the flatItems effect doesn't need it as a dep.
  const activeHrefRef = useRef<string | null>(null);

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

  const activeHref = useMemo(() => progress?.sectionHref || null, [progress?.sectionHref]);
  const flatItems = useFlattenedTOC(toc, expandedItems);
  activeHrefRef.current = activeHref;

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

  // Expands all top-level items with subitems plus the ancestor chain of href.
  // Merging both prevents the "expand then collapse" flicker seen when only
  // parent-chain items were set (replacing previously expanded top-level items).
  const expandParents = useCallback((items: TOCItem[], href: string | undefined) => {
    const topLevelWithSubitems = items
      .filter((item) => item.subitems?.length)
      .map((item) => getItemIdentifier(item));
    const parentItems = href
      ? findParentPath(items, href)
          .map((item) => getItemIdentifier(item))
          .filter(Boolean)
      : [];
    setExpandedItems(new Set([...topLevelWithSubitems, ...parentItems]));
  }, []);

  useEffect(() => {
    if (!isSideBarVisible || sideBarBookKey !== bookKey) return;
    expandParents(toc, progress?.sectionHref);
  }, [toc, progress, sideBarBookKey, isSideBarVisible, bookKey, expandParents]);

  // When the sidebar opens, mark that a scroll is needed and reset on close.
  useEffect(() => {
    if (!isSideBarVisible || sideBarBookKey !== bookKey) {
      userScrolledRef.current = false;
      needsScrollRef.current = false;
      return;
    }
    if (!userScrolledRef.current) {
      needsScrollRef.current = true;
    }
  }, [isSideBarVisible, sideBarBookKey, bookKey]);

  // Execute the scroll after flatItems settles (expandParents runs first, updating
  // flatItems, then this effect fires with the correct indices).
  useEffect(() => {
    if (!needsScrollRef.current) return;
    const href = activeHrefRef.current;
    if (!href) return;
    const idx = flatItems.findIndex((f) => f.item.href === href);
    if (idx !== -1) {
      virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior: 'auto' });
      needsScrollRef.current = false;
    }
  }, [flatItems]);

  return (
    <div ref={containerRef} className='toc-list mt-2 rounded' role='tree'>
      <Virtuoso
        ref={virtuosoRef}
        components={VIRTUOSO_COMPONENTS}
        onScroll={() => {
          userScrolledRef.current = true;
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
  );
};
export default TOCView;
