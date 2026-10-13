import type { FoliateView } from '@/types/view';
import type { PageRect } from '@/services/handwriting/coords';
import type { InkPoint } from '@/services/handwriting/model';
import {
  boundsOf,
  classifyShape,
  columnBox,
  columnLines,
  densify,
  effectiveShape,
  fitFromBox,
  fitToBox,
  fromAnchorBox,
  fromFlow,
  fromSpan,
  interiorSamples,
  toAnchorBox,
  toFlow,
  toSpan,
  type AnchorBox,
  type InkAnchoring,
} from '@/services/handwriting/anchor';

/** Content ink binds to as a whole, rather than to a character inside it. */
const ELEMENT_ANCHORS = new Set(['img', 'svg', 'image', 'video', 'canvas', 'math', 'table']);

/** Steps a margin point takes toward the text looking for content. */
const PROBE_STEPS = 8;

/** Points of a stroke checked for the content it covers. */
const COVER_SAMPLES = 24;

/** How far (in line heights) ink may sit beside text and still cover it. */
const COVER_REACH = 0.6;

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

const isCharacter = (range: Range) =>
  range.startContainer === range.endContainer &&
  range.startContainer.nodeType === Node.TEXT_NODE &&
  range.endOffset - range.startOffset === 1;

const spanning = (first: Range, last: Range): Range => {
  const range = first.startContainer.ownerDocument!.createRange();
  range.setStart(first.startContainer, first.startOffset);
  range.setEnd(last.endContainer, last.endOffset);
  return range;
};

/**
 * Binds reflowable ink in one section to the content it marks, and places it
 * from where that content is laid out now, morphing it by its shape (see
 * InkShape). Returns null until the section is rendered.
 */
export const createInkAnchoring = (
  view: FoliateView,
  sectionIndex: number,
  page: PageRect,
): InkAnchoring | null => {
  const doc = view.renderer.getContents().find((c) => c.index === sectionIndex)?.doc;
  const frame = doc?.defaultView?.frameElement;
  // A re-attached view's section frame reloads, its document briefly rootless.
  if (!doc?.documentElement || !frame) return null;

  // Section document coordinates <-> main-window coordinates.
  const frameRect = frame.getBoundingClientRect();
  const { clientWidth, clientHeight } = doc.documentElement;
  const scaleX = clientWidth ? frameRect.width / clientWidth : 1;
  const scaleY = clientHeight ? frameRect.height / clientHeight : 1;
  // Vertical text runs its lines across the page, so its column breaks look
  // different; treat the whole range as one box there.
  const vertical = doc.defaultView?.getComputedStyle(doc.body).writingMode.startsWith('vertical');

  const toWindowBox = (r: DOMRect): AnchorBox => ({
    left: frameRect.left + r.left * scaleX,
    top: frameRect.top + r.top * scaleY,
    width: r.width * scaleX,
    height: r.height * scaleY,
  });

  /** The range's line boxes in window coordinates, within one column. */
  const linesOf = (range: Range): AnchorBox[] =>
    columnLines(
      (vertical ? [range.getBoundingClientRect()] : [...range.getClientRects()]).map(toWindowBox),
    );

  const boxOf = (range: Range): AnchorBox | null => columnBox(linesOf(range));

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

  const within = (x: number, y: number, box: AnchorBox) =>
    x >= box.left - box.height * COVER_REACH &&
    x <= box.left + box.width + box.height * COVER_REACH &&
    y >= box.top - box.height * COVER_REACH &&
    y <= box.top + box.height * (1 + COVER_REACH);

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
      if (above && aboveBox && y >= aboveBox.top && within(x, y, aboveBox)) return above;
    }
    return hit && box && within(x, y, box) ? hit : null;
  };

  /** Content exactly under a point. */
  const exactlyAt = (x: number, y: number): Range | null => {
    const hit = contentAt(x, y);
    const box = hit && boxOf(hit);
    return hit &&
      box &&
      x >= box.left &&
      x <= box.left + box.width &&
      y >= box.top &&
      y <= box.top + box.height
      ? hit
      : null;
  };

  /** The words and elements found at the samples, or null when there are none. */
  const rangeOf = (samples: InkPoint[], at: (x: number, y: number) => Range | null) => {
    let first: Range | null = null;
    let last: Range | null = null;
    for (const [x, y] of samples) {
      const hit = at(x, y);
      if (!hit) continue;
      if (!first || hit.compareBoundaryPoints(Range.START_TO_START, first) < 0) first = hit;
      if (!last || hit.compareBoundaryPoints(Range.END_TO_END, last) > 0) last = hit;
    }
    if (!first || !last) return null;
    const range = spanning(first, last);
    expandToWords(range);
    return range;
  };

  const strokeSamples = (points: InkPoint[]) => {
    const step = Math.max(1, Math.floor(points.length / COVER_SAMPLES));
    return points.filter((_, i) => i % step === 0);
  };

  /** What an underline or strike-through marks: the text along it, or just above. */
  const markedText = (points: InkPoint[]) => rangeOf(strokeSamples(points), coveredAt);

  /**
   * What a circle, box or scribble marks: the content it encloses, or failing
   * that the content its line runs over. Its edge brushing the next line
   * doesn't count, so the ink stays on what it surrounds.
   */
  const enclosedContent = (points: InkPoint[]) =>
    rangeOf(interiorSamples(points), exactlyAt) ?? rangeOf(strokeSamples(points), exactlyAt);

  /** The first content met walking from (x, y) toward (tx, ty). */
  const contentToward = (x: number, y: number, tx: number, ty: number): Range | null => {
    for (let i = 0; i <= PROBE_STEPS; i++) {
      const t = i / PROBE_STEPS;
      const range = contentAt(x + (tx - x) * t, y + (ty - y) * t);
      if (range && boxOf(range)) return range;
    }
    return null;
  };

  const centerX = page.left + page.width / 2;
  const centerY = page.top + page.height / 2;

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

  const cfiOf = (range: Range) => view.getCFI(sectionIndex, range);

  /** A bar or bracket beside text: the lines next to it, from its top to its bottom. */
  const linesBeside = (bounds: AnchorBox, lineHeight: number): Range | null => {
    const x = bounds.left + bounds.width / 2;
    const top = bounds.top + lineHeight / 2;
    const bottom = bounds.top + bounds.height - lineHeight / 2;
    const first = contentToward(x, top, centerX, top);
    const last = contentToward(x, bottom, centerX, bottom);
    return first && last ? spanning(first, last) : null;
  };

  return {
    pin(points, reuse) {
      const ink = toWindow(points);
      const bounds = boundsOf(ink);

      // The shape decides what the stroke marks, measured against the text
      // nearest to it.
      const near = contentToward(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
        centerX,
        centerY,
      );
      const lineHeight = (near && boxOf(near)?.height) || 0;
      if (lineHeight) {
        const flat = classifyShape(bounds, lineHeight, true) === 'flow';
        const path = flat ? densify(ink, lineHeight / 2) : ink;
        // A short mark encloses nothing; it still marks the text it sits on.
        const covered = flat ? markedText(path) : (enclosedContent(ink) ?? markedText(path));
        const lines = covered ? linesOf(covered) : [];
        if (covered && lines.length) {
          const anchor = cfiOf(covered);
          return flat
            ? { anchor, shape: 'flow', points: toFlow(path, lines) }
            : { anchor, shape: 'box', points: fitToBox(ink, columnBox(lines)!) };
        }
      }

      // Margin ink: a bar or bracket spans the lines beside it; anything else
      // is a note that moves with the nearest character.
      const nearest = contentToward(ink[0]![0], ink[0]![1], centerX, centerY);
      const nearestBox = nearest && boxOf(nearest);
      if (!nearest || !nearestBox) return null;
      if (classifyShape(bounds, nearestBox.height, false) === 'span') {
        const beside = linesBeside(bounds, nearestBox.height);
        const besideLines = beside ? linesOf(beside) : [];
        if (beside && besideLines.length) {
          const box = columnBox(besideLines)!;
          const shape =
            bounds.left + bounds.width / 2 < box.left + box.width / 2 ? 'spanL' : 'spanR';
          return {
            anchor: cfiOf(beside),
            shape,
            points: toSpan(ink, box, besideLines[0]!.height, shape),
          };
        }
      }
      const reused = reuse ? resolve(reuse) : null;
      const box = boxOf(reused ?? nearest);
      if (!box) return null;
      return { anchor: reused ? reuse! : cfiOf(nearest), points: toAnchorBox(ink, box) };
    },

    place(stroke) {
      const range = stroke.anchor ? resolve(stroke.anchor) : null;
      const lines = range ? linesOf(range) : [];
      const box = columnBox(lines);
      if (!box) return null;
      const shape = effectiveShape(stroke.shape, isCharacter(range!));
      switch (shape) {
        case 'flow':
          return fromFlow(stroke.points, lines).map(toPage);
        case 'box':
          return [toPage(fitFromBox(stroke.points, box))];
        case 'spanL':
        case 'spanR':
          return [toPage(fromSpan(stroke.points, box, lines[0]!.height, shape))];
        default:
          return [toPage(fromAnchorBox(stroke.points, box))];
      }
    },
  };
};
