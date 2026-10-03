import type { BookshelfDefinition, BookshelfSort } from '@/types/bookshelf';
import type { SystemSettings } from '@/types/settings';
import {
  ensureLibraryGroupByType,
  ensureLibrarySortByType,
  ensureLibrarySecondarySortByType,
  resolveEffectivePrimarySort,
  resolveEffectiveSecondarySort,
} from '@/app/library/utils/libraryUtils';

export function getGlobalBookshelfSort(
  settings: Partial<SystemSettings>,
  params?: Pick<URLSearchParams, 'get'> | null,
): BookshelfSort {
  const groupBy = ensureLibraryGroupByType(
    params?.get('groupBy'),
    settings.libraryGroupBy || 'group',
  );
  const order = params?.get('order');
  const thenOrder = params?.get('thenOrder');
  return {
    by: ensureLibrarySortByType(
      params?.get('sort'),
      resolveEffectivePrimarySort(
        settings.librarySortBy || 'updated',
        groupBy,
        settings.librarySortByAuto ?? true,
      ),
    ),
    ascending:
      order === 'asc' || order === 'desc'
        ? order === 'asc'
        : (settings.librarySortAscending ?? false),
    thenBy: resolveEffectiveSecondarySort(
      ensureLibrarySecondarySortByType(
        params?.get('thenSort'),
        settings.libraryThenSortBy || 'none',
      ),
      groupBy,
    ),
    thenAscending:
      thenOrder === 'asc' || thenOrder === 'desc'
        ? thenOrder === 'asc'
        : (settings.libraryThenSortAscending ?? true),
  };
}

export const resolveBookshelfSort = (shelf: BookshelfDefinition, globalSort: BookshelfSort) =>
  shelf.useGlobalSort === false ? shelf.sort : globalSort;
