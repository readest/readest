import type { ViewSettings } from '@/types/book';

/**
 * Whether the footer currently displays any info widget, mirroring the
 * per-widget gating in ProgressBar: a widget renders only when it is both
 * enabled in settings and included in the tap-cycled progressInfoMode.
 */
export const footerInfoVisible = (viewSettings: ViewSettings): boolean => {
  const mode = viewSettings.progressInfoMode || 'all';
  const remaining =
    (mode === 'all' || mode.includes('remaining')) &&
    (viewSettings.showRemainingTime || viewSettings.showRemainingPages);
  const progress = (mode === 'all' || mode.includes('progress')) && viewSettings.showProgressInfo;
  const status =
    (mode === 'all' || mode.includes('time') || mode.includes('battery')) &&
    (viewSettings.showCurrentTime || viewSettings.showCurrentBatteryStatus);
  return !!(remaining || progress || status);
};

/**
 * Whether the book layout must reserve the full-width bottom band
 * (marginBottomPx of page margin / scroll padding) for the footer.
 *
 * The band used to be reserved whenever Show Footer was on, which read as a
 * "solid bar" across the bottom of the screen: scrolled text clipped hard at
 * its edge, and tap-toggling the info off left the empty band behind. Now:
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
