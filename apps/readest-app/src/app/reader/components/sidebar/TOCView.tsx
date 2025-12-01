import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeList as VirtualList } from 'react-window';

import { useOverlayScrollbars } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';
import { SectionItem, TOCItem } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { findParentPath } from '@/utils/toc';
import { eventDispatcher } from '@/utils/event';
import { getContentMd5 } from '@/utils/misc';
import { useTextTranslation } from '../../hooks/useTextTranslation';
import { FlatTOCItem, StaticListRow, VirtualListRow } from './TOCItem';

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

const TOCView: React.FC<{
  bookKey: string;
  toc: TOCItem[];
  sections?: SectionItem[];
}> = ({ bookKey, toc, sections }) => {
  const { appService } = useEnv();
  const { getView, getProgress, getViewSettings } = useReaderStore();
  const { sideBarBookKey, isSideBarVisible } = useSidebarStore();
  const viewSettings = getViewSettings(bookKey)!;
  const progress = getProgress(bookKey);

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [containerHeight, setContainerHeight] = useState(400);

  const hasInteractedWithTOCRef = useRef(false);
  const lastInteractionTimeRef = useRef<number>(0);
  const interactionCooldownMs = 10000;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listOuterRef = useRef<HTMLDivElement | null>(null);
  const vitualListRef = useRef<VirtualList | null>(null);
  const staticListRef = useRef<HTMLDivElement | null>(null);

  const [initialize] = useOverlayScrollbars({
    defer: true,
    options: {
      scrollbars: {
        autoHide: 'scroll',
      },
      showNativeOverlaidScrollbars: false,
    },
    events: {
      initialized(osInstance) {
        const { viewport } = osInstance.elements();
        viewport.style.overflowX = `var(--os-viewport-overflow-x)`;
        viewport.style.overflowY = `var(--os-viewport-overflow-y)`;
      },
    },
  });

  const isInCooldown = useCallback(() => {
    if (!hasInteractedWithTOCRef.current) return false;
    const now = Date.now();
    const timeSinceInteraction = now - lastInteractionTimeRef.current;
    if (timeSinceInteraction >= interactionCooldownMs) {
      hasInteractedWithTOCRef.current = false;
      return false;
    }
    return true;
  }, []);

  const handleInteraction = useCallback(() => {
    setTimeout(() => {
      hasInteractedWithTOCRef.current = true;
      lastInteractionTimeRef.current = Date.now();
    }, 500);
  }, []);

  useEffect(() => {
    const { current: root } = containerRef;
    const { current: virtualOuter } = listOuterRef;

    if (root && virtualOuter) {
      initialize({
        target: root,
        elements: {
          viewport: virtualOuter,
        },
      });

      virtualOuter.addEventListener('scroll', handleInteraction);
      return () => {
        virtualOuter.removeEventListener('scroll', handleInteraction);
      };
    }
    return;
  }, [initialize, handleInteraction]);

  useTextTranslation(
    bookKey,
    containerRef.current || staticListRef.current,
    false,
    'translation-target-toc',
  );

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

    const staticList = staticListRef.current;
    let scrollContainer: Element | null = null;

    if (staticList) {
      scrollContainer = staticList.parentElement;
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', handleInteraction);
      }
    }

    return () => {
      window.removeEventListener('resize', updateHeight);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', handleInteraction);
      }
    };
  }, [expandedItems, handleInteraction]);

  const activeHref = useMemo(() => progress?.sectionHref || null, [progress?.sectionHref]);
  const flatItems = useFlattenedTOC(toc, expandedItems);
  const activeItemIndex = useMemo(() => {
    return flatItems.findIndex((item) => item.item.href === activeHref);
  }, [flatItems, activeHref]);

  const handleToggleExpand = useCallback(
    (item: TOCItem) => {
      const itemId = getItemIdentifier(item);
      handleInteraction();
      setExpandedItems((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(itemId)) {
          newSet.delete(itemId);
        } else {
          newSet.add(itemId);
        }
        return newSet;
      });
    },
    [handleInteraction],
  );

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
    const parentItems = findParentPath(toc, href)
      .map((item) => getItemIdentifier(item))
      .filter(Boolean);
    setExpandedItems(new Set(parentItems));
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
        const container = staticListRef.current.parentElement!;
        const containerRect = container.getBoundingClientRect();
        const itemRect = activeItem.getBoundingClientRect();
        const isVisible =
          itemRect.top >= containerRect.top && itemRect.bottom <= containerRect.bottom;
        if (!isVisible) {
          (activeItem as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'center' });
        }
        (activeItem as HTMLElement).setAttribute('aria-current', 'page');
      }
    }
  }, [flatItems, activeHref]);

  const virtualItemSize = useMemo(() => {
    return window.innerWidth >= 640 && !viewSettings?.translationEnabled ? 37 : 57;
  }, [viewSettings?.translationEnabled]);

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
    if (!progress) return;
    if (!isSideBarVisible) return;
    if (sideBarBookKey !== bookKey) return;
    if (isInCooldown()) return;

    const { sectionHref: currentHref } = progress;
    if (currentHref) {
      expandParents(toc, currentHref);
    }
  }, [toc, progress, sideBarBookKey, isSideBarVisible, bookKey, expandParents, isInCooldown]);

  useEffect(() => {
    if (isInCooldown()) return;

    if (flatItems.length > 0) {
      setTimeout(scrollToActiveItem, appService?.isAndroidApp ? 300 : 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, scrollToActiveItem, isInCooldown]);

  return sections && sections.length > 256 ? (
    <div
      className='virtual-list mt-2 rounded'
      data-overlayscrollbars-initialize=''
      ref={containerRef}
    >
      <VirtualList
        ref={vitualListRef}
        outerRef={listOuterRef}
        width='100%'
        height={containerHeight}
        itemCount={flatItems.length}
        itemSize={virtualItemSize}
        itemData={virtualListData}
        overscanCount={20}
        initialScrollOffset={
          appService?.isAndroidApp && activeItemIndex >= 0
            ? Math.max(0, activeItemIndex * virtualItemSize - containerHeight / 2)
            : undefined
        }
      >
        {VirtualListRow}
      </VirtualList>
    </div>
  ) : (
    <div className='static-list mt-2 rounded' ref={staticListRef}>
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
  );
};
export default TOCView;
