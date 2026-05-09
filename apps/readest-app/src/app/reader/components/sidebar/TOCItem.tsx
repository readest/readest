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
        'group relative flex w-full cursor-pointer items-center border-b border-[rgba(178,135,70,0.22)] px-4 py-3.5 text-[#e4d2ab] transition-colors duration-150',
        isActive
          ? 'text-bold-in-eink border-[rgba(178,135,70,0.14)] bg-[linear-gradient(90deg,rgba(65,24,18,0.68),rgba(31,15,12,0.74)_70%,rgba(18,11,9,0.38))] text-[#f0d6a0] shadow-[inset_0_1px_0_rgba(255,237,193,0.035)] sm:text-[#f0d6a0]'
          : 'bg-transparent hover:bg-[rgba(30,20,17,0.54)] hover:text-[#eed8a9]',
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
          isActive ? 'opacity-100' : 'opacity-0',
        )}
      />
      {item.subitems && (
        <button
          onClick={handleToggleExpand}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
          aria-label={flatItem.isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
          className='inline-block cursor-pointer text-[#b89258] transition-colors duration-150 hover:text-[#dfc489]'
          style={{
            padding: '12px',
            margin: '-12px',
          }}
        >
          {createExpanderIcon(flatItem.isExpanded || false)}
        </button>
      )}
      {!item.subitems && (
        <span
          aria-hidden='true'
          className={clsx(
            'mr-2 inline-flex h-4 w-4 items-center justify-center text-[#c29a5d] transition-colors duration-150',
            isActive ? 'text-[#f0d6a0]' : 'group-hover:text-[#e3c181]',
          )}
        >
          <span className='h-[5px] w-[5px] rotate-45 border border-current' />
        </span>
      )}
      <div
        className='truncate text-ellipsis font-serif text-[15px] leading-[1.25] text-[#e9d8b2]'
        style={{
          maxWidth: 'calc(100% - 28px)',
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
            'ms-auto ps-4 font-serif text-[13px] tabular-nums text-[#be975a] sm:pe-1',
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
    <div className={clsx('w-full')} title={flatItem.item.label || ''}>
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
