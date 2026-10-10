import type { Insets } from '@/types/misc';

// The drawing top bar (h-11) and dock (h-13); see HandwritingBars.
const TOP_BAR_HEIGHT = 44;
const DOCK_HEIGHT = 52;
const GAP = 8;

/**
 * Bands of book text (px from the cell's top and bottom) kept clear for the
 * drawing bars while drawing mode is on, so no line sits under them.
 * FoliateViewer consumes it via applyMarginAndGap, like the TTS mini player.
 */
export const getDrawingBarsClearance = (gridInsets: Insets) => ({
  top: gridInsets.top + TOP_BAR_HEIGHT + GAP,
  bottom: gridInsets.bottom + DOCK_HEIGHT + GAP,
});
