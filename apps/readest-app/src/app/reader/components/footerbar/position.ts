export type FooterBarPosition = 'fixed' | 'absolute';

/**
 * Where the footer bar anchors. The mobile footer layout pins to the viewport
 * (`fixed`) so its slide-up panels sit at the bottom of the screen. But a pinned
 * sidebar occupies horizontal space, and a viewport-fixed footer would slide
 * under it — so when the sidebar is pinned the footer anchors inside the book's
 * grid cell (`absolute`) instead, starting at the sidebar's right edge. The
 * desktop layout is always grid-cell anchored.
 */
export const getFooterBarPosition = (
  useMobileFooterLayout: boolean,
  isSideBarPinned: boolean,
): FooterBarPosition => (useMobileFooterLayout && !isSideBarPinned ? 'fixed' : 'absolute');

/**
 * How far the desktop footer and its hover strip sit above the bottom edge
 * while the view scrolls horizontally (a zoomed fixed-layout page, vertical
 * scrolled text), so they stay off the horizontal scrollbar. Windows draws it
 * 17px tall; a 12px lift left the footer over its top edge (#6784).
 */
export const HORIZONTAL_SCROLLBAR_LIFT = 'sm:bottom-[17px]!';
