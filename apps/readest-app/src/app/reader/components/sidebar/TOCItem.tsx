import clsx from 'clsx';
import React, { useCallback } from 'react';
import { TOCItem } from '@/libs/document';
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
}

const TOCItemView = React.memo<{
  bookKey: string;
  flatItem: FlatTOCItem;
  itemSize?: number;
  isActive: boolean;
  onToggleExpand: (item: TOCItem) => void;
  onItemClick: (item: TOCItem) => void;
}>(({ flatItem, itemSize, isActive, onToggleExpand, onItemClick }) => {
  const { item, depth } = flatItem;

  const pageNumber = item.location
    ? item.location.current + 1
    : item.index !== undefined
      ? item.index + 1
      : null;
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
    (event: React.MouseEvent | React.KeyboardEvent) => {
      event.preventDefault();
      onItemClick(item);
    },
    [item, onItemClick],
  );

  return (
    <div
      tabIndex={0}
      role='treeitem'
      onClick={item.href ? handleClickItem : undefined}
      onKeyDown={item.href ? (e) => e.key === 'Enter' && handleClickItem(e) : undefined}
      aria-label={ariaLabel}
      aria-current={isActive ? 'page' : undefined}
      aria-expanded={item.subitems ? (flatItem.isExpanded ? 'true' : 'false') : undefined}
      aria-selected={isActive ? 'true' : 'false'}
      data-href={item.href ? getContentMd5(item.href) : undefined}
      className={clsx(
        'group relative flex w-full cursor-pointer items-center rounded-[16px] px-3 py-3 text-[#d8c39b] transition-colors duration-150 sm:py-3',
        isActive
          ? 'text-bold-in-eink border-[#b48c49]/34 border bg-[linear-gradient(90deg,rgba(61,21,16,0.96),rgba(30,14,11,0.92)_62%,rgba(18,11,9,0.76))] text-[#f0d6a0] shadow-[inset_0_1px_0_rgba(255,237,193,0.08),0_0_18px_rgba(132,26,18,0.16)] sm:text-[#f0d6a0]'
          : 'border-[#4d371e]/16 hover:bg-[#221511]/92 border bg-[linear-gradient(180deg,rgba(18,12,10,0.74),rgba(11,8,7,0.88))] hover:border-[#8f6a37]/30 hover:text-[#eed8a9]',
      )}
      style={{
        height: itemSize ? `${itemSize}px` : 'auto',
        paddingInlineStart: `${(depth + 1) * 12}px`,
      }}
    >
      <span
        aria-hidden='true'
        className={clsx(
          'absolute bottom-2 left-0 top-2 w-[2px] rounded-full bg-gradient-to-b from-[#b73a2f] to-[#c9a45a] transition-opacity duration-150',
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-70',
        )}
      />
      {item.subitems && (
        <button
          onClick={handleToggleExpand}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
          aria-label={flatItem.isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
          className='inline-block cursor-pointer text-[#9f814a] transition-colors duration-150 hover:text-[#d9bd86]'
          style={{
            padding: '12px',
            margin: '-12px',
          }}
        >
          {createExpanderIcon(flatItem.isExpanded || false)}
        </button>
      )}
      <div
        className='ms-2 truncate text-ellipsis text-sm leading-[1.25]'
        style={{
          maxWidth: 'calc(100% - 24px)',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        {item.label}
      </div>
      {(item.location || item.index !== undefined) && (
        <div
          aria-hidden='true'
          className={clsx(
            'ms-auto ps-2 text-[11px] tabular-nums text-[#8f7447] sm:pe-1',
            isActive && 'text-[#d8b46f]',
          )}
        >
          {item.location ? item.location.current + 1 : item.index + 1}
        </div>
      )}
    </div>
  );
});

TOCItemView.displayName = 'TOCItemView';

interface ListRowProps {
  bookKey: string;
  flatItem: FlatTOCItem;
  itemSize?: number;
  activeHref: string | null;
  onToggleExpand: (item: TOCItem) => void;
  onItemClick: (item: TOCItem) => void;
}

export const StaticListRow: React.FC<ListRowProps> = ({
  bookKey,
  flatItem,
  itemSize,
  activeHref,
  onToggleExpand,
  onItemClick,
}) => {
  const isActive = activeHref === flatItem.item.href;

  return (
    <div className={clsx('w-full px-1 pt-[1px] sm:px-0')} title={flatItem.item.label || ''}>
      <TOCItemView
        bookKey={bookKey}
        flatItem={flatItem}
        itemSize={itemSize}
        isActive={isActive}
        onToggleExpand={onToggleExpand}
        onItemClick={onItemClick}
      />
    </div>
  );
};
