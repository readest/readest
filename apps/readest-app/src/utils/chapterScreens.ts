import { SIZE_PER_LOC } from '@/services/constants';

/**
 * Sections foliate renders as chunks (matching paginator's CHUNK_THRESHOLD)
 * report chunk-local renderer coordinates that reset at every chunk boundary,
 * so they are excluded from sampling and stay byte-estimated.
 */
export const CHUNKED_SECTION_THRESHOLD = 512 * 1024;

/**
 * Session-scoped measured spread counts per chapter, sampled as chapters
 * become the primary section (FoliateViewer records them on entry). Consumed
 * by the calibrated book-level page pair in the 页码 readout.
 *
 * Never persisted: the counts are specific to this device, viewport and
 * settings, and any re-layout invalidates them. Within a session the map
 * holds the current layout's own measurements, so it cannot go stale - it is
 * not a cache of a past layout, it is the present one.
 */
const maps = new Map<string, Map<number, number>>();

/**
 * The per-open snapshot the readout computes from, taken when a chapter is
 * entered. The live map keeps updating underneath (the preload window loads
 * and re-lays-out sections as the reader moves), but the snapshot freezes the
 * weights so the readout advances exactly one page per turn within a chapter;
 * entering the next chapter re-snapshots and adopts every accumulated
 * correction at that boundary - never mid-chapter.
 */
const snapshots = new Map<string, Map<number, number>>();

export const recordChapterScreens = (bookKey: string, spine: number, pages: number) => {
  if (!(pages > 0)) return;
  let map = maps.get(bookKey);
  if (!map) maps.set(bookKey, (map = new Map()));
  map.set(spine, pages);
};

export const getMeasuredChapterScreens = (bookKey: string) => maps.get(bookKey);

/**
 * Bumped by every snapshot, so readouts that render outside a relocate (the
 * TOC, the footer bar, a setting turned off with no page turn) re-render from
 * it through useSyncExternalStore.
 */
let version = 0;
const listeners = new Set<() => void>();
export const getChapterScreensVersion = () => version;
export const subscribeChapterScreens = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const publish = () => {
  version++;
  listeners.forEach((listener) => listener());
};

/** Freeze the live measurements into the readout snapshot at chapter entry. */
export const snapshotChapterScreens = (bookKey: string) => {
  const live = maps.get(bookKey);
  if (live) snapshots.set(bookKey, new Map(live));
  else snapshots.delete(bookKey);
  publish();
};

/**
 * A chapter can grow after its entry snapshot (late images or fonts). Once
 * the reader pages past the snapshot's count, the snapshot takes the
 * chapter's live count, so the total, the jumps and the TOC all count the
 * added screens. Before that the snapshot holds: adopting the live map
 * mid-chapter would move the base and total under the reader.
 */
export const growChapterScreens = (bookKey: string, spine: number, page: number) => {
  const snapshot = snapshots.get(bookKey);
  const count = snapshot?.get(spine);
  if (!snapshot || count === undefined || page < count) return;
  snapshot.set(spine, Math.max(page + 1, maps.get(bookKey)?.get(spine) ?? 0));
  publish();
};

export const clearChapterScreens = (bookKey: string) => {
  maps.delete(bookKey);
  snapshots.delete(bookKey);
};

/**
 * Harvest the measured spread counts of every loaded section from
 * renderer.getContents(): the primary section, its preloaded neighbors, and
 * every rendered chunk of a chunked section (items share the spine index, so
 * per-spine sums accumulate the section's rendered-so-far count). Requires
 * readest/foliate-js#133 (contentPages on getContents items); on older foliate
 * builds the sweep is a no-op and the entry-time sampling fallback covers only
 * the current chapter.
 */
export const harvestLoadedChapterScreens = (
  bookKey: string,
  contents: Array<{ index?: number; contentPages?: number }>,
) => {
  const sums = new Map<number, number>();
  for (const item of contents) {
    const spine = item.index;
    const pages = item.contentPages;
    if (spine === undefined || pages === undefined || pages <= 0) continue;
    sums.set(spine, (sums.get(spine) ?? 0) + pages);
  }
  for (const [spine, pages] of sums) recordChapterScreens(bookKey, spine, pages);
};

export interface CalibratedSectionSource {
  size?: number;
  linear?: string;
}

/** Whole screens per spine item and where each starts: the readout's page map. */
export interface ScreenPageMap {
  /** 0 for items paging skips (linear="no"), as foliate's section fractions do. */
  counts: number[];
  /** The 0-based book page each spine item starts on. */
  starts: number[];
  total: number;
}

/**
 * Chapters measured this session contribute their real spread counts;
 * unmeasured ones are estimated from their uncompressed byte size over the
 * measured bytes-per-screen ratio (SIZE_PER_LOC before the first
 * measurement). A chapter fills whole screens and ends on a partly filled
 * one, half full on average: the ratio leaves that half screen out of every
 * measured chapter and each estimate adds it back. Without it a cover or
 * title page (a few hundred bytes, one screen) rated the text chapters 1.5x
 * too long, and the total fell for many chapters before it settled (#7453).
 * Whole screens also let a measured last chapter end on total / total.
 */
export const getScreenPageMap = (
  bookKey: string,
  sections: CalibratedSectionSource[],
): ScreenPageMap => {
  // The readout computes from the entry-time snapshot, not the live map: the
  // map keeps tracking the current layout, but adopting its updates
  // mid-chapter would move the base and total under the reader.
  const measured = snapshots.get(bookKey) ?? maps.get(bookKey);
  let measuredBytes = 0;
  let measuredScreens = 0;
  measured?.forEach((screens, spine) => {
    const section = sections[spine];
    if (!section || section.linear === 'no') return;
    measuredBytes += section.size ?? 0;
    measuredScreens += screens - 0.5;
  });
  // Guard against a zero measured byte sum (streamed books report size 0):
  // a 0 ratio would turn every estimate into NaN downstream.
  const bytesPerScreen =
    measuredScreens > 0 && measuredBytes > 0 ? measuredBytes / measuredScreens : SIZE_PER_LOC;
  const counts: number[] = [];
  const starts: number[] = [];
  let total = 0;
  sections.forEach((section, spine) => {
    const size = section.size ?? 0;
    const count =
      section.linear === 'no'
        ? 0
        : (measured?.get(spine) ?? (size > 0 ? Math.floor(size / bytesPerScreen) + 1 : 0));
    counts.push(count);
    starts.push(total);
    total += count;
  });
  return { counts, starts, total };
};

/**
 * The book-level page pair calibrated into screen space (0-based current).
 * `currentPage` must be the primary section's own 0-based spread index; for a
 * chunked current section the renderer coordinates are chunk-local, so
 * `chapterFraction` (the byte-domain position within the section, 0..1)
 * drives the in-chapter offset instead - smooth, though no longer exactly one
 * page per turn.
 */
export const getCalibratedPagePair = (
  bookKey: string,
  sections: CalibratedSectionSource[],
  currentSpine: number,
  currentPage: number,
  isChunked: boolean,
  chapterFraction: number,
): { current: number; total: number } => {
  const { counts, starts, total } = getScreenPageMap(bookKey, sections);
  const count = counts[currentSpine] ?? 0;
  const start = starts[currentSpine] ?? total;
  // An item paging skips holds no page of its own: it reads the page after
  // it, or the last page when the slider at 100% lands in a trailing one.
  if (count === 0) return { current: Math.max(0, Math.min(start, total - 1)), total };
  const inChapter = isChunked
    ? Math.min(count - 1, Math.floor(Math.max(0, chapterFraction) * count))
    : Math.max(0, currentPage);
  const current = start + inChapter;
  // A chapter that grew after its entry snapshot (late images or fonts)
  // keeps one page per turn; the total follows rather than being read past.
  return { current, total: Math.max(total, current + 1) };
};

/**
 * The spine item screen page `page` (0-based) lies in, and the section
 * fraction the paginator lands on it with. The paginator turns a fraction f
 * into column round(f * (columns - 1)), so p / (count - 1) is screen p's
 * first column at one or two columns per screen. The last screen aims a
 * quarter screen short of the section end, which a book fraction would round
 * into the next item.
 */
export const locateScreenPage = (
  map: ScreenPageMap,
  page: number,
): { index: number; fraction: number } | null => {
  if (map.total <= 0) return null;
  const target = Math.min(Math.max(0, page), map.total - 1);
  for (let index = 0; index < map.counts.length; index++) {
    const count = map.counts[index]!;
    const inChapter = target - map.starts[index]!;
    if (count > 0 && inChapter < count) {
      return { index, fraction: count > 1 ? Math.min(inChapter, count - 1.25) / (count - 1) : 0 };
    }
  }
  return null;
};
