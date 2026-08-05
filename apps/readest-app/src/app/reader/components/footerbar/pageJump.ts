export interface PageListItem {
  label?: string;
  href?: string;
  subitems?: PageListItem[] | null;
}

/**
 * Parse user input as a 1-based page number. The edit field keeps its
 * "94 / 251" shape while the page portion is typed over, so a trailing
 * "/ total" is accepted and ignored.
 */
export function parsePageInput(text: string): number | null {
  const match = text.match(/^\s*(\d+)\s*(?:\/\s*\d*\s*)?$/);
  if (!match) return null;
  const page = parseInt(match[1]!, 10);
  return page > 0 ? page : null;
}

export function clampPage(page: number, total: number): number {
  return Math.min(Math.max(page, 1), total);
}

/**
 * Fraction that lands inside 1-based page N of `total` equal-size pages.
 * Page N spans [(N-1)/T, N/T); aiming at the middle keeps the jump inside
 * the page even when the paginator's boundaries shift slightly.
 */
export function fractionForPage(page: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (page - 0.5) / total));
}

/** Exact href for a reference page label, when the book has a page list. */
export function findReferencePageHref(
  pageList: PageListItem[] | null | undefined,
  page: number,
): string | null {
  if (!pageList?.length) return null;
  const target = String(page);
  for (const item of pageList) {
    if (item.label?.trim() === target && item.href) return item.href;
    const nested = findReferencePageHref(item.subitems, page);
    if (nested) return nested;
  }
  return null;
}
