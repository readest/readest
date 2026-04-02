import * as CFI from 'foliate-js/epubcfi.js';

const unwrapCfi = (cfi: string): string => {
  const match = cfi.match(/^epubcfi\((.+)\)$/);
  return match ? match[1]! : cfi;
};

export function isCfiInLocation(cfi: string, location: string | null | undefined): boolean {
  if (!cfi || !location) return false;
  if (cfi === location) return true;
  if (cfi && unwrapCfi(cfi).startsWith(unwrapCfi(location))) return true;

  const start = CFI.collapse(location);
  const end = CFI.collapse(location, true);

  try {
    return CFI.compare(cfi, start) >= 0 && CFI.compare(cfi, end) <= 0;
  } catch (err) {
    console.warn('Failed to compare CFIs', { cfi, location, error: err });
    return false;
  }
}

/**
 * Binary search a sorted CFI array to find the nearest CFI to a location.
 * Returns the CFI of the item just before or at the location.
 */
export function findNearestCfi(
  sortedCfis: string[],
  location: string | null | undefined,
): string | null {
  if (!location || sortedCfis.length === 0) return null;

  const target = CFI.collapse(location);
  let lo = 0;
  let hi = sortedCfis.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (CFI.compare(sortedCfis[mid]!, target) <= 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // lo is the first index where cfi > target
  // The nearest item at or before target is lo - 1
  if (lo === 0) return sortedCfis[0]!;
  if (lo >= sortedCfis.length) return sortedCfis[sortedCfis.length - 1]!;
  return sortedCfis[lo - 1]!;
}

export function getIndexFromCfi(cfi: string): number | null {
  try {
    const parts = CFI.parse(cfi);
    return CFI.fake.toIndex((parts.parent ?? parts).shift());
  } catch {
    return null;
  }
}
