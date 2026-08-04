/**
 * Pure helpers + doc-registration bridge for the pull-down-to-bookmark gesture
 * (#1359), modeled on the WeRead interaction:
 *
 * Dragging the page down in paginated mode slides it away from the top edge,
 * revealing a band with a hint and a ribbon that always previews the bookmark
 * state a release would produce. Pulling past `BOOKMARK_PULL_TRIGGER_PX` and
 * releasing toggles the bookmark at the current location.
 *
 * The gesture listeners attach per iframe document (capture phase, from
 * `FoliateViewer.docLoadHandler` — same lifecycle as the brightness/speed
 * gestures) but the state and UI live in `BookmarkPullDown`, mounted per book
 * cell. This module bridges the two: docs delegate to whatever handlers the
 * component has currently installed for that bookKey.
 */

export const BOOKMARK_PULL_ACTIVATION_PX = 18;
export const BOOKMARK_PULL_TRIGGER_PX = 100;
export const BOOKMARK_PULL_LINEAR_PX = 120;
export const BOOKMARK_PULL_DAMPING = 0.35;

/**
 * True when movement is downward-dominant past the activation threshold.
 * Direction matters (unlike the brightness gesture): only a pull DOWN may
 * claim the sequence, so upward wobble stays with the paginator.
 */
export const shouldActivatePull = (
  deltaX: number,
  deltaY: number,
  threshold = BOOKMARK_PULL_ACTIVATION_PX,
): boolean => deltaY >= threshold && deltaY > Math.abs(deltaX);

/**
 * Page offset for a finger travel of `deltaY` px: 1:1 through the linear
 * range (which covers the trigger distance, so the pull feels direct up to
 * the decision point), rubber-banded beyond it.
 */
export const computePullOffset = (deltaY: number): number => {
  if (deltaY <= 0) return 0;
  if (deltaY <= BOOKMARK_PULL_LINEAR_PX) return deltaY;
  return BOOKMARK_PULL_LINEAR_PX + (deltaY - BOOKMARK_PULL_LINEAR_PX) * BOOKMARK_PULL_DAMPING;
};

export const isPastPullThreshold = (offset: number): boolean => offset >= BOOKMARK_PULL_TRIGGER_PX;

/**
 * Whether the band ribbon renders filled (vs outline). It always previews the
 * state a release right now would leave: below the threshold that is the
 * current state, past it the toggled one.
 */
export const previewRibbonFilled = (bookmarked: boolean, pastThreshold: boolean): boolean =>
  bookmarked !== pastThreshold;

/**
 * Preview ribbon height: it hangs from the viewport top at its resting size
 * until the descending page edge passes its tail, then the tail rides the
 * page edge.
 */
export const pullRibbonHeight = (offset: number, restHeight: number): number =>
  Math.max(restHeight, offset);

/**
 * translateY for the hint row, which is bottom-anchored inside the band (so it
 * rides just above the page edge) until its top reaches `pinTop`, where it
 * stays pinned while the pull continues.
 */
export const pullHintShift = (offset: number, hintHeight: number, pinTop: number): number =>
  0 - Math.max(0, offset - hintHeight - pinTop);

/**
 * The gesture exists only where a vertical drag has no other meaning and the
 * continuous slide can look right: paginated (not scrolled) reflowable books
 * in horizontal writing mode, and never on e-ink (ghosting).
 */
export const canPullBookmark = (mode: {
  scrolled: boolean;
  vertical: boolean;
  isEink: boolean;
  isFixedLayout: boolean;
}): boolean => !mode.scrolled && !mode.vertical && !mode.isEink && !mode.isFixedLayout;

export interface BookmarkPullHandlers {
  onTouchStart: (doc: Document, event: TouchEvent) => void;
  onTouchMove: (doc: Document, event: TouchEvent) => void;
  onTouchEnd: (doc: Document, event: TouchEvent) => void;
  onTouchCancel: (doc: Document, event: TouchEvent) => void;
}

const pullHandlers = new Map<string, BookmarkPullHandlers>();

/** Install (or with `null` remove) the live handlers for a book. */
export const setBookmarkPullHandlers = (
  bookKey: string,
  handlers: BookmarkPullHandlers | null,
): void => {
  if (handlers) pullHandlers.set(bookKey, handlers);
  else pullHandlers.delete(bookKey);
};

/**
 * Attach the capture-phase, non-passive touch listeners to a section document.
 * Capture phase is required so an active pull's `stopImmediatePropagation` can
 * suppress foliate-js's own bubble-phase paginator listeners (see
 * `useBrightnessGesture`). Called once per doc from `docLoadHandler`, inside
 * its `isEventListenersAdded` guard; registration order puts these after the
 * brightness/speed listeners, so those gestures win their claims first.
 */
export const registerBookmarkPullDoc = (bookKey: string, doc: Document): void => {
  const opts = { capture: true, passive: false } as const;
  doc.addEventListener('touchstart', (e) => pullHandlers.get(bookKey)?.onTouchStart(doc, e), opts);
  doc.addEventListener('touchmove', (e) => pullHandlers.get(bookKey)?.onTouchMove(doc, e), opts);
  doc.addEventListener('touchend', (e) => pullHandlers.get(bookKey)?.onTouchEnd(doc, e), opts);
  doc.addEventListener(
    'touchcancel',
    (e) => pullHandlers.get(bookKey)?.onTouchCancel(doc, e),
    opts,
  );
};
