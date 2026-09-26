import type { BookshelfDefinition } from '@/types/bookshelf';
import type { LibraryGroupByType, SystemSettings } from '@/types/settings';
import { ensureLibraryGroupByType } from '@/app/library/utils/libraryUtils';
import { readBookshelves } from './state';

export const resolveBookshelfGroupBy = (
  shelf: BookshelfDefinition,
  globalGroupBy: LibraryGroupByType,
) => (shelf.useGlobalGrouping === false ? shelf.groupBy || 'group' : globalGroupBy);

/** Group navigation retains the originating shelf's independent grouping. */
export function getActiveBookshelfGroupBy(
  settings: Partial<SystemSettings>,
  params?: Pick<URLSearchParams, 'get'> | null,
): LibraryGroupByType {
  const globalGroupBy = ensureLibraryGroupByType(
    params?.get('groupBy'),
    settings.libraryGroupBy || 'group',
  );
  const shelf =
    params?.get('group') && params.get('shelf')
      ? readBookshelves(settings).find((s) => s.id === params.get('shelf'))
      : undefined;
  return shelf ? resolveBookshelfGroupBy(shelf, globalGroupBy) : globalGroupBy;
}
