import { CFI, SectionFragment, SectionItem, TOCItem } from '@/libs/document';

const findFragmentPosition = (html: string, fragmentId: string | undefined): number => {
  if (!fragmentId) return html.length;
  const patterns = [
    new RegExp(`\\sid=["']${CSS.escape(fragmentId)}["']`, 'i'),
    new RegExp(`\\sname=["']${CSS.escape(fragmentId)}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && typeof match.index === 'number') return match.index;
  }
  return -1;
};

// Memoized variant for use inside buildSectionFragments — within a single
// section, each TOC fragment id is consulted twice (once as the current
// boundary, once as the next item's `prev`), so without caching we run 2N
// regex scans over the whole HTML for N fragments. The cache collapses that
// to N. Cache lifetime is one section pass; not exposed.
const makeFragmentPositionCache = (html: string) => {
  const memo = new Map<string, number>();
  return (fragmentId: string | undefined): number => {
    if (!fragmentId) return html.length;
    const cached = memo.get(fragmentId);
    if (cached !== undefined) return cached;
    const pos = findFragmentPosition(html, fragmentId);
    memo.set(fragmentId, pos);
    return pos;
  };
};

const calculateFragmentSize = (
  content: string,
  fragmentId: string | undefined,
  prevFragmentId: string | undefined,
  positionOf: (id: string | undefined) => number,
): number => {
  const endPos = positionOf(fragmentId);
  if (endPos < 0) return 0;
  const startPos = prevFragmentId ? positionOf(prevFragmentId) : 0;
  const validStartPos = Math.max(0, startPos);
  if (endPos < validStartPos) return 0;
  return new Blob([content.substring(validStartPos, endPos)]).size;
};

const getHTMLFragmentElement = (doc: Document, id: string | undefined): Element | null => {
  if (!id) return null;
  return doc.getElementById(id) ?? doc.querySelector(`[name="${CSS.escape(id)}"]`);
};

type CFIModule = {
  joinIndir: (...xs: string[]) => string;
  fromElements: (elements: Element[]) => string[];
};

// foliate-js's `fromElements` walks `parentNode` chain via repeated calls to
// `nodeToParts(parentNode)`. The termination check (epubcfi.js line 281) is
// "stop when current node's parentNode === documentElement", which means
// recursion stops AT `<body>` (parent is `<html>`/documentElement) but NOT at
// `<html>` itself (parent is the Document, which !== documentElement, so it
// recurses one more level into the Document, then tries indexChildNodes on
// Document.parentNode === null → "null is not an object (evaluating
// 'node.childNodes')").
//
// Concretely it blows up when:
//   - element is `documentElement` itself,
//   - element is `<body>` itself (recursion starts at `<html>` and overshoots),
//   - element is detached / parentNode === null,
//   - element lives outside <body> (e.g. ids on <head>) — even when it
//     wouldn't crash, the CFI it would produce is meaningless for our use.
//
// Reject these up-front so we silently fall back to the section CFI instead
// of throwing + spamming console.warn for every fragment.
const isCfiAddressable = (element: Element): boolean => {
  const doc = element.ownerDocument;
  if (!doc) return false;
  if (element === doc.documentElement) return false;
  const body = doc.body;
  if (!body) return false;
  // Must be a STRICT descendant of <body>. Body itself overshoots the
  // foliate-js termination check (see comment above).
  if (element === body) return false;
  if (!body.contains(element)) return false;
  // Defensive: parentNode chain must reach <body> without hitting null first.
  // Covers detached subtrees and weird DOMs where contains() lies.
  let cursor: Node | null = element.parentNode;
  while (cursor && cursor !== body) {
    cursor = cursor.parentNode;
  }
  return cursor === body;
};

const buildFragmentCfi = (section: SectionItem, element: Element | null): string => {
  const cfiLib = CFI as unknown as CFIModule;
  if (!element || !isCfiAddressable(element)) {
    return section.cfi;
  }
  try {
    const rel = cfiLib.fromElements([element])[0] ?? '';
    return cfiLib.joinIndir(section.cfi, rel);
  } catch (e) {
    console.warn('Failed to build CFI for fragment, falling back to section CFI:', e);
    return section.cfi;
  }
};

export const buildSectionFragments = (
  section: SectionItem,
  fragments: TOCItem[],
  base: TOCItem | null,
  content: string,
  doc: Document,
  splitHref: (href: string) => Array<string | number>,
): SectionFragment[] => {
  const out: SectionFragment[] = [];
  const positionOf = makeFragmentPositionCache(content);
  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i]!;
    const [, rawFragmentId] = splitHref(fragment.href) as [string | undefined, string | undefined];
    const fragmentId = rawFragmentId;

    const prev = i > 0 ? fragments[i - 1] : base;
    const [, rawPrevFragmentId] = prev
      ? (splitHref(prev.href) as [string | undefined, string | undefined])
      : [undefined, undefined];
    const prevFragmentId = rawPrevFragmentId;

    const element = getHTMLFragmentElement(doc, fragmentId);
    const cfi = buildFragmentCfi(section, element);
    const size = calculateFragmentSize(content, fragmentId, prevFragmentId, positionOf);

    out.push({
      id: fragment.href,
      href: fragment.href,
      cfi,
      size,
      linear: section.linear,
    });
  }
  return out;
};
