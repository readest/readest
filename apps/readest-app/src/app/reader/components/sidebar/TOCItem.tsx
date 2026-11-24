import clsx from 'clsx';
import React, { useCallback } from 'react';
import { FiBookOpen } from 'react-icons/fi';
import { TOCItem } from '@/libs/document';
import { useTranslation } from '@/hooks/useTranslation';
import { getContentMd5 } from '@/utils/misc';

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
      aria-hidden='true'
      focusable='false'
    >
      <polygon points='0 0, 8 5, 0 10' />
    </svg>
  );
};

export interface FlatTOCItem {
  item: TOCItem;
  depth: number;
  index: number;
  isExpanded?: boolean;
  // Owns pages whose thumbnails unfold beneath it (see computeTOCPageRanges).
  hasPages?: boolean;
}

// A row of page thumbnails shown under an unfolded TOC item.
export interface PageThumbnailsItem {
  isPageThumbnails: true;
  depth: number;
  pages: number[];
}

export type TOCListItem = FlatTOCItem | PageThumbnailsItem;

export const isPageThumbnailsItem = (item: TOCDisplayItem): item is PageThumbnailsItem =>
  'isPageThumbnails' in item;

// Synthetic row injected right under the active TOC item to surface the
// current reading page (see buildTOCDisplayItems).
export interface CurrentPositionItem {
  isCurrentPosition: true;
  depth: number;
  page: number;
}

export type TOCDisplayItem = TOCListItem | CurrentPositionItem;

export const isCurrentPositionItem = (item: TOCDisplayItem): item is CurrentPositionItem =>
  'isCurrentPosition' in item;

// Insert a "current position" row immediately after the active TOC item so the
// reader can see exactly how far they've progressed within the highlighted
// section. The row sits one level deeper than the active item. Inserting it
// *after* the active item leaves that item's index untouched, so the auto-scroll
// logic in TOCView keeps targeting the right row.
export const buildTOCDisplayItems = <T extends TOCListItem>(
  flatItems: T[],
  activeHref: string | null,
  currentPage: number | null | undefined,
): (T | CurrentPositionItem)[] => {
  if (!activeHref || currentPage == null) return flatItems;
  const activeIndex = flatItems.findIndex((f) => 'item' in f && f.item.href === activeHref);
  if (activeIndex === -1) return flatItems;
  const currentRow: CurrentPositionItem = {
    isCurrentPosition: true,
    depth: flatItems[activeIndex]!.depth + 1,
    page: currentPage,
  };
  const result: (T | CurrentPositionItem)[] = flatItems.slice();
  result.splice(activeIndex + 1, 0, currentRow);
  return result;
};

// The list (TOCView) holds keyboard focus and marks the focused row with
// aria-activedescendant; the row shows the ring while the list is focused.
const FOCUS_RING =
  'group-focus-visible:ring-2 group-focus-visible:ring-inset group-focus-visible:ring-base-content/15 eink:group-focus-visible:ring-base-content';

const TOCItemView = React.memo<{
  id?: string;
  isFocused?: boolean;
  bookKey: string;
  flatItem: FlatTOCItem;
  itemSize?: number;
  isActive: boolean;
  screenPage?: number;
  onToggleExpand: (item: TOCItem) => void;
  onItemClick: (item: TOCItem) => void;
}>(({ id, isFocused, flatItem, itemSize, isActive, screenPage, onToggleExpand, onItemClick }) => {
  const { item, depth } = flatItem;
  const expandable = !!item.subitems || !!flatItem.hasPages;

  const pageNumber =
    screenPage ??
    (item.location ? item.location.current + 1 : item.index !== undefined ? item.index + 1 : null);
  const ariaLabel = item.label
    ? pageNumber !== null
      ? `${item.label}, ${pageNumber}`
      : item.label
    : undefined;

  const handleToggleExpand = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onToggleExpand(item);
    },
    [item, onToggleExpand],
  );

  const handleClickItem = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      onItemClick(item);
    },
    [item, onItemClick],
  );

  return (
    <div
      id={id}
      role='treeitem'
      onClick={item.href ? handleClickItem : undefined}
      aria-label={ariaLabel}
      aria-level={depth + 1}
      aria-current={isActive ? 'page' : undefined}
      aria-expanded={expandable ? (flatItem.isExpanded ? 'true' : 'false') : undefined}
      aria-selected={isActive ? 'true' : 'false'}
      data-href={item.href ? getContentMd5(item.href) : undefined}
      className={clsx(
        'flex w-full cursor-pointer items-center rounded-md py-4 sm:py-2 sm:hover:bg-base-300/75',
        isFocused && FOCUS_RING,
      )}
      style={{
        height: itemSize ? `${itemSize}px` : 'auto',
        paddingInlineStart: `${(depth + 1) * 12}px`,
      }}
    >
      {expandable && (
        <button
          tabIndex={-1}
          onClick={handleToggleExpand}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
          aria-label={flatItem.isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
          className='inline-block cursor-pointer'
          style={{
            padding: '12px',
            margin: '-12px',
          }}
        >
          {createExpanderIcon(flatItem.isExpanded || false)}
        </button>
      )}
      <div className='ms-2 min-w-0 break-words'>{item.label}</div>
      {pageNumber !== null && (
        <div
          aria-hidden='true'
          className='text-base-content/50 ms-auto shrink-0 ps-1 text-xs sm:pe-1'
        >
          {pageNumber}
        </div>
      )}
    </div>
  );
});

TOCItemView.displayName = 'TOCItemView';

interface ListRowProps {
  id?: string;
  isFocused?: boolean;
  bookKey: string;
  flatItem: FlatTOCItem;
  itemSize?: number;
  activeHref: string | null;
  /** The screen page the item starts on, with Stable Page Numbers off. */
  screenPage?: number;
  onToggleExpand: (item: TOCItem) => void;
  onItemClick: (item: TOCItem) => void;
}

export const StaticListRow: React.FC<ListRowProps> = ({
  id,
  isFocused,
  bookKey,
  flatItem,
  itemSize,
  activeHref,
  screenPage,
  onToggleExpand,
  onItemClick,
}) => {
  const isActive = activeHref === flatItem.item.href;

  return (
    <div
      className={clsx(
        'border-base-300 w-full border-b sm:border-none',
        'pe-4 ps-2 pt-[1px] sm:pe-2',
      )}
      title={flatItem.item.label || ''}
    >
      <TOCItemView
        id={id}
        isFocused={isFocused}
        bookKey={bookKey}
        flatItem={flatItem}
        itemSize={itemSize}
        isActive={isActive}
        screenPage={screenPage}
        onToggleExpand={onToggleExpand}
        onItemClick={onItemClick}
      />
    </div>
  );
};

export const CurrentPositionRow: React.FC<{
  id?: string;
  isFocused?: boolean;
  depth: number;
  page: number;
  onClick?: () => void;
}> = ({ id, isFocused, depth, page, onClick }) => {
  const _ = useTranslation();
  const label = _('Current position');

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      onClick?.();
    },
    [onClick],
  );

  return (
    <div
      className={clsx(
        'border-base-300 w-full border-b sm:border-none',
        'pe-4 ps-2 pt-[1px] sm:pe-2',
      )}
      title={label}
    >
      <div
        id={id}
        role='treeitem'
        aria-current='true'
        aria-label={`${label}, ${page}`}
        aria-level={depth + 1}
        onClick={onClick ? handleClick : undefined}
        className={clsx(
          'flex w-full items-center rounded-md py-4 sm:py-2',
          'text-bold-in-eink sm:bg-base-300/65 eink:bg-transparent sm:text-base-content text-blue-500',
          onClick && 'cursor-pointer sm:hover:bg-base-300/75',
          isFocused && FOCUS_RING,
        )}
        style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
      >
        <FiBookOpen className='h-4 w-4 shrink-0' aria-hidden='true' />
        <div
          className='ms-2 truncate text-ellipsis'
          style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
        >
          {label}
        </div>
        <div aria-hidden='true' className='text-base-content/50 ms-auto ps-1 text-xs sm:pe-1'>
          {page}
        </div>
      </div>
    </div>
  );
};
