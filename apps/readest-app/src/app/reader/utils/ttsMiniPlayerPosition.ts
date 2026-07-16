import type { ViewSettings } from '@/types/book';
import { footerInfoVisible } from './footerBand';

// Card height of the TTS mini player (h-14). Reader text reserves this plus
// the bottom offset below as clearance while a session is active;
// FoliateViewer consumes it via applyMarginAndGap.
export const TTS_MINI_PLAYER_HEIGHT = 56;

// 64px mobile nav bar / 52px desktop footer bar, plus an 8px gap.
const ABOVE_MOBILE_BAR = 72;
const ABOVE_DESKTOP_BAR = 60;
const PANEL_GAP = 8;
const BASE_OFFSET = 16;

/**
 * Bottom offset (px) of the TTS mini player, excluding the safe-area inset
 * (applied separately as margin-bottom). The card stays visible for the whole
 * session and stacks above whatever occupies the bottom edge:
 *   - the bottom bar while it is shown (hoveredBookKey === bookKey), or the
 *     expanded action panel above it (panelTopOffset: measured distance from
 *     the bottom edge to the open panel's top, safe-area margin excluded)
 *   - the footer info band / floating pills once the bar is dismissed
 *   - otherwise a 16px resting offset above the bottom edge
 */
export const getTTSMiniPlayerBottomOffset = (
  viewSettings: ViewSettings,
  { barVisible = false, usesMobileBar = false, panelTopOffset = 0 } = {},
): number => {
  if (barVisible) {
    const aboveBar = usesMobileBar ? ABOVE_MOBILE_BAR : ABOVE_DESKTOP_BAR;
    return Math.max(aboveBar, panelTopOffset + PANEL_GAP);
  }
  const footerAtBottom =
    viewSettings.showFooter &&
    !viewSettings.vertical &&
    (footerInfoVisible(viewSettings) || viewSettings.showStickyProgressBar);
  return footerAtBottom ? Math.max(viewSettings.marginBottomPx, BASE_OFFSET) : BASE_OFFSET;
};
