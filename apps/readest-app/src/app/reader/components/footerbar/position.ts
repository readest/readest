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
