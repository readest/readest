import { eventDispatcher } from '@/utils/event';
import { BOOKSHELF_GROUP_LABELS, BOOKSHELF_SORT_LABELS } from '@/services/bookshelves/definitions';
import { getGlobalBookshelfSort } from '@/services/bookshelves/sorting';
import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import {
  LibraryViewModeType,
  LibraryGroupByType,
  LibrarySecondarySortByType,
  LibrarySortByType,
} from '@/types/settings';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLibrary } from '@/utils/nav';
import NumberInput from '@/components/settings/NumberInput';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import { ensureLibraryGroupByType } from '../utils/libraryUtils';

interface ViewMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const SORT_BY_ORDER: LibrarySortByType[] = [
  LibrarySortByType.Title,
  LibrarySortByType.Author,
  LibrarySortByType.Format,
  LibrarySortByType.Series,
  LibrarySortByType.Updated,
  LibrarySortByType.Created,
  LibrarySortByType.Published,
  LibrarySortByType.Progress,
  LibrarySortByType.TimeRemaining,
];

const ViewMenu: React.FC<ViewMenuProps> = ({ setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();

  const viewMode = searchParams?.get('view') || settings.libraryViewMode;
  const autoColumns = settings.libraryAutoColumns;
  const columns = settings.libraryColumns;
  const groupBy = ensureLibraryGroupByType(searchParams?.get('groupBy'), settings.libraryGroupBy);
  const globalSort = getGlobalBookshelfSort(settings, searchParams);
  const sortBy = globalSort.by;
  const isAscending = globalSort.ascending;
  const primaryEffective = globalSort.by;
  const primaryIsImplicit =
    !searchParams?.get('sort') &&
    (settings.librarySortByAuto ?? true) &&
    globalSort.by !== settings.librarySortBy;
  const thenSortBy = globalSort.thenBy;
  const secondaryEffective = globalSort.thenBy;
  const secondaryIsImplicit =
    !searchParams?.get('thenSort') &&
    (!settings.libraryThenSortBy || settings.libraryThenSortBy === 'none') &&
    globalSort.thenBy !== 'none';
  const isThenAscending = globalSort.thenAscending;

  const viewOptions = [
    { label: _('List'), value: 'list' },
    { label: _('Grid'), value: 'grid' },
  ];

  const groupByOptions = Object.entries(BOOKSHELF_GROUP_LABELS).map(([value, label]) => ({
    value,
    label: _(label),
  }));

  // Menu order, deliberately excluding Size: the library has never offered it.
  const sortByOptions = SORT_BY_ORDER.map((value) => ({
    value,
    label: _(BOOKSHELF_SORT_LABELS[value]),
  }));

  const thenSortByOptions: { label: string; value: LibrarySecondarySortByType }[] = [
    { label: _('None'), value: 'none' },
    ...sortByOptions,
  ];

  const sortingOptions = [
    { label: _('Ascending'), value: true },
    { label: _('Descending'), value: false },
  ];

  const handleSetViewMode = async (value: LibraryViewModeType) => {
    await saveSysSettings(envConfig, 'libraryViewMode', value);

    const params = new URLSearchParams(window.location.search);
    params.set('view', value);
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleToggleAutoColumns = async () => {
    const newValue = !settings.libraryAutoColumns;
    await saveSysSettings(envConfig, 'libraryAutoColumns', newValue);
  };

  const handleSetColumns = async (value: number) => {
    await saveSysSettings(envConfig, 'libraryColumns', value);
    await saveSysSettings(envConfig, 'libraryAutoColumns', false);
  };

  const handleSetGroupBy = async (value: LibraryGroupByType) => {
    await saveSysSettings(envConfig, 'libraryGroupBy', value);

    const params = new URLSearchParams(window.location.search);
    if (value === LibraryGroupByType.Group) {
      params.delete('groupBy');
    } else {
      params.set('groupBy', value);
    }
    // Clear group navigation when changing groupBy mode
    params.delete('group');
    params.delete('shelf');
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleSetSortBy = async (value: LibrarySortByType) => {
    await saveSysSettings(envConfig, 'librarySortBy', value);
    // Any explicit primary pick locks in the choice and disables the auto
    // smart-default so future groupBy changes don't override the user.
    await saveSysSettings(envConfig, 'librarySortByAuto', false);

    const params = new URLSearchParams(window.location.search);
    params.set('sort', value);
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleSetSortAscending = async (value: boolean) => {
    await saveSysSettings(envConfig, 'librarySortAscending', value);

    const params = new URLSearchParams(window.location.search);
    params.set('order', value ? 'asc' : 'desc');
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleSetThenSortBy = async (value: LibrarySecondarySortByType) => {
    await saveSysSettings(envConfig, 'libraryThenSortBy', value);

    const params = new URLSearchParams(window.location.search);
    if (value === 'none') {
      params.delete('thenSort');
    } else {
      params.set('thenSort', value);
    }
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleSetThenSortAscending = async (value: boolean) => {
    await saveSysSettings(envConfig, 'libraryThenSortAscending', value);

    const params = new URLSearchParams(window.location.search);
    params.set('thenOrder', value ? 'asc' : 'desc');
    navigateToLibrary(router, `${params.toString()}`);
  };

  return (
    <Menu
      className='view-menu dropdown-content no-triangle z-20 mt-2 shadow-2xl'
      style={{ marginRight: appService?.isMobile || window.innerWidth < 640 ? '-40px' : 0 }}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      <MenuItem
        label={_('Bookshelves')}
        buttonClass='min-h-11'
        onClick={() => {
          eventDispatcher.dispatch('show-bookshelves');
          setIsDropdownOpen?.(false);
        }}
        transient
      />
      <hr aria-hidden='true' className='border-base-200 my-1' />
      {/* View Mode */}
      {viewOptions.map((option) => (
        <MenuItem
          key={option.value}
          label={option.label}
          buttonClass='min-h-8 py-1!'
          toggled={viewMode === option.value}
          onClick={() => handleSetViewMode(option.value as LibraryViewModeType)}
          transient
        />
      ))}

      {/* Columns */}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem
        label={_('Columns')}
        buttonClass='min-h-8 py-1!'
        labelClass='text-sm sm:text-xs'
        disabled
      />
      <MenuItem
        label={_('Auto')}
        buttonClass='min-h-10 py-2!'
        toggled={autoColumns}
        disabled={viewMode === 'list'}
        siblings={
          <NumberInput
            className='h-10! p-0! pe-1! ps-0!'
            inputClassName={`p-0! text-center text-base sm:text-sm w-10! h-6! pe-0! ${autoColumns ? 'opacity-50' : ''}`}
            label={''}
            value={columns}
            disabled={viewMode === 'list'}
            onChange={handleSetColumns}
            min={window.innerWidth < 640 ? 1 : window.innerWidth < 1024 ? 2 : 3}
            max={window.innerWidth < 640 ? 4 : window.innerWidth < 1024 ? 6 : 12}
          />
        }
        onClick={() => handleToggleAutoColumns()}
      />

      {/* Group By - Collapsible */}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem label={_('Group by...')} detailsOpen={true} buttonClass='py-1!'>
        <ul className='ms-0 flex flex-col ps-0 before:hidden'>
          {groupByOptions.map((option) => (
            <MenuItem
              key={option.value}
              label={option.label}
              buttonClass='min-h-8 py-1!'
              toggled={groupBy === option.value}
              onClick={() => handleSetGroupBy(option.value as LibraryGroupByType)}
              transient
            />
          ))}
        </ul>
      </MenuItem>

      {/* Sort By - Collapsible */}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem label={_('Sort by...')} detailsOpen={false} buttonClass='py-1!'>
        <ul className='ms-0 flex flex-col ps-0 before:hidden'>
          {sortByOptions.map((option) => {
            const isImplicit = primaryIsImplicit && option.value === primaryEffective;
            const toggled = isImplicit || (!primaryIsImplicit && sortBy === option.value);
            return (
              <MenuItem
                key={option.value}
                label={isImplicit ? `${option.label} (${_('Auto')})` : option.label}
                buttonClass='min-h-8 py-1!'
                toggled={toggled}
                onClick={() => handleSetSortBy(option.value as LibrarySortByType)}
                transient
              />
            );
          })}
          <hr aria-hidden='true' className='border-base-200 my-1' />
          {sortingOptions.map((option) => (
            <MenuItem
              key={option.value.toString()}
              label={option.label}
              buttonClass='min-h-8 py-1!'
              toggled={isAscending === option.value}
              onClick={() => handleSetSortAscending(option.value)}
              transient
            />
          ))}
        </ul>
      </MenuItem>

      {/* Then by - secondary sort, collapsible */}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem label={_('Then by...')} detailsOpen={false} buttonClass='py-1!'>
        <ul className='ms-0 flex flex-col ps-0 before:hidden'>
          {thenSortByOptions.map((option) => {
            const isImplicit = secondaryIsImplicit && option.value === secondaryEffective;
            const isExplicit = thenSortBy === option.value;
            return (
              <MenuItem
                key={option.value}
                label={isImplicit ? `${option.label} (${_('Auto')})` : option.label}
                buttonClass='min-h-8 py-1!'
                toggled={isExplicit || isImplicit}
                onClick={() => handleSetThenSortBy(option.value)}
                transient
              />
            );
          })}
          {secondaryEffective !== 'none' && (
            <>
              <hr aria-hidden='true' className='border-base-200 my-1' />
              {sortingOptions.map((option) => (
                <MenuItem
                  key={option.value.toString()}
                  label={option.label}
                  buttonClass='min-h-8 py-1!'
                  toggled={isThenAscending === option.value}
                  onClick={() => handleSetThenSortAscending(option.value)}
                  transient
                />
              ))}
            </>
          )}
        </ul>
      </MenuItem>
    </Menu>
  );
};

export default ViewMenu;
