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
 * Batch variant of {@link isCfiInLocation}. The standalone function calls
 * `CFI.collapse(location)` twice on every invocation — that's two CFI
 * parses plus the prefix dance in `unwrapCfi`. When the reader hooks
 * (useBooknotesNav, useSearchNav) loop over hundreds of annotations or
 * search hits per page turn, those redundant parses add up to a real
 * fraction of main-thread time (visible as `c` and the anonymous
 * `parse` callback in Bottom-Up profiles of the foliate `epubcfi.js`
 * chunk).
 *
 * `createCfiLocationMatcher(location)` collapses the location once and
 * returns a `matches(cfi)` predicate that reuses the cached bounds for
 * every call. Use it whenever you're iterating a list of CFIs against
 * the same `currentLocation`.
 */
export function createCfiLocationMatcher(
  location: string | null | undefined,
): (cfi: string) => boolean {
  if (!location) return () => false;

  // Pre-unwrap the location once for the cheap prefix match below.
  const unwrappedLocation = unwrapCfi(location);

  // Collapse once. If collapse throws on a malformed location the
  // matcher degrades to the cheap equality / prefix branch only —
  // matching the failure mode of the original isCfiInLocation, which
  // would also bail via the catch block on a bad compare input.
  let start: string | null = null;
  let end: string | null = null;
  try {
    start = CFI.collapse(location);
    end = CFI.collapse(location, true);
  } catch (err) {
    console.warn('Failed to collapse location for matcher', { location, error: err });
  }

  return (cfi: string): boolean => {
    if (!cfi) return false;
    if (cfi === location) return true;
    if (unwrapCfi(cfi).startsWith(unwrappedLocation)) return true;
    if (start === null || end === null) return false;
    try {
      return CFI.compare(cfi, start) >= 0 && CFI.compare(cfi, end) <= 0;
    } catch (err) {
      console.warn('Failed to compare CFIs', { cfi, location, error: err });
      return false;
    }
  };
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

/**
 * Detect a degenerate range CFI whose start or end path is empty — e.g.
 * `epubcfi(/6/24!/4,,/20/1:58)`. These were produced by the cfi-inert skip-link
 * bug (fixed in foliate 569cc06): the visible-range start/end anchored on an
 * injected a11y skip-link, foliate dropped that inert step, and the range
 * silently collapsed to the section boundary. Such a CFI resolves to a
 * section-spanning range that navigates to the wrong end of the section, so a
 * synced/saved location matching this shape should be discarded rather than
 * trusted. Well-formed point and range CFIs return false.
 */
export function isMalformedLocationCfi(cfi: string): boolean {
  try {
    const parts = CFI.parse(cfi);
    if (!parts.parent) return false;
    const isEmptyPath = (segment: unknown): boolean =>
      Array.isArray(segment) &&
      segment.every((group) => Array.isArray(group) && group.length === 0);
    return isEmptyPath(parts.start) || isEmptyPath(parts.end);
  } catch {
    return false;
  }
}

export function getIndexFromCfi(cfi: string): number | null {
  try {
    const parts = CFI.parse(cfi);
    return CFI.fake.toIndex((parts.parent ?? parts).shift());
  } catch {
    return null;
  }
}

/**
 * Extract the EPUB CFI "spine prefix" — the portion that identifies the
 * spine item (chapter / section) without descending into the in-document
 * path.
 *
 * EPUB CFI form: `epubcfi(<spine-path>!<inside-path>)` or
 * `epubcfi(<spine-path>)`. The spine path uniquely identifies which
 * chapter the CFI lives in; everything past `!` is intra-chapter.
 *
 * Returns the unwrapped spine prefix (no `epubcfi(...)` wrapper) suitable
 * for bucketing CFIs by chapter. Returns null for inputs that aren't
 * recognisably a CFI — callers should use this as a hint and fall back
 * to the full range matcher when the prefix is missing.
 *
 * Examples:
 *   'epubcfi(/6/24!/4/2:5)' → '/6/24'
 *   'epubcfi(/6/12)'        → '/6/12'
 *   'not a cfi'             → null
 *
 * This is a pure string operation — no CFI.parse round-trip, so it's
 * cheap enough to call once per booknote when bucketing.
 */
export function getCfiSpinePrefix(cfi: string | null | undefined): string | null {
  if (!cfi) return null;
  const match = cfi.match(/^epubcfi\((.+)\)$/);
  if (!match) return null;
  const inner = match[1]!;
  const bang = inner.indexOf('!');
  return bang === -1 ? inner : inner.slice(0, bang);
}
