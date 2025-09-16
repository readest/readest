import clsx from 'clsx';
import React, { useMemo } from 'react';
import { FixedSizeList as List } from 'react-window';
import { FiChevronUp, FiChevronLeft } from 'react-icons/fi';
import { MdCheck } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface DropdownProps {
  family?: string;
  selected: string;
  options: { option: string; label?: string }[];
  moreOptions?: { option: string; label?: string }[];
  onSelect: (option: string) => void;
  onGetFontFamily: (option: string, family: string) => string;
}

interface FontItemProps {
  index: number;
  style: React.CSSProperties;
  data: {
    options: { option: string; label?: string }[];
    selected: string;
    onSelect: (option: string) => void;
    onGetFontFamily: (option: string, family: string) => string;
    family: string;
    iconSize: number;
  };
}

const FontItem: React.FC<FontItemProps> = ({ index, style, data }) => {
  const { options, selected, onSelect, onGetFontFamily, family, iconSize: iconSize16 } = data;
  const option = options[index]!;

  return (
    <li
      role='option'
      aria-selected={selected === option.option}
      className='px-2'
      key={option.option}
      style={style}
    >
      <div
        role='button'
        tabIndex={0}
        onClick={() => onSelect(option.option)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onSelect(option.option);
          }
        }}
        aria-label={option.label || option.option}
        className='flex w-full items-center overflow-hidden !px-0 text-sm'
      >
        <span style={{ minWidth: `${iconSize16}px` }}>
          {selected === option.option && (
            <MdCheck className='text-base-content' size={iconSize16} />
          )}
        </span>
        <span
          className='line-clamp-1 overflow-visible break-all leading-loose'
          style={{ fontFamily: onGetFontFamily(option.option, family) }}
          title={option.label || option.option}
        >
          {option.label || option.option}
        </span>
      </div>
    </li>
  );
};

const FontDropdown: React.FC<DropdownProps> = ({
  family,
  selected,
  options,
  moreOptions,
  onSelect,
  onGetFontFamily,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const iconSize = useResponsiveSize(16);
  const allOptions = [...options, ...(moreOptions ?? [])];
  const selectedOption = allOptions.find((option) => option.option === selected) ?? allOptions[0]!;

  const ITEM_HEIGHT = 40;
  const MAX_HEIGHT = 320;

  const mainListData = useMemo(
    () => ({
      options,
      selected,
      onSelect,
      onGetFontFamily,
      family: family ?? '',
      iconSize,
      appService,
    }),
    [options, selected, onSelect, onGetFontFamily, family, iconSize, appService],
  );

  const moreListData = useMemo(
    () => ({
      options: moreOptions ?? [],
      selected,
      onSelect,
      onGetFontFamily,
      family: family ?? '',
      iconSize,
    }),
    [moreOptions, selected, onSelect, onGetFontFamily, family, iconSize],
  );

  return (
    <div className='dropdown dropdown-top'>
      <button
        tabIndex={0}
        className='btn btn-sm flex items-center px-[10px] font-normal normal-case sm:px-[20px]'
        onClick={(e) => e.currentTarget.focus()}
      >
        <div className='flex items-center gap-x-1'>
          <span
            className='line-clamp-1 break-all leading-loose'
            style={{
              fontFamily: onGetFontFamily(selectedOption.option, family ?? ''),
            }}
          >
            {selectedOption.label}
          </span>
          <FiChevronUp size={iconSize} />
        </div>
      </button>
      <ul
        role='listbox'
        tabIndex={0}
        className={clsx(
          'dropdown-content bgcolor-base-200 no-triangle menu rounded-box absolute z-[1] mt-4 shadow',
          'right-[-32px] w-[46vw] !px-0 sm:right-0 sm:w-44',
          moreOptions?.length ? '' : 'inline overflow-hidden',
        )}
      >
        {/* Virtualized main options */}
        <div style={{ height: Math.min(options.length * ITEM_HEIGHT, MAX_HEIGHT) }}>
          <List
            width='100%'
            height={Math.min(options.length * ITEM_HEIGHT, MAX_HEIGHT)}
            itemCount={options.length}
            itemSize={ITEM_HEIGHT}
            itemData={mainListData}
          >
            {FontItem}
          </List>
        </div>

        {/* More options with nested dropdown */}
        {moreOptions && moreOptions.length > 0 && (
          <li className='dropdown dropdown-left dropdown-top px-2'>
            <div className='flex items-center px-0 text-sm'>
              <span style={{ minWidth: `${iconSize}px` }}>
                <FiChevronLeft size={iconSize} />
              </span>
              <span>{_('System Fonts')}</span>
            </div>
            <ul
              role='listbox'
              tabIndex={0}
              className={clsx(
                'dropdown-content bgcolor-base-200 menu rounded-box relative z-[1] shadow',
                '!mr-4 mb-[-46px] inline w-[46vw] overflow-hidden !px-0 sm:w-[200px]',
              )}
            >
              {/* Virtualized more options */}
              <div style={{ height: Math.min(moreOptions.length * ITEM_HEIGHT, MAX_HEIGHT) }}>
                <List
                  width='100%'
                  height={Math.min(moreOptions.length * ITEM_HEIGHT, MAX_HEIGHT)}
                  itemCount={moreOptions.length}
                  itemSize={ITEM_HEIGHT}
                  itemData={moreListData}
                >
                  {FontItem}
                </List>
              </div>
            </ul>
          </li>
        )}
      </ul>
    </div>
  );
};

export default FontDropdown;
