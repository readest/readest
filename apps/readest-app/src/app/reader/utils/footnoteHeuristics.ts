import type { FoliateView } from '@/types/view';

// Heuristically classify a link as a possible footnote marker based on its
// text content. Matches plain digits (1, 12), prefixed/bracketed digits
// (a1, [1], (1), [1), CJK full-width digits/brackets (（注1）, 【2】, ［1］, 〖2〗, 25）),
// translation/editor note prefixes (注1, 註1, 訳注1, 訳註1, 原注2, 編注3), note ranges (61～69）),
// circled numbers (①〜⑳), and common footnote symbols with optional numbers (＊, ＊1, *, *1, ※, ※1, †, ‡).
const FOOTNOTE_MARKER_RE =
  /^[（(［\[【〔〈〖]?\s*(?:[＊*※†‡]\s*[0-9０-９]*|(?:[a-zA-Z]{1,2}|(?:訳|原|編)?[注註](?:釈)?|Notes?)\s*[0-9０-９]+(?:[〜～~-][0-9０-９]+)?|[①-⑳㉑-㊿]|[0-9０-９]+(?:[〜～~-][0-9０-９]+)?)\s*[）)］\]】〕〉〗]?$/i;

const isFootnoteMarkerText = (text: string | null | undefined) =>
  text != null && FOOTNOTE_MARKER_RE.test(text.trim());

const isNumericMarkerText = isFootnoteMarkerText;

// Books with in-book navigation (TOC, chapter/verse indexes) often render a
// flat list of short numeric links: `<a>1</a>, <a>2</a>, ...`. Those should
// not be treated as footnote candidates. We detect that context by looking
// at the anchor's ancestors for sibling links that also match the numeric
// pattern. A single paragraph rarely has more than one or two real footnote
// markers, so a low threshold is safe.
const NAV_LIST_SIBLING_THRESHOLD = 2;
const MAX_ANCESTOR_DEPTH = 3;

const countNumericSiblings = (container: Element, anchor: HTMLAnchorElement) => {
  let count = 0;
  for (const link of Array.from(container.querySelectorAll('a'))) {
    if (link === anchor) continue;
    if (isNumericMarkerText(link.textContent)) {
      count++;
      if (count >= NAV_LIST_SIBLING_THRESHOLD) return count;
    }
  }
  return count;
};

export const shouldCheckAsFootnote = (anchor: HTMLAnchorElement): boolean => {
  if (!isNumericMarkerText(anchor.textContent)) return false;
  let container: Element | null = anchor.parentElement;
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && container; depth++) {
    if (countNumericSiblings(container, anchor) >= NAV_LIST_SIBLING_THRESHOLD) {
      return false;
    }
    container = container.parentElement;
  }
  return true;
};

// Whether an element is set as a superscript, mirroring foliate-js
// `isSuper` (footnotes.js): a `<sup>` element, or a computed vertical-align
// of super/top/text-top/a length (e.g. `super`, `0.5em`).
const isSuperscriptElement = (el: Element | null | undefined): boolean => {
  if (!el) return false;
  if (el.matches('sup')) return true;
  const view = el.ownerDocument?.defaultView;
  const verticalAlign = view?.getComputedStyle(el)?.verticalAlign ?? '';
  return (
    verticalAlign === 'super' ||
    verticalAlign === 'top' ||
    verticalAlign === 'text-top' ||
    /^\d/.test(verticalAlign)
  );
};

const getTypes = (el: Element): Set<string> =>
  new Set([
    ...(el.getAttributeNS('http://www.idpf.org/2007/ops', 'type')?.split(' ') ?? []),
    ...(el.getAttribute('epub:type')?.split(' ') ?? []),
  ]);

const getRoles = (el: Element): Set<string> => new Set(el.getAttribute('role')?.split(' '));

// Whether foliate-js already recognises this link as a footnote reference by
// its superscript marker shape (`isFootnoteReference` / `maybe()` in
// foliate-js footnotes.js): the anchor itself, its single child, or its
// parent is set as a superscript, and it is not a note backlink.
//
// A link like that needs no strict `check` validation: the marker shape is
// independent confirmation that it is a footnote reference, while `check`
// makes foliate reject any extracted note body with more than three element
// children — a false positive for a richly formatted note (backlink +
// marker + emphasis runs, #7537), which then falls back to jumping the main
// view to the note instead of showing the popup.
export const isSuperscriptFootnoteMarker = (anchor: HTMLAnchorElement): boolean => {
  const types = getTypes(anchor);
  const roles = getRoles(anchor);
  if (types.has('backlink') || roles.has('doc-backlink')) return false;
  return (
    isSuperscriptElement(anchor) ||
    (anchor.children.length === 1 && isSuperscriptElement(anchor.children[0] as Element)) ||
    isSuperscriptElement(anchor.parentElement)
  );
};

// The reader hides inline footnote bodies in `getLayoutStyles`
// (`.duokan-footnote-content`, `.epubtype-footnote`, `aside[epub|type~=note]`
// and friends), so a link pointing at one leads to a spot the reader cannot
// see. Report whether a link target is somewhere worth being taken to, so the
// footnote popup can withhold its jump button (#5766).
export const isLinkTargetVisible = (view: FoliateView, href: string): boolean => {
  try {
    const { index, anchor } = view.resolveNavigation(href);
    const doc = view.renderer.getContents().find((content) => content.index === index)?.doc;
    // An inline footnote body always sits beside its reference, so it is always
    // in a rendered section. Anything else is a real destination, and loading
    // its section just to measure would stall the popup.
    if (!doc || !anchor) return true;
    const resolved = anchor(doc) as unknown;
    if (!resolved || typeof resolved === 'number') return true;
    const node =
      typeof resolved === 'object' && 'startContainer' in resolved
        ? (resolved as Range).startContainer
        : (resolved as Node);
    let element = node.nodeType === 1 ? (node as Element) : node.parentElement;
    // Walk the ancestors rather than measuring boxes: footnote targets are
    // often empty inline anchors that have no box of their own even when the
    // paragraph around them is on the page.
    const window = doc.defaultView;
    while (element && window) {
      const { display, visibility } = window.getComputedStyle(element);
      if (display === 'none' || visibility === 'hidden') return false;
      element = element.parentElement;
    }
    return true;
  } catch {
    return true;
  }
};
