import type { ViewSettings } from '@/types/book';
import type { DuoFoldState } from '@/utils/bridge';
import { expectsColumnSpread, getMaxInlineSize } from '@/utils/config';

/**
 * iPhone Duo poses that change how a book is laid out.
 *
 * - `cover`: the cover display (466x678), a regular phone.
 * - `inner-portrait`: the inner display held tall (669x951). The hinge runs
 *   across the middle, so the page stays a single column.
 * - `inner-landscape`: the inner display held wide (951x669). The hinge runs
 *   down the middle and each half is about the size of the cover display,
 *   so this is the book pose: two pages, one either side of the hinge.
 *
 * `off` means not an iPhone Duo; nothing may change there (#6307).
 */
export type DuoPose = 'off' | 'cover' | 'inner-portrait' | 'inner-landscape';

// The cover display is 678pt on its long side and the inner display 951pt on
// its long side and 669pt on its short one. Split View on the inner display
// leaves the app well under these, so it lays out like the cover display.
const INNER_DISPLAY_MIN_LONG_SIDE = 800;
const INNER_DISPLAY_MIN_SHORT_SIDE = 600;

export const getDuoPose = (isIPhoneDuo: boolean, width: number, height: number): DuoPose => {
  if (!isIPhoneDuo) return 'off';
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long < INNER_DISPLAY_MIN_LONG_SIDE || short < INNER_DISPLAY_MIN_SHORT_SIDE) return 'cover';
  return width > height ? 'inner-landscape' : 'inner-portrait';
};

/**
 * Width (px) the spine gutter keeps clear of the hinge: the folding region,
 * vertical in the book pose. It is reported flat too (inactive), so the page
 * is laid out the same flat and part way folded. 0 when none is reported.
 */
export const getDuoSpineGutter = (fold: DuoFoldState | null | undefined): number => {
  const region = fold?.region;
  if (!region || region.height <= region.width) return 0;
  return Math.ceil(region.width);
};

export interface DuoColumnLayout {
  maxColumnCount: number;
  maxInlineSize: number;
}

/**
 * Column count and max inline size for a reflowable book in the book pose.
 *
 * The paginator lays out min(maxColumnCount, ceil(width / maxInlineSize))
 * columns. Book mode needs exactly two, so the max inline size is held
 * between half the page width (so each column fills its half) and three
 * quarters of it (so two columns are always needed). Without book mode the
 * page is one column at the reader's own max inline size.
 */
export const getDuoColumnLayout = (
  bookMode: boolean,
  pageWidth: number,
  maxInlineSize: number,
): DuoColumnLayout => {
  if (!bookMode) return { maxColumnCount: 1, maxInlineSize };
  const half = Math.ceil(pageWidth / 2);
  return {
    maxColumnCount: 2,
    maxInlineSize: Math.max(half, Math.min(maxInlineSize, Math.floor(pageWidth * 0.75))),
  };
};

/** The renderer attributes that follow the Duo pose. */
export interface RendererLayout {
  maxColumnCount: number;
  maxInlineSize: number;
  spreadMode: ViewSettings['spreadMode'];
  columnGapPx: number;
}

/**
 * The column count, max inline size, fixed-layout spread and centre gap to
 * hand the renderer. Off the book pose every value is the reader's own
 * setting, so no other device or pose changes.
 */
export const getRendererLayout = (
  viewSettings: ViewSettings,
  pose: DuoPose,
  pageWidth: number,
  fold: DuoFoldState | null | undefined,
): RendererLayout => {
  const own: RendererLayout = {
    maxColumnCount: viewSettings.maxColumnCount,
    maxInlineSize: getMaxInlineSize(viewSettings),
    spreadMode: viewSettings.spreadMode,
    columnGapPx: viewSettings.columnGapPx,
  };
  // Scrolled flow is a single column and never a two-page spread.
  if (pose !== 'inner-landscape' || viewSettings.vertical || viewSettings.scrolled) return own;
  const bookMode = viewSettings.duoBookMode ?? true;
  const columns = getDuoColumnLayout(bookMode, pageWidth, own.maxInlineSize);
  const gutter = bookMode ? getDuoSpineGutter(fold) : 0;
  return {
    ...columns,
    spreadMode: bookMode ? 'auto' : 'none',
    // Keep a margin's worth of space either side of the crease.
    columnGapPx: gutter > 0 ? Math.max(own.columnGapPx, gutter + 32) : own.columnGapPx,
  };
};

/** Whether the page shows two pages that meet at the spine. */
export const isRendererSpread = (
  viewSettings: ViewSettings,
  layout: RendererLayout,
  pose: DuoPose,
  isFixedLayout: boolean,
  pageWidth: number,
) => {
  if (viewSettings.scrolled) return false;
  // A fixed-layout spread is two pages only on the wide inner display; its
  // `auto` spread shows one page when the viewport is tall.
  if (isFixedLayout) return pose === 'inner-landscape' && layout.spreadMode === 'auto';
  return expectsColumnSpread(viewSettings, pageWidth, layout);
};

interface LayoutTarget {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

/**
 * Hand a resolved layout to the renderer, touching only attributes whose
 * value changed: each write re-lays out every loaded section.
 */
export const applyRendererLayout = (
  renderer: LayoutTarget,
  layout: RendererLayout,
  rendition: { layout?: string; spread?: string } | undefined,
) => {
  const set = (name: string, value: string) => {
    if (renderer.getAttribute(name) !== value) renderer.setAttribute(name, value);
  };
  if (rendition?.layout === 'pre-paginated') {
    rendition.spread = layout.spreadMode;
    set('spread', layout.spreadMode);
  } else {
    set('max-column-count', `${layout.maxColumnCount}`);
    set('max-inline-size', `${layout.maxInlineSize}px`);
  }
};
