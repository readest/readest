import { getTextSubRange, rangeTextExcludingInert } from '@/services/tts/wordHighlight';

// The document selection when it is a non-empty range inside `container`;
// null for no selection, a collapsed one, or one made somewhere else.
export const getSelectionRangeWithin = (container: Node | null): Range | null => {
  if (!container) return null;
  const sel = container.ownerDocument?.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  if (!range.toString().trim()) return null;
  return range;
};

// Map a selection made in the overlay's clone of a paragraph onto the paragraph
// in the book document (#6200). The clone is the paragraph range's
// cloneContents() re-parsed from HTML, so its text matches the source's
// character for character: the selection's character offsets within the clone
// address the same text in the source range. Injected (cfi-inert) text and
// muted ruby are skipped on both sides, as getTextSubRange does.
export const mapCloneSelectionToSource = (
  cloneRoot: Node,
  selection: Range,
  source: Range,
): Range | null => {
  const doc = cloneRoot.ownerDocument;
  if (!doc || !cloneRoot.contains(selection.commonAncestorContainer)) return null;
  const before = doc.createRange();
  before.selectNodeContents(cloneRoot);
  before.setEnd(selection.startContainer, selection.startOffset);
  const start = rangeTextExcludingInert(before).length;
  const length = rangeTextExcludingInert(selection).length;
  if (length === 0) return null;
  try {
    return getTextSubRange(source, start, start + length);
  } catch {
    return null;
  }
};
