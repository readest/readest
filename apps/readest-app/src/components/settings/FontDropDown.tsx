import clsx from 'clsx';
import { useMemo, type ReactElement } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { FiChevronUp, FiChevronLeft } from 'react-icons/fi';
import { MdCheck } from 'react-icons/md';
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

interface FontRowData {
  options: { option: string; label?: string }[];
  selected: string;
  onSelect: (option: string) => void;
  onGetFontFamily: (option: string, family: string) => string;
  family: string;
  iconSize: number;
}

const FontItem = ({
  index,
  style,
  ariaAttributes,
  options,
  selected,
  onSelect,
  onGetFontFamily,
  family,
  iconSize: iconSize16,
}: RowComponentProps<FontRowData>): ReactElement => {
  const option = options[index]!;

  return (
    <div
      {...ariaAttributes}
      role='option'
      aria-selected={selected === option.option}
      className='px-2'
      key={option.option}
      style={style}
      tabIndex={0}
      onClick={() => onSelect(option.option)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(option.option);
        }
      }}
      aria-label={option.label || option.option}
    >
      <div className='hover:bg-base-content/10 active:bg-base-content/20 flex h-full w-full cursor-pointer items-center overflow-hidden rounded-lg text-sm transition-colors'>
        <span style={{ minWidth: `${iconSize16}px` }}>
          {selected === option.option && (
            <MdCheck className='text-base-content' size={iconSize16} />
          )}
        </span>
        <span
          className='line-clamp-1 overflow-visible break-all px-2 leading-loose'
          style={{ fontFamily: onGetFontFamily(option.option, family) }}
          title={option.label || option.option}
        >
          {option.label || option.option}
        </span>
      </div>
    </div>
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
    }),
    [options, selected, onSelect, onGetFontFamily, family, iconSize],
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
        type='button'
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
      <div
        role='listbox'
        tabIndex={0}
        className={clsx(
          'dropdown-content bgcolor-base-200 no-triangle menu rounded-box absolute z-[1] mt-4 shadow',
          'right-[-32px] w-[46vw] !px-0 sm:right-0 sm:w-44',
          moreOptions?.length ? '' : 'inline overflow-hidden',
        )}
      >
        {/* Virtualized main options */}
        <div>
          <List
            style={{
              width: '100%',
              height: Math.min(options.length * ITEM_HEIGHT, MAX_HEIGHT),
            }}
            rowCount={options.length}
            rowHeight={ITEM_HEIGHT}
            rowProps={mainListData}
            rowComponent={FontItem}
          />
        </div>

        {/* More options with nested dropdown */}
        {moreOptions && moreOptions.length > 0 && (
          <div className='dropdown dropdown-left dropdown-top px-2'>
            <div className='flex items-center px-0 text-sm'>
              <span style={{ minWidth: `${iconSize}px` }}>
                <FiChevronLeft size={iconSize} />
              </span>
              <span>{_('System Fonts')}</span>
            </div>
            <div
              role='listbox'
              tabIndex={0}
              className={clsx(
                'dropdown-content bgcolor-base-200 menu rounded-box relative z-[1] shadow',
                '!mr-4 mb-[-46px] inline w-[46vw] overflow-hidden !px-0 sm:w-[200px]',
              )}
            >
              {/* Virtualized more options */}
              <div>
                <List
                  style={{
                    width: '100%',
                    height: Math.min(moreOptions.length * ITEM_HEIGHT, MAX_HEIGHT),
                  }}
                  rowCount={moreOptions.length}
                  rowHeight={ITEM_HEIGHT}
                  rowProps={moreListData}
                  rowComponent={FontItem}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FontDropdown;
