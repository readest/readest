import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';
import { FaSearch, FaTimes } from 'react-icons/fa';
import { MdFilterList } from 'react-icons/md';

import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useSettingsStore } from '@/store/settingsStore';
import { HighlightColor, HighlightStyle } from '@/types/book';
import {
  AnnotationFilterKind,
  getHighlightColorHex,
  getHighlightColorLabel,
  isDefaultHighlightColor,
} from '../../utils/annotatorUtil';
import Dropdown from '@/components/Dropdown';

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
  filterKind: AnnotationFilterKind;
  searchInput: string;
  isSearchVisible: boolean;
  highlightCount: number;
  noteCount: number;
  matchCount: number;
  isFiltering: boolean;
  colors: HighlightColor[];
  styles: HighlightStyle[];
  excludedColors: HighlightColor[];
  excludedStyles: HighlightStyle[];
  onFilterKindChange: (kind: AnnotationFilterKind) => void;
  onSearchInputChange: (value: string) => void;
  onCloseSearch: () => void;
  onToggleColor: (color: HighlightColor) => void;
  onToggleStyle: (style: HighlightStyle) => void;
  onResetFilters: () => void;
}

const AnnotationsToolbar: React.FC<AnnotationsToolbarProps> = ({
  filterKind,
  searchInput,
  isSearchVisible,
  highlightCount,
  noteCount,
  matchCount,
  isFiltering,
  colors,
  styles,
  excludedColors,
  excludedStyles,
  onFilterKindChange,
  onSearchInputChange,
  onCloseSearch,
  onToggleColor,
  onToggleStyle,
  onResetFilters,
}) => {
  const _ = useTranslation();
  const iconSize14 = useResponsiveSize(14);
  const iconSize12 = useResponsiveSize(12);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearchVisible) {
      searchInputRef.current?.focus();
    }
  }, [isSearchVisible]);

  const hasActiveFilters =
    filterKind !== 'all' || excludedColors.length > 0 || excludedStyles.length > 0;

  // The search field takes the whole row when it is open, so the summary only
  // speaks while it is closed: the mix of the book's annotations at rest, and
  // how much of it survives the filters once any are on.
  const total = highlightCount + noteCount;
  const kindLabels = [
    highlightCount > 0 && _('{{count}} Highlights', { count: highlightCount }),
    noteCount > 0 && _('{{count}} Notes', { count: noteCount }),
  ].filter(Boolean);
  const summary = isFiltering
    ? _('{{matched}} of {{total}}', { matched: matchCount, total })
    : null;

  return (
    // justify-end, not justify-between: with no annotations yet the filter
    // button is the only child and must still sit at the trailing edge.
    <div className='annotations-toolbar flex items-center justify-end gap-2 ps-3 pe-3 pb-2 pt-2'>
      {!isSearchVisible && total > 0 && (
        <div
          data-testid='annotations-summary'
          aria-live='polite'
          className='text-base-content/60 flex h-8 min-w-0 flex-1 items-center truncate text-xs tabular-nums'
        >
          {summary ?? kindLabels.join(' · ')}
        </div>
      )}
      {isSearchVisible && (
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
              if (e.key === 'Escape') onCloseSearch();
            }}
            placeholder={_('Search annotations...')}
            className='w-full min-w-0 bg-transparent p-2 font-sans text-sm font-light focus:outline-none'
          />
          <button
            onClick={onCloseSearch}
            aria-label={_('Clear')}
            className='btn btn-ghost h-8 min-h-8 w-8 rounded-e-lg rounded-s-none p-0'
          >
            <FaTimes size={iconSize12} className='text-base-content/50' />
          </button>
        </div>
      )}
      <Dropdown
        label={_('Filter Annotations')}
        showTooltip={false}
        className='dropdown-bottom dropdown-end'
        menuClassName='no-triangle mt-1'
        buttonClassName={clsx(
          'btn btn-ghost btn-circle h-6 min-h-6 w-6 p-0',
          hasActiveFilters && 'bg-base-300',
        )}
        containerClassName='h-8 pt-1'
        toggleButton={
          <span className='relative inline-flex'>
            <MdFilterList className='fill-base-content' />
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
    </div>
  );
};

export default AnnotationsToolbar;
