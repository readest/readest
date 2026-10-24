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

export const recordChapterScreens = (bookKey: string, spine: number, pages: number) => {
  if (!(pages > 0)) return;
  let map = maps.get(bookKey);
  if (!map) maps.set(bookKey, (map = new Map()));
  map.set(spine, pages);
};

export const getMeasuredChapterScreens = (bookKey: string) => maps.get(bookKey);

export const clearChapterScreens = (bookKey: string) => {
  maps.delete(bookKey);
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
  const measured = maps.get(bookKey);
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
