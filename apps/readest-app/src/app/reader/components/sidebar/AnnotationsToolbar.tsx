import clsx from 'clsx';
import React from 'react';
import { FaSearch, FaTimes } from 'react-icons/fa';
import { MdMoreVert } from 'react-icons/md';

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
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

// Same events BookMenu dispatches; the dialogs live in Annotator, which
// outlives this dropdown, so they are not unmounted with the menu.
const AnnotationsMenu: React.FC<AnnotationsMenuProps> = ({
  bookKey,
  canClear,
  setIsDropdownOpen,
}) => {
  const _ = useTranslation();
  const dispatchAndClose = (event: string) => {
    eventDispatcher.dispatch(event, { bookKey });
    setIsDropdownOpen?.(false);
  };
  return (
    <Menu
      className='annotations-menu dropdown-content z-20 shadow-2xl'
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
}

const FILTER_KINDS: AnnotationFilterKind[] = ['all', 'highlights', 'notes'];

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
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const iconSize14 = useResponsiveSize(14);
  const iconSize12 = useResponsiveSize(12);

  const filterLabels: Record<AnnotationFilterKind, string> = {
    all: _('All'),
    highlights: _('Highlights'),
    notes: _('Notes'),
  };

  // The >=2 gate lives here: a facet the user cannot vary is noise, and a
  // single-value filter row could silently hide notes (mirrors the
  // filterExportGroups applyColorFilter/applyStyleFilter rule).
  const showColors = colors.length >= 2;
  const showStyles = styles.length >= 2;

  const resolveColorLabel = (color: HighlightColor) =>
    getHighlightColorLabel(settings, color) || (isDefaultHighlightColor(color) ? _(color) : color);

  return (
    <div className='annotations-toolbar flex flex-col gap-2 px-3 pt-1'>
      <div className='flex items-center gap-1'>
        <div className='eink-bordered bg-base-100 flex h-8 min-w-0 flex-1 items-center rounded-lg'>
          <div className='ps-3'>
            <FaSearch size={iconSize14} className='text-base-content/50' />
          </div>
          <input
            type='text'
            value={searchInput}
            spellCheck={false}
            dir='auto'
            onChange={(e) => onSearchInputChange(e.target.value)}
            placeholder={_('Search annotations...')}
            className='w-full min-w-0 bg-transparent p-2 font-sans text-sm font-light focus:outline-none'
          />
          {searchInput && (
            <button
              onClick={() => onSearchInputChange('')}
              aria-label={_('Clear')}
              className='btn btn-ghost h-8 min-h-8 w-8 rounded-e-lg rounded-s-none p-0'
            >
              <FaTimes size={iconSize12} className='text-base-content/50' />
            </button>
          )}
        </div>
        <Dropdown
          label={_('Annotations Menu')}
          showTooltip={false}
          className='dropdown-bottom dropdown-end'
          menuClassName='no-triangle mt-1'
          buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
          containerClassName='h-8'
          toggleButton={<MdMoreVert className='fill-base-content' />}
        >
          <AnnotationsMenu bookKey={bookKey} canClear={canClear} />
        </Dropdown>
      </div>
      <div className='flex items-center gap-1.5' role='group' aria-label={_('Filter Annotations')}>
        {FILTER_KINDS.map((kind) => (
          <button
            key={kind}
            type='button'
            aria-pressed={filterKind === kind}
            onClick={() => onFilterKindChange(kind)}
            className={clsx(
              'eink-bordered btn btn-ghost h-7 min-h-7 rounded-full px-3 text-xs font-normal',
              filterKind === kind ? 'bg-base-300 hover:bg-base-300' : 'bg-base-200/50',
            )}
          >
            {filterLabels[kind]}
          </button>
        ))}
      </div>
      {(showColors || showStyles) && (
        <div
          className='flex flex-wrap items-center gap-1.5'
          role='group'
          aria-label={_('Filter by Color or Style')}
        >
          {showColors &&
            colors.map((color) => {
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
          {showColors && showStyles && (
            <span aria-hidden='true' className='bg-base-content/20 mx-0.5 h-4 w-px' />
          )}
          {showStyles &&
            styles.map((style) => {
              const included = !excludedStyles.includes(style);
              return (
                <button
                  key={style}
                  type='button'
                  aria-pressed={included}
                  onClick={() => onToggleStyle(style)}
                  className={clsx(
                    'eink-bordered btn btn-ghost h-6 min-h-6 rounded-full px-2 text-xs font-normal',
                    included ? 'bg-base-200/50' : 'opacity-40 line-through',
                  )}
                >
                  {_(style)}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
};

export default AnnotationsToolbar;
