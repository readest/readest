import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { FaSearch, FaTimes } from 'react-icons/fa';
import { MdFilterList, MdMoreVert } from 'react-icons/md';

import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useSettingsStore } from '@/store/settingsStore';
import { HighlightColor, HighlightStyle } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import {
  AnnotationFilterKind,
  getHighlightColorHex,
  getHighlightColorLabel,
  isDefaultHighlightColor,
} from '../../utils/annotatorUtil';
import Dropdown from '@/components/Dropdown';
import Menu from '@/components/Menu';
import MenuItem from '@/components/MenuItem';

interface AnnotationsMenuProps {
  bookKey: string;
  canClear: boolean;
  menuClassName?: string;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

// Same events BookMenu dispatches; the dialogs live in Annotator, which
// outlives this dropdown, so they are not unmounted with the menu.
const AnnotationsMenu: React.FC<AnnotationsMenuProps> = ({
  bookKey,
  canClear,
  menuClassName,
  setIsDropdownOpen,
}) => {
  const _ = useTranslation();
  const dispatchAndClose = (event: string) => {
    eventDispatcher.dispatch(event, { bookKey });
    setIsDropdownOpen?.(false);
  };
  return (
    <Menu
      className={clsx('annotations-menu dropdown-content z-20 shadow-2xl', menuClassName)}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      <MenuItem
        label={_('Export Annotations')}
        onClick={() => dispatchAndClose('export-annotations')}
      />
      <MenuItem
        label={_('Import Annotations')}
        onClick={() => dispatchAndClose('import-annotations')}
      />
      <MenuItem
        label={_('Clear Annotations')}
        disabled={!canClear}
        onClick={() => dispatchAndClose('clear-annotations')}
      />
    </Menu>
  );
};

const FILTER_KINDS: AnnotationFilterKind[] = ['all', 'highlights', 'notes'];

interface AnnotationsFilterPanelProps {
  filterKind: AnnotationFilterKind;
  colors: HighlightColor[];
  styles: HighlightStyle[];
  excludedColors: HighlightColor[];
  excludedStyles: HighlightStyle[];
  hasActiveFilters: boolean;
  onFilterKindChange: (kind: AnnotationFilterKind) => void;
  onToggleColor: (color: HighlightColor) => void;
  onToggleStyle: (style: HighlightStyle) => void;
  onResetFilters: () => void;
  menuClassName?: string;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const AnnotationsFilterPanel: React.FC<AnnotationsFilterPanelProps> = ({
  filterKind,
  colors,
  styles,
  excludedColors,
  excludedStyles,
  hasActiveFilters,
  onFilterKindChange,
  onToggleColor,
  onToggleStyle,
  onResetFilters,
  menuClassName,
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();

  const filterLabels: Record<AnnotationFilterKind, string> = {
    all: _('All'),
    highlights: _('Highlights'),
    notes: _('Notes'),
  };

  const showColors = colors.length >= 2;
  const showStyles = styles.length >= 2;

  const resolveColorLabel = (color: HighlightColor) =>
    getHighlightColorLabel(settings, color) || (isDefaultHighlightColor(color) ? _(color) : color);

  return (
    <div
      className={clsx(
        'annotations-filter-panel dropdown-content eink-bordered bg-base-100 z-20 min-w-56 max-w-72 rounded-lg p-3 shadow-2xl',
        menuClassName,
      )}
      role='group'
      aria-label={_('Filter Annotations')}
    >
      <div className='flex flex-wrap items-center gap-1.5'>
        {FILTER_KINDS.map((kind) => (
          <button
            key={kind}
            type='button'
            aria-pressed={filterKind === kind}
            onClick={() => onFilterKindChange(kind)}
            className={clsx(
              'eink-bordered btn btn-ghost h-7 min-h-7 rounded-full px-3 text-xs font-normal',
              filterKind === kind ? 'bg-base-300 hover:bg-base-300' : 'bg-base-200/60',
            )}
          >
            {filterLabels[kind]}
          </button>
        ))}
      </div>
      {showStyles && (
        <div className='mt-3'>
          <div className='text-base-content/60 mb-1.5 text-xs'>{_('Styles')}</div>
          <div className='flex items-center gap-1.5'>
            {styles.map((style) => {
              const included = !excludedStyles.includes(style);
              return (
                <button
                  key={style}
                  type='button'
                  aria-pressed={included}
                  aria-label={_(style)}
                  title={_(style)}
                  onClick={() => onToggleStyle(style)}
                  className={clsx(
                    'eink-bordered bg-base-200/60 flex h-7 w-7 items-center justify-center rounded-full p-0',
                    !included && 'opacity-40',
                  )}
                >
                  <span
                    className='w-4 text-center text-sm leading-none'
                    style={{
                      ...(style === 'highlight' && {
                        backgroundColor: 'color-mix(in srgb, currentColor 30%, transparent)',
                        paddingTop: '2px',
                      }),
                      ...((style === 'underline' || style === 'squiggly') && {
                        textDecorationLine: 'underline',
                        textDecorationThickness: '2px',
                        ...(style === 'squiggly' && { textDecorationStyle: 'wavy' }),
                      }),
                    }}
                  >
                    A
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {showColors && (
        <div className='mt-3'>
          <div className='text-base-content/60 mb-1.5 text-xs'>{_('Colors')}</div>
          <div className='flex flex-wrap items-center gap-1.5'>
            {colors.map((color) => {
              const included = !excludedColors.includes(color);
              const hex = getHighlightColorHex(settings, color) ?? color;
              const label = resolveColorLabel(color);
              return (
                <button
                  key={color}
                  type='button'
                  aria-pressed={included}
                  aria-label={label}
                  title={label}
                  onClick={() => onToggleColor(color)}
                  className='eink-bordered btn btn-ghost h-6 min-h-6 w-6 rounded-full p-0'
                >
                  <span
                    className='h-3.5 w-3.5 rounded-full border-2'
                    style={
                      included
                        ? { backgroundColor: hex, borderColor: hex }
                        : { borderColor: hex, opacity: 0.5 }
                    }
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className='mt-3 flex justify-end'>
        <button
          type='button'
          disabled={!hasActiveFilters}
          onClick={onResetFilters}
          className='eink-bordered btn btn-ghost h-7 min-h-7 rounded-full px-3 text-xs font-normal'
        >
          {_('Reset')}
        </button>
      </div>
    </div>
  );
};

interface AnnotationsToolbarProps {
  bookKey: string;
  filterKind: AnnotationFilterKind;
  searchInput: string;
  canClear: boolean;
  colors: HighlightColor[];
  styles: HighlightStyle[];
  excludedColors: HighlightColor[];
  excludedStyles: HighlightStyle[];
  onFilterKindChange: (kind: AnnotationFilterKind) => void;
  onSearchInputChange: (value: string) => void;
  onToggleColor: (color: HighlightColor) => void;
  onToggleStyle: (style: HighlightStyle) => void;
  onResetFilters: () => void;
}

const AnnotationsToolbar: React.FC<AnnotationsToolbarProps> = ({
  bookKey,
  filterKind,
  searchInput,
  canClear,
  colors,
  styles,
  excludedColors,
  excludedStyles,
  onFilterKindChange,
  onSearchInputChange,
  onToggleColor,
  onToggleStyle,
  onResetFilters,
}) => {
  const _ = useTranslation();
  const iconSize14 = useResponsiveSize(14);
  const iconSize12 = useResponsiveSize(12);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearchVisible) {
      searchInputRef.current?.focus();
    }
  }, [isSearchVisible]);

  const hasActiveFilters =
    filterKind !== 'all' || excludedColors.length > 0 || excludedStyles.length > 0;

  const handleCloseSearch = () => {
    setIsSearchVisible(false);
    onSearchInputChange('');
  };

  return (
    <div className='annotations-toolbar flex items-center justify-end gap-1 px-3 pt-1'>
      {isSearchVisible ? (
        <div className='eink-bordered bg-base-100 flex h-8 min-w-0 flex-1 items-center rounded-lg'>
          <div className='ps-3'>
            <FaSearch size={iconSize14} className='text-base-content/50' />
          </div>
          <input
            ref={searchInputRef}
            type='text'
            value={searchInput}
            spellCheck={false}
            dir='auto'
            onChange={(e) => onSearchInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleCloseSearch();
            }}
            placeholder={_('Search annotations...')}
            className='w-full min-w-0 bg-transparent p-2 font-sans text-sm font-light focus:outline-none'
          />
          <button
            onClick={handleCloseSearch}
            aria-label={_('Clear')}
            className='btn btn-ghost h-8 min-h-8 w-8 rounded-e-lg rounded-s-none p-0'
          >
            <FaTimes size={iconSize12} className='text-base-content/50' />
          </button>
        </div>
      ) : (
        <button
          type='button'
          aria-label={_('Search')}
          onClick={() => setIsSearchVisible(true)}
          className='btn btn-ghost btn-circle h-8 min-h-8 w-8 p-0'
        >
          <FaSearch size={iconSize14} className='fill-base-content' />
        </button>
      )}
      <Dropdown
        label={_('Filter Annotations')}
        showTooltip={false}
        className='dropdown-bottom dropdown-end'
        menuClassName='no-triangle mt-1'
        buttonClassName='btn btn-ghost btn-circle h-8 min-h-8 w-8 p-0'
        containerClassName='h-8'
        toggleButton={
          <span className='relative inline-flex'>
            <MdFilterList className='fill-base-content' />
            {hasActiveFilters && (
              <span
                aria-hidden='true'
                className='bg-primary absolute -end-0.5 -top-0.5 h-1.5 w-1.5 rounded-full'
              />
            )}
          </span>
        }
      >
        <AnnotationsFilterPanel
          filterKind={filterKind}
          colors={colors}
          styles={styles}
          excludedColors={excludedColors}
          excludedStyles={excludedStyles}
          hasActiveFilters={hasActiveFilters}
          onFilterKindChange={onFilterKindChange}
          onToggleColor={onToggleColor}
          onToggleStyle={onToggleStyle}
          onResetFilters={onResetFilters}
        />
      </Dropdown>
      <Dropdown
        label={_('Annotations Menu')}
        showTooltip={false}
        className='dropdown-bottom dropdown-end'
        menuClassName='no-triangle mt-1'
        buttonClassName='btn btn-ghost btn-circle h-8 min-h-8 w-8 p-0'
        containerClassName='h-8'
        toggleButton={<MdMoreVert className='fill-base-content' />}
      >
        <AnnotationsMenu bookKey={bookKey} canClear={canClear} />
      </Dropdown>
    </div>
  );
};

export default AnnotationsToolbar;
