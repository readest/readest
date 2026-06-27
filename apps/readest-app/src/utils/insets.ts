import { Insets } from '@/types/misc';
import { ViewSettings } from '@/types/book';

const SAFE_BOTTOM_FOOTER_INSET_RATIO = 0.33;
const DESKTOP_FOOTER_BAR_HEIGHT = 52;
const MOBILE_FOOTER_BAR_HEIGHT = 64;

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

/**
 * Extra padding around the foliate scrolled-mode host so fixed/absolute reader
 * chrome does not cover the first or last line. The renderer's own margins are
 * user-configurable content margins, but the visible footer chrome has a fixed
 * minimum height (52px desktop, 64px mobile). Reserve at least that much bottom
 * space; otherwise iPad users can scroll the last lines underneath the toolbar.
 */
export const getScrolledContentMargins = ({
  gridInsets,
  viewSettings,
  ttsEnabled,
  hasSafeAreaInset,
  useMobileFooterLayout,
}: {
  gridInsets: Insets;
  viewSettings: ViewSettings;
  ttsEnabled: boolean;
  hasSafeAreaInset: boolean;
  useMobileFooterLayout: boolean;
}): { top: number; bottom: number } => {
  const showTopHeader = viewSettings.showHeader && !viewSettings.vertical;
  const showBottomFooter = viewSettings.showFooter && !viewSettings.vertical;
  const safeBottomPadding = hasSafeAreaInset
    ? gridInsets.bottom * SAFE_BOTTOM_FOOTER_INSET_RATIO
    : 0;
  const ttsBarHeight =
    ttsEnabled && viewSettings.showTTSBar ? DESKTOP_FOOTER_BAR_HEIGHT + safeBottomPadding : 0;
  const footerChromeHeight = useMobileFooterLayout
    ? MOBILE_FOOTER_BAR_HEIGHT
    : DESKTOP_FOOTER_BAR_HEIGHT;
  const footerHeight =
    safeBottomPadding + Math.max(viewSettings.marginBottomPx, footerChromeHeight);

  return {
    top: showTopHeader ? gridInsets.top + viewSettings.marginTopPx : 0,
    bottom: showBottomFooter ? Math.max(footerHeight, ttsBarHeight) : ttsBarHeight,
  };
};
