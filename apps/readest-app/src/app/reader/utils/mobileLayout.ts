/**
 * True for a mobile app on a tablet or foldable held portrait: wide enough to
 * clear the `sm:` (640px) breakpoint, so CSS sees a desktop-width viewport,
 * while the reader still needs its mobile header and footer bars.
 *
 * Phones (innerWidth < 640) are excluded on purpose — they are already below
 * the breakpoint, and their styling plus the panel slide-down animation must
 * stay exactly as before (#3742 / #3746).
 *
 * Every bar must answer this the same way. While only the footer computed it,
 * the header kept showing its own copies of the footer's TOC and font controls
 * on tablet portrait (#5634, #5652).
 *
 * iPhone Duo is the exception: viewport size cannot identify it, so with
 * `isIPhoneDuo` every pose at least 640 wide (the inner display in landscape,
 * 951x669, and the cover display in landscape) keeps the same mobile bars,
 * matching Apple's guidance to keep a device's controls consistent across
 * poses (#6307). Nothing else, Android tablets and foldables included, changes.
 *
 * Reads the viewport at call time and does not subscribe to resize, matching
 * every call site: orientation changes already re-render these components
 * through the inset updates in `useSafeAreaInsets`.
 */
export const isForcedMobileLayout = (isMobileApp?: boolean, isIPhoneDuo = false) =>
  !!isMobileApp &&
  window.innerWidth >= 640 &&
  (isIPhoneDuo || window.innerWidth <= window.innerHeight);
