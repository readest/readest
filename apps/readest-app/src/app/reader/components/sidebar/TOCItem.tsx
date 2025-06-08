import clsx from 'clsx';
import React, { useCallback } from 'react';
import { ListChildComponentProps } from 'react-window';
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
    <span
      role='treeitem'
      tabIndex={-1}
      onClick={item.href ? handleClickItem : undefined}
      aria-expanded={flatItem.isExpanded ? 'true' : 'false'}
      aria-selected={isActive ? 'true' : 'false'}
      data-href={item.href ? getContentMd5(item.href) : undefined}
      className={clsx(
        'flex w-full cursor-pointer items-center rounded-md py-4 sm:py-2',
        isActive
          ? 'sm:bg-base-300/85 sm:hover:bg-base-300 sm:text-base-content text-blue-500'
          : 'sm:hover:bg-base-300/85',
      )}
      style={{
        height: itemSize ? `${itemSize}px` : 'auto',
        paddingInlineStart: `${(depth + 1) * 12}px`,
      }}
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
          {createExpanderIcon(flatItem.isExpanded || false)}
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
    <div
      className={clsx(
        'border-base-300 w-full border-b sm:border-none',
        'pe-4 ps-2 pt-[1px] sm:pe-2',
      )}
    >
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

export const VirtualListRow: React.FC<
  ListChildComponentProps & {
    data: {
      bookKey: string;
      flatItems: FlatTOCItem[];
      itemSize: number;
      activeHref: string | null;
      onToggleExpand: (item: TOCItem) => void;
      onItemClick: (item: TOCItem) => void;
    };
  }
> = ({ index, style, data }) => {
  const { flatItems, bookKey, activeHref, itemSize, onToggleExpand, onItemClick } = data;
  const flatItem = flatItems[index];

  return (
    <div style={style}>
      <StaticListRow
        bookKey={bookKey}
        flatItem={flatItem}
        itemSize={itemSize - 1}
        activeHref={activeHref}
        onToggleExpand={onToggleExpand}
        onItemClick={onItemClick}
      />
    </div>
  );
};
