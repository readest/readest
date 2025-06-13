import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeList as VirtualList } from 'react-window';

import { TOCItem } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { findParentPath } from '@/utils/toc';
import { eventDispatcher } from '@/utils/event';
import { getContentMd5 } from '@/utils/misc';
import { useTextTranslation } from '../../hooks/useTextTranslation';
import { FlatTOCItem, StaticListRow, VirtualListRow } from './TOCItem';

const useFlattenedTOC = (toc: TOCItem[], expandedItems: Set<string>) => {
  return useMemo(() => {
    const flattenTOC = (items: TOCItem[], depth = 0): FlatTOCItem[] => {
      const result: FlatTOCItem[] = [];
      items.forEach((item, index) => {
        const isExpanded = expandedItems.has(item.href || '');
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

const TOCView: React.FC<{
  bookKey: string;
  toc: TOCItem[];
}> = ({ bookKey, toc }) => {
  const { getView, getProgress, getViewState, getViewSettings } = useReaderStore();
  const { sideBarBookKey, isSideBarVisible } = useSidebarStore();
  const viewSettings = getViewSettings(bookKey)!;
  const progress = getProgress(bookKey);
  const viewState = getViewState(bookKey);

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [containerHeight, setContainerHeight] = useState(400);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const vitualListRef = useRef<VirtualList | null>(null);
  const staticListRef = useRef<HTMLDivElement | null>(null);

  useTextTranslation(bookKey, containerRef.current);

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
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []);

  const activeHref = useMemo(() => progress?.sectionHref || null, [progress]);
  const flatItems = useFlattenedTOC(toc, expandedItems);

  const handleToggleExpand = useCallback((item: TOCItem) => {
    const href = item.href || '';
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(href)) {
        newSet.delete(href);
      } else {
        newSet.add(href);
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

  const expandParents = useCallback((toc: TOCItem[], href: string) => {
    const parentPath = findParentPath(toc, href).map((item) => item.href);
    const parentHrefs = parentPath.filter(Boolean) as string[];
    setExpandedItems(new Set(parentHrefs));
  }, []);

  const scrollToActiveItem = useCallback(() => {
    if (!activeHref) return;

    if (vitualListRef.current) {
      const activeIndex = flatItems.findIndex((flatItem) => flatItem.item.href === activeHref);
      if (activeIndex !== -1) {
        vitualListRef.current.scrollToItem(activeIndex, 'center');
      }
    }

    if (staticListRef.current) {
      const hrefMd5 = activeHref ? getContentMd5(activeHref) : '';
      const activeItem = staticListRef.current?.querySelector(`[data-href="${hrefMd5}"]`);
      if (activeItem) {
        const rect = activeItem.getBoundingClientRect();
        const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
        if (!isVisible) {
          (activeItem as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'center' });
        }
        (activeItem as HTMLElement).setAttribute('aria-current', 'page');
      }
    }
  }, [activeHref, flatItems]);

  const virtualItemSize = useMemo(() => {
    return window.innerWidth >= 640 && !viewSettings?.translationEnabled ? 37 : 57;
  }, [viewSettings]);

  const virtualListData = useMemo(
    () => ({
      flatItems,
      itemSize: virtualItemSize,
      bookKey,
      activeHref,
      onToggleExpand: handleToggleExpand,
      onItemClick: handleItemClick,
    }),
    [flatItems, virtualItemSize, bookKey, activeHref, handleToggleExpand, handleItemClick],
  );

  useEffect(() => {
    if (!progress || viewState?.ttsEnabled) return;
    if (sideBarBookKey !== bookKey) return;
    if (!isSideBarVisible) return;

    const { sectionHref: currentHref } = progress;
    if (currentHref) {
      expandParents(toc, currentHref);
    }
  }, [toc, progress, viewState, sideBarBookKey, isSideBarVisible, bookKey, expandParents]);

  useEffect(() => {
    if (flatItems.length > 0) {
      setTimeout(scrollToActiveItem, 0);
    }
  }, [flatItems, scrollToActiveItem]);

  return (
    <div className='rounded' ref={containerRef}>
      {flatItems.length > 256 ? (
        <VirtualList
          ref={vitualListRef}
          width='100%'
          height={containerHeight}
          itemCount={flatItems.length}
          itemSize={virtualItemSize}
          itemData={virtualListData}
          overscanCount={20}
        >
          {VirtualListRow}
        </VirtualList>
      ) : (
        <div className='pt-2' ref={staticListRef}>
          {flatItems.map((flatItem, index) => (
            <StaticListRow
              key={`static-row-${index}`}
              bookKey={bookKey}
              flatItem={flatItem}
              activeHref={activeHref}
              onToggleExpand={handleToggleExpand}
              onItemClick={handleItemClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TOCView;
