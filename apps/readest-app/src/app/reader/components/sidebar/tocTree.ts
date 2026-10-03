import { TOCItem } from '@/libs/document';
import { findParentPath } from '@/services/nav';
import type { PageThumbnailsItem, TOCDisplayItem, TOCListItem } from './TOCItem';

const DEFAULT_THUMBNAILS_PER_ROW = 3;
const MIN_THUMBNAILS_PER_ROW = 2;
const MAX_THUMBNAILS_PER_ROW = 4;
// Narrowest thumbnail cell (padding included) before a row drops a column.
const MIN_THUMBNAIL_WIDTH = 72;
// Horizontal padding of a thumbnail row at the top level.
const THUMBNAIL_ROW_PADDING = 24;

export interface PageRange {
  start: number;
  end: number; // exclusive
}

export const getItemIdentifier = (item: TOCItem) => {
  const href = item.href || '';
  return `toc-item-${item.id}-${href}`;
};

// Decide which TOC nodes to auto-expand. Only the ancestors of the current
// reading location are "necessary" — expanding just that path reveals where
// the reader is while leaving the rest of a deep, multi-volume hierarchy
// collapsed and easy to scan (issue #4059). When there's no resolvable reading
// position yet, keep everything collapsed, except a lone wrapping root
// container — otherwise the sidebar would show a single uninformative row.
export const computeExpandedSet = (toc: TOCItem[], href: string | undefined): Set<string> => {
  const parents = href ? findParentPath(toc, href).map(getItemIdentifier) : [];
  if (parents.length) return new Set(parents);
  if (toc.length === 1 && toc[0]?.subitems?.length) {
    return new Set([getItemIdentifier(toc[0])]);
  }
  return new Set();
};

// Pages each TOC item covers before the next entry begins. Keyed by the item
// itself: ids are assigned to TOC items in place after the first render. When
// entries share a start page (a part and its first chapter), the first one in
// outline order owns it, matching the entry a PDF relocate marks active, so no
// page is listed twice.
export const computeTOCPageRanges = (toc: TOCItem[], totalPages: number) => {
  const owners = new Map<number, TOCItem>();
  const visit = (items: TOCItem[]) => {
    for (const item of items) {
      const page = item.index;
      if (Number.isInteger(page) && page >= 0 && page < totalPages && !owners.has(page)) {
        owners.set(page, item);
      }
      if (item.subitems) visit(item.subitems);
    }
  };
  visit(toc);
  const starts = [...owners.keys()].sort((a, b) => a - b);
  const ranges = new Map<TOCItem, PageRange>();
  starts.forEach((start, i) => {
    ranges.set(owners.get(start)!, { start, end: starts[i + 1] ?? totalPages });
  });
  return ranges;
};

export const getThumbnailsPerRow = (tocWidth: number) => {
  if (tocWidth <= 0) return DEFAULT_THUMBNAILS_PER_ROW;
  const fit = Math.floor((tocWidth - THUMBNAIL_ROW_PADDING) / MIN_THUMBNAIL_WIDTH);
  return Math.min(MAX_THUMBNAILS_PER_ROW, Math.max(MIN_THUMBNAILS_PER_ROW, fit));
};

export const buildPageThumbnailRows = (
  { start, end }: PageRange,
  depth: number,
  perRow = DEFAULT_THUMBNAILS_PER_ROW,
): PageThumbnailsItem[] => {
  const rows: PageThumbnailsItem[] = [];
  for (let page = start; page < end; page += perRow) {
    const pages = Array.from({ length: Math.min(perRow, end - page) }, (_, i) => page + i);
    rows.push({ isPageThumbnails: true, depth, pages });
  }
  return rows;
};

// An unfolded item lists its own page thumbnails first, then its subitems.
export const flattenTOC = (
  items: TOCItem[],
  expandedItems: Set<string>,
  pageRanges?: Map<TOCItem, PageRange>,
  thumbnailsPerRow = DEFAULT_THUMBNAILS_PER_ROW,
  depth = 0,
): TOCListItem[] => {
  const result: TOCListItem[] = [];
  items.forEach((item, index) => {
    const isExpanded = expandedItems.has(getItemIdentifier(item));
    const pageRange = pageRanges?.get(item);
    result.push({ item, depth, index, isExpanded, hasPages: !!pageRange });
    if (!isExpanded) return;
    if (pageRange) {
      result.push(...buildPageThumbnailRows(pageRange, depth + 1, thumbnailsPerRow));
    }
    if (item.subitems) {
      result.push(
        ...flattenTOC(item.subitems, expandedItems, pageRanges, thumbnailsPerRow, depth + 1),
      );
    }
  });
  return result;
};

// Row to keep in view: the thumbnails holding the current page when they're
// unfolded, otherwise the active TOC item.
export const findActiveRowIndex = (
  rows: TOCDisplayItem[],
  activeHref: string | null,
  currentPage?: number,
) => {
  if (currentPage !== undefined) {
    const idx = rows.findIndex((r) => 'pages' in r && r.pages.includes(currentPage));
    if (idx !== -1) return idx;
  }
  return activeHref ? rows.findIndex((r) => 'item' in r && r.item.href === activeHref) : -1;
};
