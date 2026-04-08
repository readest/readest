import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle, Components } from 'react-virtuoso';

import { TOCItem } from '@/libs/document';
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

const TOCScroller = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (props, ref) => <div {...props} ref={ref} className='toc-scroller' />,
);
TOCScroller.displayName = 'TOCScroller';

const VIRTUOSO_COMPONENTS: Components = { Scroller: TOCScroller };

const TOCView: React.FC<{
  bookKey: string;
  toc: TOCItem[];
}> = ({ bookKey, toc }) => {
  const { getView, getProgress } = useReaderStore();
  const { sideBarBookKey, isSideBarVisible } = useSidebarStore();
  const progress = getProgress(bookKey);

  const [expandedItems, setExpandedItems] = useState<Set<string>>(() =>
    computeExpandedSet(toc, progress?.sectionHref),
  );
  const [containerHeight, setContainerHeight] = useState(400);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const userScrolledRef = useRef(false);
  const scrollCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollRef = useRef(false);
  const visibleCenterRef = useRef(0);

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
      return;
    }
    if (userScrolledRef.current) return;
    setExpandedItems(computeExpandedSet(toc, progress?.sectionHref));
    if (progress?.sectionHref) pendingScrollRef.current = true;
  }, [isSideBarVisible, sideBarBookKey, bookKey, toc, progress]);

  useEffect(() => {
    if (!pendingScrollRef.current || !activeHref || !isSideBarVisible) return;
    const timer = setTimeout(() => {
      const idx = flatItems.findIndex((f) => f.item.href === activeHref);
      if (idx !== -1) {
        const distance = Math.abs(idx - visibleCenterRef.current);
        const behavior = distance > 16 ? 'auto' : 'smooth';
        virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior });
      }
      pendingScrollRef.current = false;
    }, 100);
    return () => clearTimeout(timer);
  }, [flatItems, activeHref, isSideBarVisible]);

  return (
    <div ref={containerRef} className='toc-list rounded' role='tree'>
      <Virtuoso
        ref={virtuosoRef}
        components={VIRTUOSO_COMPONENTS}
        rangeChanged={({ startIndex, endIndex }) => {
          visibleCenterRef.current = Math.floor((startIndex + endIndex) / 2);
        }}
        onScroll={() => {
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
  );
};
export default TOCView;
