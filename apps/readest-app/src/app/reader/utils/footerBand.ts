import type { ViewSettings } from '@/types/book';
import { getInsetEdges } from '@/utils/grid';

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

/**
 * Whether the book layout must reserve the full-width bottom band
 * (marginBottomPx of page margin / scroll padding) for the footer.
 *
 * The band used to be reserved whenever Show Footer was on, which read as a
 * "solid bar" across the bottom of the screen: scrolled text clipped hard at
 * its edge, and it lingered even when the footer had nothing to show. Now:
 *   - the sticky progress bar (always-visible, display-only) keeps its band
 *   - scrolled mode never reserves it — the info floats over the text in
 *     shrink-wrapped pills (see ProgressBar) instead of a full-width strip
 *   - paginated mode reserves it only while some info actually renders
 */
export const footerReservesBand = (viewSettings: ViewSettings): boolean => {
  if (!viewSettings.showFooter) return false;
  if (viewSettings.showStickyProgressBar) return true;
  if (viewSettings.scrolled) return false;
  return footerInfoVisible(viewSettings);
};
