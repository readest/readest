import { BookFormat, FIXED_LAYOUT_FORMATS, ViewSettings } from '@/types/book';

export const FIXED_LAYOUT_READING_RULER_LINE_HEIGHT = 28;

export interface ReadingRulerLineBox {
  start: number;
  end: number;
}

/** A column of text with its horizontal extent and the line boxes inside it. */
export interface ReadingRulerColumn {
  left: number;
  right: number;
  lines: ReadingRulerLineBox[];
}

type RulerRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

type RulerContainerRect = { top: number; left: number; right: number };

type ReadingRulerSettings = Pick<ViewSettings, 'defaultFontSize' | 'lineHeight'>;

/**
 * `Range.getClientRects()` aggregates the border boxes of every fully-enclosed
 * element, so multi-line `<p>`/container blocks show up as rects much taller
 * (along the ruler axis) than a text line. Drop those so they don't get merged
 * into a giant "line" that the snap would skip over. Line rects vastly
 * outnumber block rects, so the median thickness is the real line height.
 */
const dropBlockRects = (rects: RulerRect[], isVertical: boolean): RulerRect[] => {
  const valid = rects.filter((r) => r && r.width > 0 && r.height > 0);
  if (valid.length < 3) return valid;
  const thickness = (r: RulerRect) => (isVertical ? r.width : r.height);
  const sorted = valid.map(thickness).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median <= 0) return valid;
  const limit = median * 1.8;
  return valid.filter((r) => thickness(r) <= limit);
};

/**
 * Merge sorted-on-input spans into visual lines: spans that overlap by more
 * than half of the smaller span are treated as one line.
 */
const mergeLineSpans = (spans: ReadingRulerLineBox[]): ReadingRulerLineBox[] => {
  spans.sort((a, b) => a.start - b.start || a.end - b.end);

  const lines: ReadingRulerLineBox[] = [];
  for (const span of spans) {
    const current = lines[lines.length - 1];
    if (current) {
      const overlap = Math.min(current.end, span.end) - Math.max(current.start, span.start);
      const minHeight = Math.min(current.end - current.start, span.end - span.start);
      if (overlap > 0.5 * minHeight) {
        current.start = Math.min(current.start, span.start);
        current.end = Math.max(current.end, span.end);
        continue;
      }
    }
    lines.push({ start: span.start, end: span.end });
  }

  return lines;
};

/**
 * Convert per-fragment client rects into sorted visual-line spans along the
 * ruler axis, in container coordinates. Used for the single-column and
 * vertical-writing-mode paths (a full-width band).
 */
export const buildLineBoxes = (
  rects: RulerRect[],
  isVertical: boolean,
  rtl: boolean,
  containerRect: RulerContainerRect,
): ReadingRulerLineBox[] => {
  const spans: ReadingRulerLineBox[] = [];
  for (const r of dropBlockRects(rects, isVertical)) {
    let start: number;
    let end: number;
    if (isVertical) {
      if (rtl) {
        start = containerRect.right - r.right;
        end = containerRect.right - r.left;
      } else {
        start = r.left - containerRect.left;
        end = r.right - containerRect.left;
      }
    } else {
      start = r.top - containerRect.top;
      end = r.bottom - containerRect.top;
    }
    if (end < start) [start, end] = [end, start];
    spans.push({ start, end });
  }

  return mergeLineSpans(spans);
};

// Minimum visible fraction of a line for the band to be allowed to cover it.
const READING_RULER_MIN_VISIBLE_RATIO = 0.5;

/**
 * Keep only the line boxes that are at least half visible within `[0, dimension]`
 * along the ruler axis. The visible range can include lines beyond the viewport
 * edge; this confines the band to lines that are actually on screen, while still
 * allowing it to cover a line that is half shown.
 */
export const filterVisibleLineBoxes = (
  lineBoxes: ReadingRulerLineBox[],
  dimension: number,
): ReadingRulerLineBox[] => {
  if (dimension <= 0) return lineBoxes;
  return lineBoxes.filter((b) => {
    const height = b.end - b.start;
    if (height <= 0) return false;
    const visible = Math.min(b.end, dimension) - Math.max(b.start, 0);
    return visible >= READING_RULER_MIN_VISIBLE_RATIO * height;
  });
};

/**
 * Group overlay-relative rects into columns (by x, using the rendered column
 * count) and into vertical line boxes within each column. Columns are returned
 * in reading order (left-to-right, or right-to-left when `rtl`).
 */
export const buildReadingRulerColumns = (
  rects: RulerRect[],
  columnCount: number,
  overlayWidth: number,
  rtl: boolean,
): ReadingRulerColumn[] => {
  const cols = Math.max(1, Math.floor(columnCount));
  if (overlayWidth <= 0) return [];

  const colWidth = overlayWidth / cols;
  const buckets: RulerRect[][] = Array.from({ length: cols }, () => []);
  for (const r of dropBlockRects(rects, false)) {
    const center = (r.left + r.right) / 2;
    const idx = Math.max(0, Math.min(cols - 1, Math.floor(center / colWidth)));
    buckets[idx]!.push(r);
  }

  const columns: ReadingRulerColumn[] = [];
  for (const bucket of buckets) {
    if (!bucket.length) continue;
    let left = Infinity;
    let right = -Infinity;
    const spans: ReadingRulerLineBox[] = [];
    for (const r of bucket) {
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      spans.push({ start: r.top, end: r.bottom });
    }
    const lines = mergeLineSpans(spans);
    if (lines.length) columns.push({ left, right, lines });
  }

  if (rtl) columns.reverse();
  return columns;
};

export const calculateReadingRulerSize = (
  lines: number,
  viewSettings: ReadingRulerSettings,
  bookFormat: BookFormat,
): number => {
  if (FIXED_LAYOUT_FORMATS.has(bookFormat)) {
    return lines * FIXED_LAYOUT_READING_RULER_LINE_HEIGHT;
  }

  const fontSize = viewSettings.defaultFontSize || 16;
  const lineHeight = viewSettings.lineHeight || 1.5;
  return Math.round(lines * fontSize * lineHeight);
};

// Fraction of a line height used as breathing room on each side of the block.
const READING_RULER_PADDING_FACTOR = 0.3;

/**
 * Breathing room applied on each side of the text block, so the padding around
 * the text is the same all around: round(fontSize * lineHeight * 0.3).
 */
export const calculateReadingRulerPadding = (
  viewSettings: ReadingRulerSettings,
  bookFormat: BookFormat,
): number => {
  if (FIXED_LAYOUT_FORMATS.has(bookFormat)) {
    return Math.round(FIXED_LAYOUT_READING_RULER_LINE_HEIGHT * READING_RULER_PADDING_FACTOR);
  }
  const fontSize = viewSettings.defaultFontSize || 16;
  const lineHeight = viewSettings.lineHeight || 1.5;
  return Math.round(fontSize * lineHeight * READING_RULER_PADDING_FACTOR);
};

export const clampReadingRulerPosition = (
  position: number,
  dimension: number,
  rulerSize: number,
): number => {
  if (dimension <= 0) return Math.max(0, Math.min(100, position));

  const halfPct = (rulerSize / 2 / dimension) * 100;
  if (halfPct >= 50) return 50;

  return Math.max(halfPct, Math.min(100 - halfPct, position));
};

export const stepReadingRulerPosition = (
  currentPosition: number,
  dimension: number,
  rulerSize: number,
  direction: 'backward' | 'forward',
): number => {
  if (dimension <= 0) {
    return clampReadingRulerPosition(currentPosition, dimension, rulerSize);
  }

  const currentCenter = (currentPosition / 100) * dimension;
  const offset = direction === 'forward' ? rulerSize : -rulerSize;

  return clampReadingRulerPosition(
    ((currentCenter + offset) / dimension) * 100,
    dimension,
    rulerSize,
  );
};

/**
 * Snap to the next/previous block of `lines` real text lines and return that
 * block's extent { start, end } along the ruler axis (px), or null when there
 * is no next group in the given direction (the caller then flips the page).
 * The caller pads this block symmetrically to size the band, so padding around
 * the text is the same on both sides.
 *
 * `currentBlockStart`/`currentBlockEnd` describe the lines currently covered;
 * pass -Infinity / -Infinity to get the first group from the top, or
 * Infinity / Infinity to get the last group from the bottom.
 */
export const snapReadingRulerToLines = (
  currentBlockStart: number,
  currentBlockEnd: number,
  lines: number,
  direction: 'backward' | 'forward',
  lineBoxes: ReadingRulerLineBox[],
): ReadingRulerLineBox | null => {
  if (lineBoxes.length === 0) return null;

  const count = Math.max(1, Math.floor(lines));
  const heights = lineBoxes
    .map((b) => b.end - b.start)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 0;
  const eps = medianHeight * 0.3;

  const block = (startIdx: number, endIdx: number): ReadingRulerLineBox | null => {
    const startBox = lineBoxes[startIdx];
    const endBox = lineBoxes[endIdx];
    if (!startBox || !endBox) return null;
    return { start: startBox.start, end: endBox.end };
  };

  if (direction === 'forward') {
    const startIdx = lineBoxes.findIndex((b) => b.start >= currentBlockEnd - eps);
    if (startIdx === -1) return null;
    const endIdx = Math.min(startIdx + count - 1, lineBoxes.length - 1);
    return block(startIdx, endIdx);
  }

  let endIdx = -1;
  for (let i = lineBoxes.length - 1; i >= 0; i--) {
    if ((lineBoxes[i]?.end ?? Infinity) <= currentBlockStart + eps) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null;
  const startIdx = Math.max(endIdx - count + 1, 0);
  return block(startIdx, endIdx);
};

/**
 * Column-aware snap: advance within the active column; when there is no next
 * line group in it, move to the first/last group of the next/previous column.
 * Returns the target column index and the block extent { start, end } (px), or
 * null when there is no next group anywhere (the caller then flips the page).
 */
export const snapReadingRulerColumns = (
  currentColumnIndex: number,
  currentBlockStart: number,
  currentBlockEnd: number,
  lines: number,
  direction: 'backward' | 'forward',
  columns: ReadingRulerColumn[],
): { columnIndex: number; start: number; end: number } | null => {
  if (columns.length === 0) return null;

  const idx = Math.max(0, Math.min(currentColumnIndex, columns.length - 1));
  const col = columns[idx];
  if (!col) return null;

  const within = snapReadingRulerToLines(
    currentBlockStart,
    currentBlockEnd,
    lines,
    direction,
    col.lines,
  );
  if (within) return { columnIndex: idx, start: within.start, end: within.end };

  if (direction === 'forward') {
    for (let j = idx + 1; j < columns.length; j++) {
      const next = columns[j];
      if (!next) continue;
      const first = snapReadingRulerToLines(-Infinity, -Infinity, lines, 'forward', next.lines);
      if (first) return { columnIndex: j, start: first.start, end: first.end };
    }
  } else {
    for (let j = idx - 1; j >= 0; j--) {
      const prev = columns[j];
      if (!prev) continue;
      const last = snapReadingRulerToLines(Infinity, Infinity, lines, 'backward', prev.lines);
      if (last) return { columnIndex: j, start: last.start, end: last.end };
    }
  }

  return null;
};

/**
 * Whether an arrow-key side should move the reading ruler in the current layout.
 * In vertical writing mode only Up/Down move the ruler (Left/Right turn pages);
 * in horizontal mode all four sides move the ruler. Applies to keyboard nav only
 * — taps always move the ruler regardless of the tapped side.
 */
export const isReadingRulerMoveKey = (
  side: 'left' | 'right' | 'up' | 'down',
  isVertical: boolean,
): boolean => (isVertical ? side === 'up' || side === 'down' : true);

export const getReadingRulerMoveDirection = (
  side: 'left' | 'right' | 'up' | 'down',
  bookDir?: string,
): 'backward' | 'forward' => {
  const normalizedSide =
    bookDir === 'rtl' && (side === 'left' || side === 'right')
      ? side === 'left'
        ? 'right'
        : 'left'
      : side;

  return normalizedSide === 'left' || normalizedSide === 'up' ? 'backward' : 'forward';
};
