import type { Insets } from '@/types/misc';

// The drawing dock (h-13); see HandwritingBars.
const DOCK_HEIGHT = 52;
const GAP = 8;

/**
 * Band of book text (px from the cell's bottom) kept clear for the drawing
 * dock while drawing mode is on, so no line sits under it. FoliateViewer
 * consumes it via applyMarginAndGap, like the TTS mini player.
 */
export const getDrawingDockClearance = (gridInsets: Insets) => ({
  bottom: gridInsets.bottom + DOCK_HEIGHT + GAP,
});
