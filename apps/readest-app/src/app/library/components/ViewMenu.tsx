import { eventDispatcher } from '@/utils/event';
import { BOOKSHELF_GROUP_LABELS, BOOKSHELF_SORT_LABELS } from '@/services/bookshelves/definitions';
import {
  METADATA_SORT_BY_ORDER,
  getGlobalBookshelfSort,
  resolveLibrarySortOrder,
} from '@/services/bookshelves/sorting';
import { updateBookshelf } from '@/services/bookshelves/persistence';
import { readBookshelves } from '@/services/bookshelves/state';
import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import {
  LibraryViewModeType,
  LibraryGroupByType,
  LibraryMetadataSortByType,
  LibrarySortByType,
  LibrarySortCriterion,
} from '@/types/settings';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLibrary } from '@/utils/nav';
import NumberInput from '@/components/settings/NumberInput';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import SortPriorityList from './SortPriorityList';
import { ensureLibraryGroupByType } from '../utils/libraryUtils';

interface ViewMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

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
  const customShelf = readBookshelves(settings).find(
    (shelf) =>
      shelf.id === (searchParams?.get('shelf') || 'default') &&
      shelf.useGlobalSort === false &&
      shelf.sort.by === 'custom',
  );
  const displayedSort = customShelf?.sort ?? globalSort;
  const sortBy = displayedSort.by;
  const primaryIsImplicit =
    !customShelf &&
    !searchParams?.get('sort') &&
    (settings.librarySortByAuto ?? true) &&
    globalSort.by !== settings.librarySortBy;
  const secondaryIsImplicit =
    !customShelf &&
    !searchParams?.get('thenSort') &&
    (!settings.libraryThenSortBy || settings.libraryThenSortBy === 'none') &&
    globalSort.thenBy !== 'none';
  const autoSortKeys = [
    primaryIsImplicit && globalSort.by,
    secondaryIsImplicit && globalSort.thenBy,
  ].filter(Boolean) as LibraryMetadataSortByType[];

  const priorityOrder = resolveLibrarySortOrder(settings, globalSort, searchParams);
  const commitQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const pendingCommitsRef = React.useRef(0);
  const latestPriorityOrderRef = React.useRef(priorityOrder);
  // A commit updates settings before router.replace lands, and the stale ?sort=&thenSort=
  // would re-promote the old criteria meanwhile: hold the committed order until it resolves.
  const awaitingResolvedOrderRef = React.useRef(false);
  const orderKey = (order: LibrarySortCriterion[]) =>
    order.map((c) => `${c.by}:${c.ascending}`).join(',');
  if (
    pendingCommitsRef.current === 0 &&
    (!awaitingResolvedOrderRef.current ||
      orderKey(priorityOrder) === orderKey(latestPriorityOrderRef.current))
  ) {
    awaitingResolvedOrderRef.current = false;
    latestPriorityOrderRef.current = priorityOrder;
  }

  const sortLabels = Object.fromEntries(
    METADATA_SORT_BY_ORDER.map((value) => [value, _(BOOKSHELF_SORT_LABELS[value])]),
  ) as Record<LibraryMetadataSortByType, string>;

  const viewOptions = [
    { label: _('List'), value: 'list' },
    { label: _('Grid'), value: 'grid' },
  ];

  const groupByOptions = Object.entries(BOOKSHELF_GROUP_LABELS).map(([value, label]) => ({
    value,
    label: _(label),
  }));

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

  const applyShelfSortNavigation = async (mutateParams: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(window.location.search);
    // An explicit menu choice also exits the custom order enabled by a drop.
    await updateBookshelf(envConfig, params.get('shelf') || 'default', (shelf) =>
      shelf.sort.by === 'custom' ? { ...shelf, useGlobalSort: true } : shelf,
    );
    mutateParams(params);
    navigateToLibrary(router, `${params.toString()}`);
  };

  const commitSortOrder = async (next: LibrarySortCriterion[]) => {
    const [primary, secondary] = next;
    if (!primary) return;
    awaitingResolvedOrderRef.current = true;

    await saveSysSettings(envConfig, 'librarySortCustom', false);
    await saveSysSettings(envConfig, 'librarySortByAuto', false);
    await saveSysSettings(envConfig, 'librarySortBy', primary.by);
    await saveSysSettings(envConfig, 'librarySortAscending', primary.ascending);
    await saveSysSettings(envConfig, 'libraryThenSortBy', secondary ? secondary.by : 'none');
    await saveSysSettings(
      envConfig,
      'libraryThenSortAscending',
      secondary ? secondary.ascending : true,
    );
    await saveSysSettings(envConfig, 'librarySortOrder', next);

    await applyShelfSortNavigation((params) => {
      params.set('sort', primary.by);
      params.set('order', primary.ascending ? 'asc' : 'desc');
      if (secondary) {
        params.set('thenSort', secondary.by);
        params.set('thenOrder', secondary.ascending ? 'asc' : 'desc');
      } else {
        params.delete('thenSort');
        params.delete('thenOrder');
      }
    });
  };

  const enqueueSortCommit = (task: () => Promise<void>) => {
    pendingCommitsRef.current += 1;
    const runTask = async () => {
      try {
        await task();
      } finally {
        pendingCommitsRef.current = Math.max(0, pendingCommitsRef.current - 1);
      }
    };
    const run = commitQueueRef.current.then(runTask, runTask);
    commitQueueRef.current = run.catch(() => {});
    return run;
  };

  const handleReorder = (next: LibrarySortCriterion[]) => {
    latestPriorityOrderRef.current = next;
    return enqueueSortCommit(() => commitSortOrder(next));
  };

  const handleToggleCustom = () => {
    if (sortBy === LibrarySortByType.Custom) {
      const next = latestPriorityOrderRef.current;
      return enqueueSortCommit(() => commitSortOrder(next));
    }
    return enqueueSortCommit(async () => {
      await saveSysSettings(envConfig, 'librarySortCustom', true);
      await saveSysSettings(envConfig, 'librarySortByAuto', false);

      await applyShelfSortNavigation((params) => {
        params.set('sort', LibrarySortByType.Custom);
      });
    });
  };

  const handleToggleCriterionDirection = (by: LibraryMetadataSortByType) => {
    const next = latestPriorityOrderRef.current.map((criterion) =>
      criterion.by === by ? { ...criterion, ascending: !criterion.ascending } : criterion,
    );
    latestPriorityOrderRef.current = next;
    return enqueueSortCommit(() => commitSortOrder(next));
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

      {/* Sort By - Unified Priority List */}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem label={_('Sort by...')} detailsOpen={false} buttonClass='py-1!'>
        <div className='ms-0 flex flex-col ps-0 before:hidden'>
          <MenuItem
            label={_(BOOKSHELF_SORT_LABELS[LibrarySortByType.Custom])}
            buttonClass='min-h-8 py-1!'
            toggled={sortBy === LibrarySortByType.Custom}
            onClick={handleToggleCustom}
          />
          <hr aria-hidden='true' className='border-base-200 my-1' />
          <SortPriorityList
            items={latestPriorityOrderRef.current}
            labels={sortLabels}
            dimmed={sortBy === LibrarySortByType.Custom}
            autoLabel={_('Auto')}
            autoKeys={autoSortKeys}
            onReorder={handleReorder}
            onToggleDirection={handleToggleCriterionDirection}
          />
        </div>
      </MenuItem>
    </Menu>
  );
};

export default ViewMenu;
