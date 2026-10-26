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

/** Freeze the live measurements into the readout snapshot at chapter entry. */
export const snapshotChapterScreens = (bookKey: string) => {
  const live = maps.get(bookKey);
  if (live) snapshots.set(bookKey, new Map(live));
  else snapshots.delete(bookKey);
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
}

/**
 * The book-level page pair calibrated into screen space. Chapters measured
 * this session contribute their real spread counts; unmeasured ones are
 * estimated from their uncompressed byte size over the measured
 * bytes-per-screen ratio (SIZE_PER_LOC before the first measurement, i.e.
 * today's estimate, so the pair opens exactly where the byte-grid readout
 * stood). `currentPage` must be the primary section's own 0-based spread
 * index; for a chunked current section the renderer coordinates are
 * chunk-local, so `chapterFraction` (the byte-domain position within the
 * section, 0..1) drives the in-chapter offset instead - smooth, though no
 * longer exactly one page per turn.
 */
export const getCalibratedPagePair = (
  bookKey: string,
  sections: CalibratedSectionSource[],
  currentSpine: number,
  currentPage: number,
  isChunked: boolean,
  chapterFraction: number,
): { current: number; total: number } => {
  // The readout computes from the entry-time snapshot, not the live map: the
  // map keeps tracking the current layout, but adopting its updates
  // mid-chapter would move the base and total under the reader.
  const measured = snapshots.get(bookKey) ?? maps.get(bookKey);
  let measuredBytes = 0;
  let measuredScreens = 0;
  measured?.forEach((screens, spine) => {
    measuredBytes += sections[spine]?.size ?? 0;
    measuredScreens += screens;
  });
  // Guard against a zero measured byte sum (streamed books report size 0):
  // a 0 ratio would turn every estimate into NaN downstream.
  const bytesPerScreen =
    measuredScreens > 0 && measuredBytes > 0 ? measuredBytes / measuredScreens : SIZE_PER_LOC;
  let base = 0;
  let total = 0;
  let currentChapterPages = 0;
  sections.forEach((section, spine) => {
    const n =
      spine === currentSpine && isChunked
        ? (section.size ?? 0) / bytesPerScreen
        : (measured?.get(spine) ?? (section.size ?? 0) / bytesPerScreen);
    if (spine < currentSpine) base += n;
    if (spine === currentSpine) currentChapterPages = n;
    total += n;
  });
  const inChapter = isChunked
    ? Math.min(currentChapterPages, Math.max(0, chapterFraction * currentChapterPages))
    : currentPage;
  return { current: base + inChapter, total };
};
