import * as CFI from 'foliate-js/epubcfi.js';

// Mapping info emitted by foliate-js FootnoteHandler's `render` event
// (see getExtractMapping in foliate-js/footnotes.js). The popup document's
// body holds the fragment extracted from the pristine section document;
// this describes how CFI paths translate between the two:
// - `containerCfi`: collapsed CFI (document part only) of the element the
//   fragment was extracted from,
// - `delta`: constant shift of every first-level child-step index (2 x the
//   number of container element children preceding the extraction start),
// - `firstIndex`/`lastIndex`: the range of first-level indices (in pristine
//   document terms) the fragment covers, for reverse-mapping bounds.
export interface FootnoteExtractMapping {
  containerCfi: string;
  delta: number;
  firstIndex: number;
  lastIndex: number;
}

interface CfiPart {
  index: number;
  id?: string;
  offset?: number;
}

const parseSinglePath = (cfi: string): CfiPart[] | null => {
  const parsed = CFI.parse(cfi) as CfiPart[][] | { parent?: unknown };
  if (!Array.isArray(parsed)) return null;
  return parsed[0] ?? null;
};

// CFI parts of a collapsed point, from the document root down to the point.
const boundaryParts = (node: Node, offset: number): CfiPart[] | null => {
  const doc = node.ownerDocument;
  if (!doc) return null;
  const range = doc.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  return parseSinglePath(CFI.fromRange(range) as string);
};

// Element-container boundaries lose their child offset when serialized (CFI
// offsets only apply to character-data steps), so any boundary sitting on an
// element (a select-all on <body>, a triple-click ending on a block, ...)
// must be pushed down to the equivalent text position before mapping —
// otherwise the CFI resolves at the element's start instead of the child
// offset the boundary meant.
const descendToStart = (node: Node): [Node, number] => {
  let n: Node = node;
  while (n.nodeType === Node.ELEMENT_NODE && n.firstChild) n = n.firstChild;
  return [n, 0];
};

const descendToEnd = (node: Node): [Node, number] => {
  let n: Node = node;
  while (n.nodeType === Node.ELEMENT_NODE && n.lastChild) n = n.lastChild;
  return [n, n.nodeType === Node.TEXT_NODE ? (n.nodeValue?.length ?? 0) : n.childNodes.length];
};

const normalizeBoundary = (node: Node, offset: number, isEnd: boolean): [Node, number] => {
  if (node.nodeType !== Node.ELEMENT_NODE) return [node, offset];
  const children = node.childNodes;
  const child = children[isEnd ? offset - 1 : offset];
  if (child) return isEnd ? descendToEnd(child) : descendToStart(child);
  // A start boundary after the last child is the same point as the end of
  // that child; a boundary in a childless element (offset 0) serializes
  // losslessly as the element step itself.
  if (!isEnd && offset > 0 && children.length > 0) {
    return descendToEnd(children[children.length - 1]!);
  }
  return [node, offset];
};

// Translate a selection range inside the (mutated) footnote popup document
// into a CFI that resolves in the pristine section document, joined onto the
// section's spine base CFI. Returns null when the range cannot be mapped.
export const getFootnoteSelectionCfi = (
  range: Range,
  mapping: FootnoteExtractMapping,
  baseCfi: string,
): string | null => {
  try {
    if (!range.startContainer.ownerDocument?.body) return null;
    const containerParts = parseSinglePath(mapping.containerCfi);
    if (!containerParts?.length) return null;

    const mapBoundary = (node: Node, offset: number, isEnd: boolean): string | null => {
      const [n, o] = normalizeBoundary(node, offset, isEnd);
      const parts = boundaryParts(n, o);
      // parts[0] is the popup <body> step; below it lies the fragment
      if (!parts || parts.length < 2) return null;
      const [, first, ...rest] = parts as [CfiPart, CfiPart, ...CfiPart[]];
      const mapped = [...containerParts, { ...first, index: first.index + mapping.delta }, ...rest];
      return CFI.joinIndir(baseCfi, CFI.toString([mapped]) as string) as string;
    };

    const start = mapBoundary(range.startContainer, range.startOffset, false);
    if (!start) return null;
    if (range.collapsed) return start;
    const end = mapBoundary(range.endContainer, range.endOffset, true);
    if (!end) return null;
    return CFI.buildRange(start, end) as string;
  } catch {
    return null;
  }
};

// Translate a stored (pristine-document) annotation CFI into one that
// resolves inside the footnote popup document, so the annotation can be
// drawn in the popup. Returns null when the annotation lies outside the
// extracted fragment.
export const getFootnoteLocalCfi = (
  bookCfi: string,
  mapping: FootnoteExtractMapping,
  popupDoc: Document,
): string | null => {
  try {
    const containerParts = parseSinglePath(mapping.containerCfi);
    if (!containerParts?.length || !popupDoc.body) return null;
    const bodyParts = boundaryParts(popupDoc.body, 0);
    if (!bodyParts?.length) return null;

    const mapPath = (parts: CfiPart[][]): CfiPart[][] | null => {
      const docParts = parts[parts.length - 1];
      if (!docParts || docParts.length <= containerParts.length) return null;
      for (let i = 0; i < containerParts.length; i++) {
        if (docParts[i]!.index !== containerParts[i]!.index) return null;
      }
      const first = docParts[containerParts.length]!;
      if (first.index < mapping.firstIndex || first.index > mapping.lastIndex) return null;
      const rest = docParts.slice(containerParts.length + 1);
      return [
        ...parts.slice(0, -1),
        [...bodyParts, { ...first, index: first.index - mapping.delta }, ...rest],
      ];
    };

    const parsed = CFI.parse(bookCfi);
    const mappedStart = mapPath(CFI.collapse(parsed) as CfiPart[][]);
    if (!mappedStart) return null;
    const mappedEnd = mapPath(CFI.collapse(parsed, true) as CfiPart[][]);
    if (!mappedEnd) return null;
    const startStr = CFI.toString(mappedStart) as string;
    const endStr = CFI.toString(mappedEnd) as string;
    return startStr === endStr ? startStr : (CFI.buildRange(startStr, endStr) as string);
  } catch {
    return null;
  }
};
