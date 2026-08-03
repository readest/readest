import { Insets } from '@/types/misc';
import { ViewSettings } from '@/types/book';

export const getViewInsets = (viewSettings: ViewSettings) => {
  const showHeader = viewSettings.showHeader!;
  const showFooter = viewSettings.showFooter!;
  const isVertical = viewSettings.vertical || viewSettings.writingMode.includes('vertical');
  const fullMarginTopPx = viewSettings.marginPx || viewSettings.marginTopPx;
  const compactMarginTopPx = viewSettings.compactMarginPx || viewSettings.compactMarginTopPx;
  const fullMarginBottomPx = viewSettings.marginBottomPx;
  const compactMarginBottomPx = viewSettings.compactMarginBottomPx;
  const fullMarginLeftPx = viewSettings.marginLeftPx;
  const fullMarginRightPx = viewSettings.marginRightPx;
  const compactMarginLeftPx = viewSettings.compactMarginLeftPx;
  const compactMarginRightPx = viewSettings.compactMarginRightPx;

  return {
    top: showHeader && !isVertical ? fullMarginTopPx : compactMarginTopPx,
    right: showHeader && isVertical ? fullMarginRightPx : compactMarginRightPx,
    bottom: showFooter && !isVertical ? fullMarginBottomPx : compactMarginBottomPx,
    left: showFooter && isVertical ? fullMarginLeftPx : compactMarginLeftPx,
  } as Insets;
};

/**
 * Geometry of the header title band (SectionInfo, non-vertical).
 *
 * The band bottom is glued to the content top — max(topInset + marginTopPx, 16),
 * the same 16px floor the renderer keeps via moreTopInset in FoliateViewer — so
 * the title never overlaps the book text. At margins of 16px and up the band is
 * the classic [topInset, topInset + margin] strip below the safe area; below
 * that it keeps a 16px readable height and lifts into the notch, reaching the
 * screen top at the negative-margin limit (#5303).
 */
export const getHeaderBandGeometry = (topInset: number, marginTopPx: number) => {
  const minHeight = 16;
  const height = Math.max(marginTopPx, minHeight);
  const top = Math.max(0, topInset + Math.min(marginTopPx, minHeight) - minHeight);
  return { top, height, bottom: top + height };
};

/**
 * Height (px) of the header bar's hover trigger — the invisible strip along the
 * top of the book cell that reveals the toolbar.
 *
 * The strip is a lid: whatever it covers cannot be selected, long pressed or
 * clicked. Sized to the toolbar it reveals (44px) it matched the default top
 * margin and nothing else, so any smaller margin — the page header off, a
 * reduced margin, vertical writing mode — left it hanging over the first line
 * of text and swallowing presses on it (#4977, #5429). So it stops at the
 * content top instead: the renderer's `margin-top`, see
 * FoliateViewer.applyMarginAndGap, which floors at 16px via moreTopInset while
 * the page header is on and drops the safe-area inset when it is off.
 */
export const getHeaderTriggerHeight = (topInset: number, viewSettings: ViewSettings) => {
  const maxHeight = 44;
  const isVertical = viewSettings.vertical || viewSettings.writingMode.includes('vertical');
  const marginTopPx = getViewInsets(viewSettings).top;
  const contentTop =
    viewSettings.showHeader && !isVertical ? Math.max(topInset + marginTopPx, 16) : marginTopPx;
  return Math.min(maxHeight, Math.max(0, contentTop));
};

/**
 * Top padding (px) for a slide-in panel (sidebar / notebook) so its toolbar
 * clears the device status bar, mirroring the reader header.
 *
 * A partial-height mobile bottom sheet doesn't reach the top of the screen, so
 * it needs no padding. Every other case (full-height mobile sheet, or a
 * tablet/desktop panel anchored to the top) clears the safe-area inset, growing
 * to the status bar height when the system UI is visible.
 */
export const getPanelTopInset = ({
  isMobile,
  isFullHeightInMobile,
  systemUIVisible,
  statusBarHeight,
  safeAreaInsets,
}: {
  isMobile: boolean;
  isFullHeightInMobile: boolean;
  systemUIVisible: boolean;
  statusBarHeight: number;
  safeAreaInsets: Insets | null;
}): number => {
  if (isMobile && !isFullHeightInMobile) return 0;
  const top = safeAreaInsets?.top || 0;
  return systemUIVisible ? Math.max(top, statusBarHeight) : top;
};
