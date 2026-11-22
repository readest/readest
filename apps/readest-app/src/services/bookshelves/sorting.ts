import type { BookshelfDefinition, BookshelfSort } from '@/types/bookshelf';
import {
  LibrarySortByType,
  type LibraryMetadataSortByType,
  type LibrarySortCriterion,
  type SystemSettings,
} from '@/types/settings';
import {
  ensureLibraryGroupByType,
  ensureLibrarySortByType,
  ensureLibrarySecondarySortByType,
  resolveEffectivePrimarySort,
  resolveEffectiveSecondarySort,
} from '@/app/library/utils/libraryUtils';

export const METADATA_SORT_BY_ORDER: LibraryMetadataSortByType[] = [
  LibrarySortByType.Title,
  LibrarySortByType.Author,
  LibrarySortByType.Format,
  LibrarySortByType.Pages,
  LibrarySortByType.Series,
  LibrarySortByType.Updated,
  LibrarySortByType.Created,
  LibrarySortByType.Published,
  LibrarySortByType.Progress,
  LibrarySortByType.TimeRemaining,
];

const METADATA_SORT_KEY_SET = new Set<string>(METADATA_SORT_BY_ORDER);

const DEFAULT_ASCENDING_BY_KEY: Record<LibraryMetadataSortByType, boolean> = {
  [LibrarySortByType.Title]: true,
  [LibrarySortByType.Author]: true,
  [LibrarySortByType.Format]: true,
  [LibrarySortByType.Pages]: true,
  [LibrarySortByType.Series]: true,
  [LibrarySortByType.Updated]: false,
  [LibrarySortByType.Created]: false,
  [LibrarySortByType.Published]: false,
  [LibrarySortByType.Progress]: false,
  [LibrarySortByType.TimeRemaining]: true,
};

const isMetadataSortKey = (value: string): value is LibraryMetadataSortByType =>
  METADATA_SORT_KEY_SET.has(value);

type SortUrlParams = {
  sort: string | null;
  order: string | null;
  thenSort: string | null;
  thenOrder: string | null;
};

const readSortUrlParams = (params?: Pick<URLSearchParams, 'get'> | null): SortUrlParams => ({
  sort: params?.get('sort') ?? null,
  order: params?.get('order') ?? null,
  thenSort: params?.get('thenSort') ?? null,
  thenOrder: params?.get('thenOrder') ?? null,
});

const sortUrlParamsEqual = (a: SortUrlParams, b: SortUrlParams): boolean =>
  a.sort === b.sort &&
  a.order === b.order &&
  a.thenSort === b.thenSort &&
  a.thenOrder === b.thenOrder;

type PendingSortUrlSync = {
  superseded: SortUrlParams[];
  expected: SortUrlParams;
};

let pendingSortUrlSync: PendingSortUrlSync | null = null;

/**
 * Record an in-flight sort URL navigation from `ViewMenu` so stale `searchParams`
 * (including superseded intermediate targets from rapid consecutive commits)
 * captured before `router.replace` settles do not demote newly committed ranks.
 */
export function markPendingLibrarySortUrlSync(
  staleParams?: Pick<URLSearchParams, 'get'> | null,
  expectedParams?: Pick<URLSearchParams, 'get'> | null,
): void {
  const stale = readSortUrlParams(staleParams);
  const expected = readSortUrlParams(expectedParams);
  if (sortUrlParamsEqual(stale, expected)) {
    pendingSortUrlSync = null;
    return;
  }
  const candidates: SortUrlParams[] = pendingSortUrlSync
    ? [...pendingSortUrlSync.superseded, pendingSortUrlSync.expected, stale]
    : [stale];
  const superseded: SortUrlParams[] = [];
  for (const candidate of candidates) {
    if (
      !sortUrlParamsEqual(candidate, expected) &&
      !superseded.some((existing) => sortUrlParamsEqual(existing, candidate))
    ) {
      superseded.push(candidate);
    }
  }
  pendingSortUrlSync = superseded.length > 0 ? { superseded, expected } : null;
}

export function clearPendingLibrarySortUrlSync(): void {
  pendingSortUrlSync = null;
}

export function resolveEffectiveLibrarySortSearchParams(
  params?: Pick<URLSearchParams, 'get'> | null,
): Pick<URLSearchParams, 'get'> | null | undefined {
  if (!pendingSortUrlSync || !params) return params;
  const current = readSortUrlParams(params);
  if (sortUrlParamsEqual(current, pendingSortUrlSync.expected)) {
    pendingSortUrlSync = null;
    return params;
  }
  if (pendingSortUrlSync.superseded.some((stale) => sortUrlParamsEqual(current, stale))) {
    return null;
  }
  pendingSortUrlSync = null;
  return params;
}

/**
 * Resolve a complete, deduplicated priority list of all metadata sort criteria.
 * Preserves stored `librarySortOrder` when present and reconciles URL overrides
 * or smart-default primary/secondary picks at the front of the list.
 */
export function resolveLibrarySortOrder(
  settings: Partial<SystemSettings>,
  effectiveSort: Pick<
    BookshelfSort,
    'by' | 'ascending' | 'thenBy' | 'thenAscending'
  > = getGlobalBookshelfSort(settings),
  params?: Pick<URLSearchParams, 'get'> | null,
): LibrarySortCriterion[] {
  const seen = new Set<LibraryMetadataSortByType>();
  const result: LibrarySortCriterion[] = [];

  if (Array.isArray(settings.librarySortOrder)) {
    for (const item of settings.librarySortOrder) {
      if (item && isMetadataSortKey(item.by) && !seen.has(item.by)) {
        seen.add(item.by);
        result.push({ by: item.by, ascending: Boolean(item.ascending) });
      }
    }
  }

  for (const key of METADATA_SORT_BY_ORDER) {
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ by: key, ascending: DEFAULT_ASCENDING_BY_KEY[key] });
    }
  }

  const promote = (key: LibraryMetadataSortByType, index: number, ascending?: boolean) => {
    const existingIdx = result.findIndex((c) => c.by === key);
    if (existingIdx === -1) return;
    const [item] = result.splice(existingIdx, 1);
    result.splice(index, 0, {
      by: item!.by,
      ascending: ascending ?? item!.ascending,
    });
  };

  const effectiveParams = resolveEffectiveLibrarySortSearchParams(params);
  const hasStoredOrder =
    Array.isArray(settings.librarySortOrder) && settings.librarySortOrder.length > 0;
  if (hasStoredOrder) {
    const parseOrder = (value?: string | null) =>
      value === 'asc' ? true : value === 'desc' ? false : undefined;
    const urlSort = effectiveParams?.get('sort');
    const urlOrder = parseOrder(effectiveParams?.get('order'));
    const urlThenSort = effectiveParams?.get('thenSort');
    const urlThenOrder = parseOrder(effectiveParams?.get('thenOrder'));

    if (urlSort && isMetadataSortKey(urlSort)) {
      promote(urlSort, 0, urlOrder);
    } else if (urlOrder !== undefined && result[0]) {
      result[0] = { ...result[0], ascending: urlOrder };
    }
    if (urlThenSort && isMetadataSortKey(urlThenSort) && urlThenSort !== result[0]?.by) {
      promote(urlThenSort, 1, urlThenOrder);
    } else if (urlThenOrder !== undefined && result[1]) {
      result[1] = { ...result[1], ascending: urlThenOrder };
    }
    return result;
  }

  const primary =
    effectiveSort.by === LibrarySortByType.Custom
      ? (settings.librarySortBy ?? LibrarySortByType.Updated)
      : effectiveSort.by;
  const secondary = effectiveSort.thenBy;

  if (isMetadataSortKey(primary)) {
    promote(primary, 0, effectiveSort.ascending);
  }
  if (secondary !== 'none' && isMetadataSortKey(secondary) && secondary !== result[0]?.by) {
    promote(secondary, 1, effectiveSort.thenAscending);
  }

  return result;
}

export function getGlobalBookshelfSort(
  settings: Partial<SystemSettings>,
  params?: Pick<URLSearchParams, 'get'> | null,
): BookshelfSort {
  const effectiveParams = resolveEffectiveLibrarySortSearchParams(params);
  const groupBy = ensureLibraryGroupByType(
    params?.get('groupBy'),
    settings.libraryGroupBy || 'group',
  );
  const order = effectiveParams?.get('order');
  const thenOrder = effectiveParams?.get('thenOrder');
  return {
    by: ensureLibrarySortByType(
      effectiveParams?.get('sort'),
      settings.librarySortCustom
        ? 'custom'
        : resolveEffectivePrimarySort(
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
        effectiveParams?.get('thenSort'),
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

export const resolveBookshelfSortOrder = (
  shelf: Pick<BookshelfDefinition, 'useGlobalSort' | 'sort'>,
  globalSortOrder?: LibrarySortCriterion[],
): LibrarySortCriterion[] | undefined =>
  shelf.useGlobalSort !== false && shelf.sort.by !== LibrarySortByType.Custom
    ? globalSortOrder
    : undefined;

/** Metadata still orders unpinned items when a shelf has a manual order. */
export const resolveBookshelfMetadataSort = (
  shelf: Pick<BookshelfDefinition, 'sort' | 'customSortFallback'>,
): BookshelfSort => {
  if (shelf.sort.by !== 'custom') return shelf.sort;
  const fallback = shelf.customSortFallback;
  return fallback && fallback.by !== 'custom'
    ? fallback
    : { by: 'updated', ascending: false, thenBy: 'none', thenAscending: true };
};
