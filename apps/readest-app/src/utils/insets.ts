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
