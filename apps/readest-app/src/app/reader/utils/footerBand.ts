import type { ViewSettings } from '@/types/book';
import { getInsetEdges } from '@/utils/grid';
import { getChromeFontSize } from './headerFooterStyle';

/** Radii (px) of the rounded bottom screen corners a book cell meets. */
export interface BottomCornerRadii {
  left: number;
  right: number;
}

export const NO_CORNERS: BottomCornerRadii = { left: 0, right: 0 };

/**
 * Whether the footer currently displays any info widget, mirroring the
 * per-widget gating in ProgressBar.
 */
export const footerInfoVisible = (viewSettings: ViewSettings): boolean =>
  !!(
    viewSettings.showRemainingTime ||
    viewSettings.showRemainingPages ||
    viewSettings.showProgressInfo ||
    viewSettings.showCurrentTime ||
    viewSettings.showCurrentBatteryStatus
  );

/**
 * Inline padding (px) the footer needs so its text keeps clear of a rounded
 * screen corner of `radius` px, given the height (px above the screen bottom)
 * of the text's lowest point. At height h the corner arc reaches
 * R - sqrt(R^2 - (R - h)^2) px inward; a small gap is added on top. Zero when
 * there is no corner or the text sits above the arc.
 */
export const getCornerClearance = (radius: number, textBottom: number): number => {
  if (radius <= 0 || textBottom >= radius) return 0;
  const gap = 4;
  const rise = radius - Math.max(0, textBottom);
  return radius - Math.sqrt(radius * radius - rise * rise) + gap;
};

/**
 * The rounded bottom corners a book cell shares with the screen. Only cells on
 * the bottom row meet them, and only on their outer side: next to another book
 * the edge sits mid-screen.
 */
export const getCellCornerRadii = (
  index: number,
  count: number,
  aspectRatio: number,
  radius: number,
): BottomCornerRadii => {
  const { right, bottom, left } = getInsetEdges(index, count, aspectRatio);
  return {
    left: bottom && left ? radius : 0,
    right: bottom && right ? radius : 0,
  };
};

/** Show Footer reserves the bottom band in either flow. Vertical writing uses a side column. */
export const footerReservesBand = (viewSettings: ViewSettings): boolean =>
  viewSettings.showFooter && !viewSettings.vertical;

/** Keep one line of footer text inside the strip even with a small stored margin. */
export const getFooterStripHeight = (viewSettings: ViewSettings): number =>
  Math.max(
    viewSettings.marginBottomPx,
    16,
    Math.ceil(getChromeFontSize(viewSettings, viewSettings.isEink) * 1.5),
  );
