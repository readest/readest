// Helpers for word-level TTS highlighting driven by Edge TTS word-boundary
// metadata. Boundary words are matched sequentially against the text of the
// currently spoken sentence range; an unmatched word (e.g. rewritten by a
// TTS-only proofread rule) is skipped without advancing the search cursor so
// later words still align.

export interface TTSWordOffset {
  start: number;
  end: number;
}

// Edge TTS word-boundary offsets are in 100-nanosecond ticks.
const TICKS_PER_SECOND = 10_000_000;

// Gloss markup (<rt cfi-inert>) and any cfi-inert subtree is injected, non-book
// content — invisible to CFI and to spoken text (the TTS node filter rejects
// <rt>). Word-offset matching must ignore it too, or boundary words (gloss-free)
// won't align with the walked text.
const isInertText = (node: Node): boolean => {
  let p: Node | null = node.parentNode;
  while (p) {
    if (p.nodeType === Node.ELEMENT_NODE) {
      const el = p as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'rt' || tag === 'rp' || el.hasAttribute('cfi-inert')) return true;
    }
    p = p.parentNode;
  }
  return false;
};

/** range.toString() minus any inert (gloss) text — the matching baseline. */
export const rangeTextExcludingInert = (base: Range): string => {
  const root = base.commonAncestorContainer;
  const doc = root.ownerDocument ?? (root as Document);
  if (root.nodeType === Node.TEXT_NODE) {
    return isInertText(root) ? '' : (root as Text).data;
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!base.intersectsNode(node) || isInertText(node)) continue;
    const text = node as Text;
    const from = node === base.startContainer ? base.startOffset : 0;
    const to = node === base.endContainer ? base.endOffset : text.data.length;
    if (to > from) out += text.data.slice(from, to);
  }
  return out;
};

export const computeWordOffsets = (text: string, words: string[]): (TTSWordOffset | null)[] => {
  const offsets: (TTSWordOffset | null)[] = [];
  let cursor = 0;
  for (const word of words) {
    const trimmed = word.trim();
    if (!trimmed) {
      offsets.push(null);
      continue;
    }
    const index = text.indexOf(trimmed, cursor);
    if (index === -1) {
      offsets.push(null);
      continue;
    }
    offsets.push({ start: index, end: index + trimmed.length });
    cursor = index + trimmed.length;
  }
  return offsets;
};

export const findBoundaryIndexAtTime = (
  boundaries: { offset: number }[],
  seconds: number,
): number => {
  const ticks = seconds * TICKS_PER_SECOND;
  let low = 0;
  let high = boundaries.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (boundaries[mid]!.offset <= ticks) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
};

// Extract the sub-range covering [start, end) of base.toString(). Walks the
// text nodes intersecting the base range, slicing partially-contained
// boundary nodes the same way Range stringification does.
export const getTextSubRange = (base: Range, start: number, end: number): Range | null => {
  if (start < 0 || end <= start) return null;
  const root = base.commonAncestorContainer;
  const doc = root.ownerDocument ?? (root as Document);
  // A TreeWalker never yields its root, which is the node itself when the
  // base range lies within a single text node.
  const textNodes = function* () {
    if (root.nodeType === Node.TEXT_NODE) {
      yield root;
      return;
    }
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!isInertText(node)) yield node;
    }
  };
  let pos = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  for (const node of textNodes()) {
    if (!base.intersectsNode(node)) continue;
    const text = node as Text;
    const from = node === base.startContainer ? base.startOffset : 0;
    const to = node === base.endContainer ? base.endOffset : text.data.length;
    if (to <= from) continue;
    const len = to - from;
    if (!startNode && pos + len > start) {
      startNode = text;
      startOffset = from + (start - pos);
    }
    if (startNode && pos + len >= end) {
      const range = doc.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(text, from + (end - pos));
      return range;
    }
    pos += len;
  }
  return null;
};
