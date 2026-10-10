import type { FoliateView } from '@/types/view';
import type { PageRect } from '@/services/handwriting/coords';
import type { InkPoint } from '@/services/handwriting/model';
import {
  fitFromBox,
  fitToBox,
  fromAnchorBox,
  toAnchorBox,
  type AnchorBox,
  type InkAnchoring,
} from '@/services/handwriting/anchor';

/** Content ink binds to as a whole, rather than to a character inside it. */
const ELEMENT_ANCHORS = new Set(['img', 'svg', 'image', 'video', 'canvas', 'math', 'table']);

/** Steps a margin point takes toward the page center looking for content. */
const PROBE_STEPS = 8;

/** Points of a stroke checked for the content it covers. */
const COVER_SAMPLES = 24;

/** How far (in line heights) ink may sit beside text and still cover it. */
const COVER_REACH = 0.6;

const wordSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null;

/** Grow a range's text ends to whole words, so ink binds to what it marks. */
const expandToWords = (range: Range) => {
  if (!wordSegmenter) return;
  const { startContainer: start, endContainer: end } = range;
  if (start.nodeType === Node.TEXT_NODE) {
    const word = wordSegmenter.segment(start.textContent ?? '').containing(range.startOffset);
    if (word?.isWordLike) range.setStart(start, word.index);
  }
  if (end.nodeType === Node.TEXT_NODE && range.endOffset > 0) {
    const word = wordSegmenter.segment(end.textContent ?? '').containing(range.endOffset - 1);
    if (word?.isWordLike) range.setEnd(end, word.index + word.segment.length);
  }
};

/** A lone character anchors margin ink; anything wider is a covered range. */
const isCharacter = (range: Range) =>
  range.startContainer === range.endContainer &&
  range.startContainer.nodeType === Node.TEXT_NODE &&
  range.endOffset - range.startOffset === 1;

// caretPositionFromPoint is the standard; older WebViews only have the
// deprecated caretRangeFromPoint.
type CaretDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

const caretAt = (doc: CaretDocument, x: number, y: number): Range | null => {
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const range = doc.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    return range;
  }
  return doc.caretRangeFromPoint?.(x, y) ?? null;
};

/** The single character at a caret position, so the anchor has a box. */
const characterAt = (caret: Range): Range | null => {
  const node = caret.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const length = node.textContent?.length ?? 0;
  if (length === 0) return null;
  const start = Math.min(caret.startOffset, length - 1);
  const range = node.ownerDocument!.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + 1);
  return range;
};

/**
 * Binds reflowable ink in one section to the content it covers (or, in the
 * margins, to the nearest character) and places it from where that content
 * is laid out now. Returns null until the section is rendered.
 */
export const createInkAnchoring = (
  view: FoliateView,
  sectionIndex: number,
  page: PageRect,
): InkAnchoring | null => {
  const doc = view.renderer.getContents().find((c) => c.index === sectionIndex)?.doc;
  const frame = doc?.defaultView?.frameElement;
  if (!doc || !frame) return null;

  // Section document coordinates <-> main-window coordinates.
  const frameRect = frame.getBoundingClientRect();
  const { clientWidth, clientHeight } = doc.documentElement;
  const scaleX = clientWidth ? frameRect.width / clientWidth : 1;
  const scaleY = clientHeight ? frameRect.height / clientHeight : 1;

  const boxOf = (range: Range): AnchorBox | null => {
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return {
      left: frameRect.left + r.left * scaleX,
      top: frameRect.top + r.top * scaleY,
      width: r.width * scaleX,
      height: r.height * scaleY,
    };
  };

  const contentAt = (x: number, y: number): Range | null => {
    const dx = (x - frameRect.left) / scaleX;
    const dy = (y - frameRect.top) / scaleY;
    const element = doc.elementFromPoint(dx, dy);
    if (element && ELEMENT_ANCHORS.has(element.localName)) {
      const range = doc.createRange();
      range.selectNode(element);
      return range;
    }
    const caret = caretAt(doc as CaretDocument, dx, dy);
    return caret ? characterAt(caret) : null;
  };

  const within = (x: number, y: number, box: AnchorBox, below: number) =>
    x >= box.left - box.height * COVER_REACH &&
    x <= box.left + box.width + box.height * COVER_REACH &&
    y >= box.top - box.height * COVER_REACH &&
    y <= box.top + box.height * (1 + below);

  /**
   * Content a point of ink marks. Between two lines it belongs to the line
   * above, so an underline covers the words over it, not the next line.
   */
  const coveredAt = (x: number, y: number): Range | null => {
    const hit = contentAt(x, y);
    const box = hit && boxOf(hit);
    if (hit && box && y >= box.top && y <= box.top + box.height) return hit;
    const lineHeight = box?.height ?? 0;
    for (const step of [0.5, 1]) {
      const above = lineHeight ? contentAt(x, y - lineHeight * step) : null;
      const aboveBox = above && boxOf(above);
      if (above && aboveBox && y >= aboveBox.top && within(x, y, aboveBox, COVER_REACH)) {
        return above;
      }
    }
    return hit && box && within(x, y, box, COVER_REACH) ? hit : null;
  };

  /** The range of words and elements a stroke covers, or null over margins. */
  const coveredRange = (points: InkPoint[]): Range | null => {
    const step = Math.max(1, Math.floor(points.length / COVER_SAMPLES));
    const samples = points.filter((_, i) => i % step === 0);
    // The middle of the stroke's bounds catches what a circle surrounds.
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    samples.push([
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    ]);
    let first: Range | null = null;
    let last: Range | null = null;
    for (const [x, y] of samples) {
      const hit = coveredAt(x, y);
      if (!hit) continue;
      if (!first || hit.compareBoundaryPoints(Range.START_TO_START, first) < 0) first = hit;
      if (!last || hit.compareBoundaryPoints(Range.END_TO_END, last) > 0) last = hit;
    }
    if (!first || !last) return null;
    const range = doc.createRange();
    range.setStart(first.startContainer, first.startOffset);
    range.setEnd(last.endContainer, last.endOffset);
    expandToWords(range);
    return range;
  };

  /** Content under the point, or the nearest on the way to the page center. */
  const nearestContent = (x: number, y: number): Range | null => {
    const cx = page.left + page.width / 2;
    const cy = page.top + page.height / 2;
    for (let i = 0; i <= PROBE_STEPS; i++) {
      const t = i / PROBE_STEPS;
      const range = contentAt(x + (cx - x) * t, y + (cy - y) * t);
      if (range && boxOf(range)) return range;
    }
    return null;
  };

  const toWindow = (points: InkPoint[]) =>
    points.map(([x, y, p]): InkPoint => {
      const w: InkPoint = [page.left + x * page.width, page.top + y * page.height];
      return p === undefined ? w : [w[0], w[1], p];
    });
  const toPage = (points: InkPoint[]) =>
    points.map(([x, y, p]): InkPoint => {
      const n: InkPoint = [(x - page.left) / page.width, (y - page.top) / page.height];
      return p === undefined ? n : [n[0], n[1], p];
    });

  const resolved = new Map<string, Range | null>();
  const resolve = (anchor: string): Range | null => {
    if (!resolved.has(anchor)) {
      let range: Range | null = null;
      try {
        const { index, anchor: toRange } = view.resolveCFI(anchor);
        if (index === sectionIndex) range = toRange(doc);
      } catch {
        range = null;
      }
      resolved.set(anchor, range);
    }
    return resolved.get(anchor) ?? null;
  };

  return {
    pin(points, reuse) {
      const windowPoints = toWindow(points);
      // Ink over content binds to what it covers; margin ink joins the note
      // it continues, or else the nearest character.
      const covered = coveredRange(windowPoints);
      const reused = !covered && reuse ? resolve(reuse) : null;
      const range = covered ?? reused ?? nearestContent(windowPoints[0]![0], windowPoints[0]![1]);
      const box = range && boxOf(range);
      if (!range || !box) return null;
      const anchor = reused ? reuse! : view.getCFI(sectionIndex, range);
      const stored = isCharacter(range)
        ? toAnchorBox(windowPoints, box)
        : fitToBox(windowPoints, box);
      return { anchor, points: stored };
    },
    place(stroke) {
      const range = stroke.anchor ? resolve(stroke.anchor) : null;
      const box = range && boxOf(range);
      if (!range || !box) return null;
      const placed = isCharacter(range)
        ? fromAnchorBox(stroke.points, box)
        : fitFromBox(stroke.points, box);
      return toPage(placed);
    },
  };
};
