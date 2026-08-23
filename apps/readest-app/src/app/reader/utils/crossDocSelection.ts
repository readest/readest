import { Point } from '@/utils/sel';

// A selection that runs across section documents (#5809). Fixed-layout books
// render every PDF page in its own iframe, and a DOM Selection cannot leave its
// document, so a selection that continues onto the next page is kept as one
// native selection per page — a "segment" — and composed into a single
// TextSelection by the text selector.

export interface DocPosition {
  node: Node;
  offset: number;
}

export interface SectionDoc {
  doc: Document;
  index: number;
}

export interface SectionAnchor extends SectionDoc {
  pos: DocPosition;
}

export interface CrossDocSegment extends SectionDoc {
  start: DocPosition;
  end: DocPosition;
}

// The outer ends of a selection that may span sections.
export interface SelectionBounds {
  start: SectionAnchor;
  end: SectionAnchor;
}

// The subset of foliate's `renderer.getContents()` entries this module reads.
export type SectionContent = { doc?: Document | null; index?: number };

const frameOf = (doc: Document) =>
  (doc.defaultView?.frameElement as HTMLIFrameElement | null | undefined) ?? null;

// The rendered section whose iframe is under a window point. Blank placeholder
// frames (no section index) are skipped.
export const findContentAtPoint = (contents: SectionContent[], point: Point): SectionDoc | null => {
  for (const content of contents) {
    const { doc, index } = content;
    if (!doc || index == null) continue;
    const rect = frameOf(doc)?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) continue;
    if (
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    ) {
      return { doc, index };
    }
  }
  return null;
};

// A window point in the document's own CSS pixels, undoing any scale applied
// to its iframe (e.g. a pinch-zoom preview transform).
export const toDocPoint = (doc: Document, point: Point): Point | null => {
  const frame = frameOf(doc);
  const rect = frame?.getBoundingClientRect();
  if (!frame || !rect || rect.width === 0 || rect.height === 0) return null;
  const sx = frame.clientWidth ? frame.clientWidth / rect.width : 1;
  const sy = frame.clientHeight ? frame.clientHeight / rect.height : 1;
  return { x: (point.x - rect.left) * sx, y: (point.y - rect.top) * sy };
};

export const getCaretPosition = (doc: Document, x: number, y: number): DocPosition | null => {
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
  }
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
};

// Whether the point is on text rather than on a blank part of the page. The
// caret lookup snaps blank-area points to the nearest glyph, so the caret alone
// can't tell a text drag from a pan across the page margin; require the point
// to sit on (or right next to) the glyph it resolved to.
const TEXT_HIT_TOLERANCE_PX = 12;
export const isTextAtPoint = (doc: Document, x: number, y: number): boolean => {
  const pos = getCaretPosition(doc, x, y);
  if (!pos || pos.node.nodeType !== Node.TEXT_NODE) return false;
  const text = pos.node as Text;
  if (text.length === 0) return false;
  const offset = Math.min(pos.offset, text.length - 1);
  const range = doc.createRange();
  range.setStart(text, offset);
  range.setEnd(text, offset + 1);
  return Array.from(range.getClientRects()).some(
    (rect) =>
      x >= rect.left - TEXT_HIT_TOLERANCE_PX &&
      x <= rect.right + TEXT_HIT_TOLERANCE_PX &&
      y >= rect.top - TEXT_HIT_TOLERANCE_PX &&
      y <= rect.bottom + TEXT_HIT_TOLERANCE_PX,
  );
};

// First and last selectable text positions of a section document.
export const getDocTextBounds = (
  doc: Document,
): { start: DocPosition; end: DocPosition } | null => {
  if (!doc.body) return null;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  const first = walker.nextNode() as Text | null;
  if (!first) return null;
  let last = first;
  let next: Node | null;
  while ((next = walker.nextNode())) last = next as Text;
  return { start: { node: first, offset: 0 }, end: { node: last, offset: last.length } };
};

// The caret for a point, clamped to the page's text: above the top-most glyph
// it is the start of the page's text, below the bottom-most glyph its end.
// pdf.js positions every glyph run absolutely, so the browser's own caret
// lookup over a blank margin snaps to some run mid-page instead.
export const getCaretPositionInText = (doc: Document, x: number, y: number): DocPosition | null => {
  const bounds = getDocTextBounds(doc);
  if (!bounds) return null;
  const probe = doc.createRange();
  let top = Infinity;
  let bottom = -Infinity;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  let node: Node | null;
  while ((node = walker.nextNode())) {
    probe.selectNodeContents(node);
    const rect = probe.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (y < top) return bounds.start;
  if (y > bottom) return bounds.end;
  return getCaretPosition(doc, x, y);
};

// The range between two positions of a document, whichever comes first.
export const rangeBetweenPositions = (doc: Document, a: DocPosition, b: DocPosition) => {
  const probeA = doc.createRange();
  const probeB = doc.createRange();
  try {
    probeA.setStart(a.node, a.offset);
    probeB.setStart(b.node, b.offset);
  } catch {
    return null;
  }
  const forward = probeA.compareBoundaryPoints(Range.START_TO_START, probeB) <= 0;
  return rangeFromPositions(doc, forward ? a : b, forward ? b : a);
};

export const rangeFromPositions = (doc: Document, start: DocPosition, end: DocPosition) => {
  const range = doc.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
};

// The per-section segments of a selection anchored at `anchor` whose other
// end is `target` on a different section: the earlier section from its
// position to its end, every rendered section between them in full, and the
// later section from its start to its position. Collapsed parts are dropped.
export const buildCrossDocSegments = (
  anchor: SectionAnchor,
  target: SectionAnchor,
  contents: SectionContent[],
): CrossDocSegment[] => {
  if (anchor.doc === target.doc || anchor.index === target.index) return [];
  const [lo, hi] = anchor.index < target.index ? [anchor, target] : [target, anchor];
  const segments: CrossDocSegment[] = [];
  const push = (doc: Document, index: number, start: DocPosition, end: DocPosition) => {
    if (rangeFromPositions(doc, start, end)) segments.push({ doc, index, start, end });
  };
  const loBounds = getDocTextBounds(lo.doc);
  if (loBounds) push(lo.doc, lo.index, lo.pos, loBounds.end);
  for (const { doc, index } of contents) {
    if (!doc || index == null || index <= lo.index || index >= hi.index) continue;
    const bounds = getDocTextBounds(doc);
    if (bounds) push(doc, index, bounds.start, bounds.end);
  }
  const hiBounds = getDocTextBounds(hi.doc);
  if (hiBounds) push(hi.doc, hi.index, hiBounds.start, hi.pos);
  return segments.sort((a, b) => a.index - b.index);
};

// Make the segments the live DOM selection of their documents and clear the
// selection of every other rendered section. The anchor document keeps its
// selection base at the anchor so a native drag that returns to it extends
// from the same point.
export const applyCrossDocSegments = (
  segments: CrossDocSegment[],
  contents: SectionContent[],
  anchor?: SectionAnchor | null,
) => {
  const docs = new Set(segments.map((segment) => segment.doc));
  for (const { doc } of contents) {
    if (doc && !docs.has(doc)) doc.getSelection()?.removeAllRanges();
  }
  for (const { doc, start, end } of segments) {
    const sel = doc.getSelection();
    if (!sel) continue;
    const anchoredAtEnd =
      anchor?.doc === doc && anchor.pos.node === end.node && anchor.pos.offset === end.offset;
    if (anchoredAtEnd) sel.setBaseAndExtent(end.node, end.offset, start.node, start.offset);
    else sel.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
  }
};

// While a mouse drag that started in this document is over another section,
// the browser keeps extending its selection towards the out-of-frame pointer
// (Blink resolves such points to the page start). Making the page root
// non-selectable while keeping the text layer selectable leaves the selection
// alone (Chromium 148+), so the segment written by applyCrossDocSegments sticks.
export const setNativeDragFrozen = (doc: Document, frozen: boolean) => {
  const root = doc.documentElement;
  const layer = doc.querySelector<HTMLElement>('.textLayer') ?? doc.body;
  if (!root || !layer) return;
  root.style.userSelect = frozen ? 'none' : '';
  root.style.webkitUserSelect = frozen ? 'none' : '';
  layer.style.userSelect = frozen ? 'text' : '';
  layer.style.webkitUserSelect = frozen ? 'text' : '';
};
