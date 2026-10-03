import { Insets } from '@/types/misc';
import { ViewSettings } from '@/types/book';
import type { Point, Position, Rect } from '@/utils/sel';

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
  // Add only the lift: adding then subtracting minHeight can round a fractional
  // inset downward and make SectionInfo incorrectly enable its z-10 layer (#6242).
  const top = Math.max(0, topInset + Math.min(marginTopPx - minHeight, 0));
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
 * Physical horizontal padding that keeps an edge-to-edge bar, sheet or panel
 * clear of iPhone Duo's vertical status strip and camera cutout, which it
 * reports as a large left or right safe-area inset (it can flip with rotation
 * or Split View). Safe-area insets are physical, so this is
 * `paddingLeft`/`paddingRight`, never start/end.
 *
 * Empty off the Duo, so no other device changes. On the Duo it is also empty
 * without a side inset, leaving the element's own (responsive) padding classes
 * in charge.
 */
export const getHorizontalInsetStyle = (
  insets: Insets | null | undefined,
  isIPhoneDuo: boolean,
  basePx = 0,
): { paddingLeft?: string; paddingRight?: string } => {
  const left = insets?.left ?? 0;
  const right = insets?.right ?? 0;
  if (!isIPhoneDuo || (!left && !right)) return {};
  return { paddingLeft: `${left + basePx}px`, paddingRight: `${right + basePx}px` };
};

/**
 * Horizontal inset padding for a slide-in panel. The full-width mobile sheet
 * is padded on both sides; a side panel only meets the screen on `screenEdge`
 * (the sidebar is always physically left, the notebook right), and padding its
 * inner edge would leave a dead band against the page.
 */
export const getPanelHorizontalInsetStyle = (
  insets: Insets | null | undefined,
  isIPhoneDuo: boolean,
  isMobile: boolean,
  screenEdge: 'left' | 'right',
) => {
  if (isMobile || !insets) return getHorizontalInsetStyle(insets, isIPhoneDuo);
  return getHorizontalInsetStyle(
    {
      ...insets,
      left: screenEdge === 'left' ? insets.left : 0,
      right: screenEdge === 'right' ? insets.right : 0,
    },
    isIPhoneDuo,
  );
};

/**
 * The Column Gap (px) the paginator applies, or 0: it applies only to a
 * paginated horizontal spread.
 */
export const getSpreadColumnGap = (
  viewSettings: Pick<ViewSettings, 'columnGapPx' | 'scrolled' | 'vertical'>,
  columnCount: number,
) =>
  !viewSettings.scrolled && !viewSettings.vertical && columnCount > 1
    ? viewSettings.columnGapPx
    : 0;

/**
 * Inline padding that lines the page header and footer up with the text's
 * outer edge, `gapPercent / 2 % + insetPx / 2 px` from the paginator host. A
 * column gap past twice the derived gap pulls that edge in to half the gap
 * (foliate-js getColumnGapHostTracks), so the padding is floored there;
 * `hostOffsetPx` is the host's offset inside the book cell (the Duo inset).
 */
export const getMarginalInlinePadding = (
  gapPercent: number,
  insetPx: number,
  columnGapPx = 0,
  hostOffsetPx = 0,
) => {
  const padding = `calc(${gapPercent / 2}% + ${insetPx / 2}px)`;
  return columnGapPx > 0 ? `max(${padding}, ${columnGapPx / 2 + hostOffsetPx}px)` : padding;
};

/**
 * Insets for a book cell's page area on iPhone Duo. A two-column spread is
 * inset by the larger horizontal inset on both sides so it stays centred on
 * the display: on the inner display that puts the spine on the fold (Apple:
 * match the symmetry of the inner display, #6307). A single column keeps the
 * asymmetric inset and the width it frees.
 */
export const getPageAreaInsets = (insets: Insets, isSpread: boolean): Insets => {
  if (!isSpread || insets.left === insets.right) return insets;
  const side = Math.max(insets.left, insets.right);
  return { ...insets, left: side, right: side };
};

// iOS hides the status bar in a vertically compact window: an iPhone held
// landscape (at most 440pt tall) or iPhone Duo's cover display (466pt). The
// Duo's inner display is 669pt tall in landscape and keeps its side strip.
const COMPACT_HEIGHT_MAX_PX = 500;

/**
 * Whether iOS shows no status bar in this window regardless of what the app
 * asks for. Only iPhone Duo uses this: other iPhones treat any landscape as
 * status-bar-hidden (see useTheme).
 */
export const isStatusBarHiddenBySystem = (
  orientationType: string | undefined,
  windowHeight: number,
) => !!orientationType?.includes('landscape') && windowHeight < COMPACT_HEIGHT_MAX_PX;

/** Side safe-area insets recorded while the status bar was hidden, at one window size. */
export interface StatusBarHiddenInsets {
  width: number;
  height: number;
  left: number;
  right: number;
}

/**
 * Screen insets the reading page lays out against on iPhone Duo. The reader
 * hides the status bar while reading; on the Duo that also removes the side
 * strip's safe-area inset (84pt on the inner display), and opening the toolbar
 * brings it back. The page keeps the sides recorded with the status bar hidden,
 * for this window size, so opening the toolbar does not re-paginate: the strip
 * overlaps the page margin while the toolbar is up. Top and bottom stay live.
 * Without a record (`hidden` null) the live insets are used.
 */
export const getReadingScreenInsets = (
  live: Insets,
  hidden: StatusBarHiddenInsets | null,
  width: number,
  height: number,
): Insets => {
  if (!hidden || hidden.width !== width || hidden.height !== height) return live;
  if (hidden.left === live.left && hidden.right === live.right) return live;
  return { ...live, left: hidden.left, right: hidden.right };
};

export interface PopupBounds {
  rect: Rect;
  origin: Point;
}

/**
 * The rect a popup is clamped to, and the origin its points must be shifted by.
 *
 * `getPosition`/`getPopupPosition` return points relative to the rect's
 * top-left, but popups render relative to the book cell. Off the Duo the rect
 * is the raw cell (main's behaviour, no shift). On iPhone Duo it is the cell's
 * safe region, so a popup never sits under the status strip, and `origin` is
 * the safe region's offset inside the cell: shift the results by it with
 * {@link offsetPosition} to get back to cell coordinates.
 */
export const getPopupBounds = (
  cellRect: Rect,
  insets: Insets,
  isIPhoneDuo: boolean,
): PopupBounds => {
  if (!isIPhoneDuo) return { rect: cellRect, origin: { x: 0, y: 0 } };
  const left = cellRect.left + insets.left;
  const top = cellRect.top + insets.top;
  return {
    rect: {
      left,
      top,
      right: Math.max(left, cellRect.right - insets.right),
      bottom: Math.max(top, cellRect.bottom - insets.bottom),
    },
    origin: { x: insets.left, y: insets.top },
  };
};

export const offsetPosition = (position: Position, origin: Point): Position => ({
  ...position,
  point: { x: position.point.x + origin.x, y: position.point.y + origin.y },
});

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
