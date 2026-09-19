// iPhone Duo's inner display is 951x669 in landscape — wider than tall, so
// the plain portrait check below would miss it — but 669pt is phone-class on
// its short side; the smallest iPad (mini, portrait) is 744pt. Used to give
// it the mobile bars in every pose, matching Apple's guidance to keep a
// device's controls consistent across poses (#6307).
const PHONE_SHORT_SIDE_MAX_PX = 700;

/**
 * True for a mobile app on a tablet or foldable held portrait, or a
 * phone-class device in landscape: wide enough to clear the `sm:` (640px)
 * breakpoint, so CSS sees a desktop-width viewport, while the reader still
 * needs its mobile header and footer bars.
 *
 * Phones (innerWidth < 640) are excluded on purpose — they are already below
 * the breakpoint, and their styling plus the panel slide-down animation must
 * stay exactly as before (#3742 / #3746).
 *
 * Every bar must answer this the same way. While only the footer computed it,
 * the header kept showing its own copies of the footer's TOC and font controls
 * on tablet portrait (#5634, #5652).
 *
 * Reads the viewport at call time and does not subscribe to resize, matching
 * every call site: orientation changes already re-render these components
 * through the inset updates in `useSafeAreaInsets`.
 */
export const isForcedMobileLayout = (isMobileApp?: boolean) =>
  !!isMobileApp &&
  window.innerWidth >= 640 &&
  (window.innerWidth <= window.innerHeight ||
    Math.min(window.innerWidth, window.innerHeight) < PHONE_SHORT_SIDE_MAX_PX);
