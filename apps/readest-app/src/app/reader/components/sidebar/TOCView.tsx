import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';

import { TOCItem } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { findParentPath } from '@/utils/toc';
import { getContentMd5 } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { BookProgress } from '@/types/book';
import { useTextTranslation } from '../../hooks/useTextTranslation';

const createExpanderIcon = (isExpanded: boolean) => {
  return (
    <svg
      viewBox='0 0 8 10'
      width='8'
      height='10'
      className={clsx(
        'text-base-content transform transition-transform',
        isExpanded ? 'rotate-90' : 'rotate-0',
      )}
      style={{ transformOrigin: 'center' }}
      fill='currentColor'
    >
      <polygon points='0 0, 8 5, 0 10' />
    </svg>
  );
};

const TOCItemView: React.FC<{
  bookKey: string;
  item: TOCItem;
  depth: number;
  expandedItems: string[];
}> = ({ bookKey, item, depth, expandedItems }) => {
  const [isExpanded, setIsExpanded] = useState(expandedItems.includes(item.href || ''));
  const { getView, getProgress } = useReaderStore();
  const progress = getProgress(bookKey);

  const handleToggleExpand = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsExpanded((prev) => !prev);
  };

  const handleClickItem = (event: React.MouseEvent) => {
    event.preventDefault();
    eventDispatcher.dispatch('navigate', { bookKey, href: item.href });
    if (item.href) {
      getView(bookKey)?.goTo(item.href);
    }
  };

  const isActive = progress ? progress.sectionHref === item.href : false;

  useEffect(() => {
    setIsExpanded(expandedItems.includes(item.href || ''));
  }, [expandedItems, item.href]);

  return (
    <li className='border-base-300 w-full border-b sm:border-none sm:pt-[1px]'>
      <span
        role='treeitem'
        tabIndex={-1}
        onClick={item.href ? handleClickItem : undefined}
        style={{ paddingInlineStart: `${(depth + 1) * 12}px` }}
        aria-expanded={isExpanded ? 'true' : 'false'}
        aria-selected={isActive ? 'true' : 'false'}
        data-href={item.href ? getContentMd5(item.href) : undefined}
        className={`flex w-full cursor-pointer items-center rounded-md py-4 sm:py-2 ${
          isActive
            ? 'sm:bg-base-300/85 sm:hover:bg-base-300 sm:text-base-content text-blue-500'
            : 'sm:hover:bg-base-300/85'
        }`}
      >
        {item.subitems && (
          <span
            onClick={handleToggleExpand}
            className='inline-block cursor-pointer'
            style={{
              padding: '12px',
              margin: '-12px',
            }}
          >
            {createExpanderIcon(isExpanded)}
          </span>
        )}
        <span
          className='ms-2 truncate text-ellipsis'
          style={{
            maxWidth: 'calc(100% - 24px)',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {item.label}
        </span>
        {item.location && (
          <span className='text-base-content/50 ms-auto ps-1 text-xs sm:pe-1'>
            {item.location.current + 1}
          </span>
        )}
      </span>
      {item.subitems && isExpanded && (
        <ol role='group'>
          {item.subitems.map((subitem, index) => (
            <TOCItemView
              bookKey={bookKey}
              key={`${index}-${subitem.href}`}
              item={subitem}
              depth={depth + 1}
              expandedItems={expandedItems}
            />
          ))}
        </ol>
      )}
    </li>
  );
};

const TOCView: React.FC<{
  bookKey: string;
  toc: TOCItem[];
}> = ({ bookKey, toc }) => {
  const { getProgress } = useReaderStore();
  const { sideBarBookKey, isSideBarVisible } = useSidebarStore();
  const progress = getProgress(bookKey);

  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const viewRef = useRef<HTMLUListElement | null>(null);

  useTextTranslation(bookKey, viewRef.current);

  const expandParents = (toc: TOCItem[], href: string) => {
    const parentPath = findParentPath(toc, href).map((item) => item.href);
    setExpandedItems(parentPath.filter(Boolean) as string[]);
  };

  const scrollToProgress = (progress: BookProgress) => {
    const { sectionHref: currentHref } = progress;
    const hrefMd5 = currentHref ? getContentMd5(currentHref) : '';
    const currentItem = viewRef.current?.querySelector(`[data-href="${hrefMd5}"]`);
    if (currentItem) {
      const rect = currentItem.getBoundingClientRect();
      const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!isVisible) {
        (currentItem as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'center' });
      }
      (currentItem as HTMLElement).setAttribute('aria-current', 'page');
    }
  };

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const progress = getProgress(bookKey);
      if (progress && viewRef.current) {
        scrollToProgress(progress);
        observer.disconnect();
      }
    });

    if (viewRef.current) {
      observer.observe(viewRef.current, { childList: true, subtree: true });
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRef.current]);

  useEffect(() => {
    if (!progress || eventDispatcher.dispatchSync('tts-is-speaking')) return;
    if (sideBarBookKey !== bookKey) return;
    if (!isSideBarVisible) return;
    const { sectionHref: currentHref } = progress;
    if (currentHref) {
      expandParents(toc, currentHref);
    }
    scrollToProgress(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toc, progress, sideBarBookKey, isSideBarVisible]);

  return (
    <div className='rounded pt-2'>
      <ul role='tree' ref={viewRef} className='pe-4 ps-2 sm:pe-2'>
        {toc &&
          toc.map((item, index) => (
            <TOCItemView
              bookKey={bookKey}
              key={`${index}-${item.href}`}
              item={item}
              depth={0}
              expandedItems={expandedItems}
            />
          ))}
      </ul>
    </div>
  );
};

export default TOCView;
