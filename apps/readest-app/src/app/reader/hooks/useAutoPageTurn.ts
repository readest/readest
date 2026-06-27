import { useEffect, useRef } from 'react';
import { Insets } from '@/types/misc';
import { useReaderStore } from '@/store/readerStore';
import { focusCaretWindowPos } from '@/utils/sel';

const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

// A signal must rest in a screen corner for this long before the page
// auto-turns, so merely passing a corner mid-drag doesn't flip the page.
export const AUTO_TURN_DWELL_MS = 500;
// The corner zone is a quarter-ellipse within this radius of the actual corner
// (as a fraction of each axis). Kept tight so it is only the corner itself — a
// larger/rectangular zone catches normal selections that end in the lower-right
// of the page and turns the page unexpectedly.
export const AUTO_TURN_CORNER_FRACTION = 0.15;
// Hard ceiling on the corner radius in pixels. The fraction alone grows the zone
// with the reading area, so on a wide screen (desktop, multi-column pages) it
// reaches deep into the text and turns the page when a selection merely ends near
// the edge. Cap each axis so the zone stays a corner regardless of page size.
export const AUTO_TURN_CORNER_MAX_PX = 50;

export type Corner = 'br' | 'tl';
export type Point = { x: number; y: number };

// The subset of useTextSelector's return that drives the shared corner auto-turn,
// passed to the range editors so their overlay handle drags turn the page too.
export interface AutoTurnControls {
  noteAutoTurnPoint: (point: Point | null) => void;
  cancelAutoTurn: () => void;
  onAutoTurn: (cb: (corner: Corner) => void) => () => void;
}

// Which screen corner a point sits in: bottom-right turns forward, top-left
// turns back. The zone is a quarter-ellipse of radius FRACTION around each
// corner. Returns null when the point is in neither.
const cornerOf = (x: number, y: number, w: number, h: number): Corner | null => {
  if (w <= 0 || h <= 0) return null;
  const rx = Math.min(w * AUTO_TURN_CORNER_FRACTION, AUTO_TURN_CORNER_MAX_PX);
  const ry = Math.min(h * AUTO_TURN_CORNER_FRACTION, AUTO_TURN_CORNER_MAX_PX);
  const inEllipse = (dx: number, dy: number) => (dx / rx) ** 2 + (dy / ry) ** 2 <= 1;
  if (inEllipse(w - x, h - y)) return 'br';
  if (inEllipse(x, y)) return 'tl';
  return null;
};

// Map a window-coordinate point to the corner of the reading area it sits in,
// if any. Corners are measured against `area` (the visible text bounds in window
// coordinates) so they land on the text, not the page margins or a sidebar.
const cornerAt = (xWin: number, yWin: number, area: DOMRect | null): Corner | null => {
  if (!area || area.width <= 0 || area.height <= 0) return null;
  const x = xWin - area.left;
  const y = yWin - area.top;
  // Ignore a point outside the visible text (e.g. the selection caret jumping
  // into the next, off-screen column while dragging at the edge).
  if (x < 0 || x > area.width || y < 0 || y > area.height) return null;
  return cornerOf(x, y, area.width, area.height);
};

// The reading frame in window coordinates: the <foliate-view> element's rect
// (a stable element, so it has a sensible page-sized width — unlike the visible
// text range, whose box spans the whole multi-column iframe), inset by the page
// content margins so the corner zone lands on the text area, not the margin.
// Falls back to the reading container (gridcell).
export const getReadingAreaRect = (
  bookKey: string,
  insets: Insets = ZERO_INSETS,
): DOMRect | null => {
  const cell = document.querySelector(`#gridcell-${bookKey}`);
  if (!cell) return null;
  const frame = cell.querySelector('foliate-view') ?? cell;
  const r = frame.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return new DOMRect(
    r.left + insets.left,
    r.top + insets.top,
    Math.max(0, r.width - insets.left - insets.right),
    Math.max(0, r.height - insets.top - insets.bottom),
  );
};

// Which way to turn so a focus point that has left the visible reading page
// stays in view: past the trailing (right/bottom) edge turns to the next page,
// past the leading (left/top) edge turns back. Mirrors the corner machine's
// br->next / tl->prev convention. Returns null while the point is on the page.
// Used by the keyboard selection-adjust path: a Shift+Arrow extension that pushes
// the caret into the next, off-screen column turns the page immediately (no
// dwell), unlike the corner-dwell used for drags.
export const turnForFocusBeyondPage = (
  point: Point,
  area: DOMRect | null,
): 'next' | 'prev' | null => {
  if (!area || area.width <= 0 || area.height <= 0) return null;
  const x = point.x - area.left;
  const y = point.y - area.top;
  if (x > area.width || y > area.height) return 'next';
  if (x < 0 || y < 0) return 'prev';
  return null;
};

// The page to turn to so a keyboard-extended selection's focus stays visible, or
// null. Reads the focus caret of the first content with a live selection and maps
// it through turnForFocusBeyondPage against the reading area.
export const keyboardTurnDirection = (
  contents: { doc: Document }[],
  area: DOMRect | null,
): 'next' | 'prev' | null => {
  for (const { doc } of contents) {
    const sel = doc.defaultView?.getSelection?.();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) continue;
    const pos = focusCaretWindowPos(doc, sel);
    return pos ? turnForFocusBeyondPage(pos, area) : null;
  }
  return null;
};

// The corner-dwell auto page-turn (#1354), decoupled from the DOM selection so
// any drag/keyboard gesture can drive it: native selection, instant highlight,
// the range editors. A fed signal that rests in the bottom-right / top-left
// corner for AUTO_TURN_DWELL_MS turns one page (logical next/prev so RTL turns
// the correct way). One turn per engagement — a signal must leave the corner and
// return to turn another page.
export const useAutoPageTurn = (bookKey: string, contentInsets: Insets = ZERO_INSETS) => {
  const { getView } = useReaderStore();

  const autoTurnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The corner an input signal is currently engaged in. Stays set after a turn
  // so the dwell can't re-arm while held — a signal must leave the corner and
  // return to turn another page.
  const engagedCorner = useRef<Corner | null>(null);
  const isAutoTurning = useRef(false);
  // Liveness predicate for the engaged corner, re-checked when the dwell fires.
  // Callers inject it so the caret-or-pointer dual signal of native selection is
  // preserved while a point-only caller (editor/instant) reports its own point.
  const isInCornerRef = useRef<(corner: Corner) => boolean>(() => false);
  // Latest point fed through the point-based convenience entry.
  const lastPointRef = useRef<Point | null>(null);
  const afterTurnSubs = useRef<Set<(corner: Corner) => void>>(new Set());

  const readingAreaRect = (): DOMRect | null => getReadingAreaRect(bookKey, contentInsets);

  const cornerAtPoint = (point: Point | null): Corner | null =>
    point ? cornerAt(point.x, point.y, readingAreaRect()) : null;

  const clearTimer = () => {
    if (autoTurnTimer.current) {
      clearTimeout(autoTurnTimer.current);
      autoTurnTimer.current = null;
    }
  };

  const armDwell = (corner: Corner) => {
    if (autoTurnTimer.current) return;
    autoTurnTimer.current = setTimeout(() => {
      autoTurnTimer.current = null;
      // Skip if a turn is already running or the signal left the corner.
      if (isAutoTurning.current || !isInCornerRef.current(corner)) return;
      isAutoTurning.current = true;
      const view = getView(bookKey);
      // Logical next()/prev() so RTL books turn the correct way.
      const turning = corner === 'br' ? view?.next() : view?.prev();
      Promise.resolve(turning).finally(() => {
        afterTurnSubs.current.forEach((cb) => cb(corner));
        isAutoTurning.current = false;
      });
    }, AUTO_TURN_DWELL_MS);
  };

  // Feed a corner detected from an input signal into the dwell state machine,
  // with a liveness predicate re-checked when the dwell fires. Entering a corner
  // arms the dwell; once the signal is no longer in the engaged corner it
  // disengages so a re-entry can turn again.
  const noteCorner = (corner: Corner | null, isInCorner: (corner: Corner) => boolean) => {
    isInCornerRef.current = isInCorner;
    if (isAutoTurning.current) return;
    if (corner) {
      if (engagedCorner.current !== corner) {
        engagedCorner.current = corner;
        armDwell(corner);
      }
    } else if (engagedCorner.current && !isInCorner(engagedCorner.current)) {
      engagedCorner.current = null;
      clearTimer();
    }
  };

  // Point-based convenience for callers whose only signal is a window point
  // (instant highlight, range-editor handles, keyboard focus): the liveness
  // check is "is the latest fed point still in the engaged corner".
  const noteAutoTurnPoint = (point: Point | null) => {
    lastPointRef.current = point;
    noteCorner(cornerAtPoint(point), (corner) => cornerAtPoint(lastPointRef.current) === corner);
  };

  // Disengage and drop any pending corner page-turn.
  const cancel = () => {
    engagedCorner.current = null;
    lastPointRef.current = null;
    clearTimer();
  };

  // Subscribe to "a turn settled" (fired with the turned corner). Returns an
  // unsubscribe. The active gesture uses it to rebuild its range from the last
  // point so the selection extends onto the new page immediately.
  const onAfterTurn = (cb: (corner: Corner) => void): (() => void) => {
    afterTurnSubs.current.add(cb);
    return () => {
      afterTurnSubs.current.delete(cb);
    };
  };

  useEffect(() => {
    return () => clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isAutoTurning,
    readingAreaRect,
    cornerAtPoint,
    noteCorner,
    noteAutoTurnPoint,
    cancel,
    onAfterTurn,
  };
};
