import type { FoliateView } from '@/types/view';

// Heuristically classify a link as a possible footnote marker based on its
// text content. Matches plain digits (1, 12), prefixed/bracketed digits
// (a1, [1], (1), [1), CJK full-width digits/brackets (（注1）, 【2】, ［1］, 〖2〗, 25）),
// translation/editor note prefixes (注1, 註1, 訳注1, 訳註1, 原注2, 編注3), note ranges (61～69）),
// circled numbers (①〜⑳), and common footnote symbols with optional numbers (＊, ＊1, *, *1, ※, ※1, †, ‡).
const FOOTNOTE_MARKER_RE =
  /^[（(［\[【〔〈〖]?\s*(?:[＊*※†‡]\s*[0-9０-９]*|(?:[a-zA-Z]{1,2}|(?:訳|原|編)?[注註](?:釈)?|Notes?)\s*[0-9０-９]+(?:[〜～~-][0-9０-９]+)?|[①-⑳㉑-㊿]|[0-9０-９]+(?:[〜～~-][0-9０-９]+)?)\s*[）)］\]】〕〉〗]?$/i;

const EXPLICIT_NOTE_PREFIX_RE =
  /^[（(［\[【〔〈〖]?\s*(?:(?:訳|原|編)?[注註](?:釈)?|Notes?)\s*[0-9０-９]+(?:[〜～~-][0-9０-９]+)?\s*[）)］\]】〕〉〗]?$/i;

const isFootnoteMarkerText = (text: string | null | undefined) =>
  text != null && FOOTNOTE_MARKER_RE.test(text.trim());

const isNumericMarkerText = isFootnoteMarkerText;

const EXPLICIT_NOTEREF_TYPES = new Set(['noteref', 'biblioref', 'glossref']);
const EXPLICIT_NOTEREF_ROLES = new Set(['doc-noteref', 'doc-biblioref', 'doc-glossref']);

const isExplicitNoteref = (anchor: HTMLAnchorElement) => {
  const epubType =
    anchor.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ??
    anchor.getAttribute('epub:type') ??
    '';
  if (epubType.split(/\s+/).some((t) => EXPLICIT_NOTEREF_TYPES.has(t))) return true;
  const role = anchor.getAttribute('role') ?? '';
  return role.split(/\s+/).some((r) => EXPLICIT_NOTEREF_ROLES.has(r));
};

// Books with in-book navigation (TOC, chapter/verse indexes) often render a
// flat list of short numeric links: `<a>1</a>, <a>2</a>, ...`. Those should
// not be treated as footnote candidates. We detect that context by looking
// at the anchor's ancestors for sibling links that also match the numeric
// pattern. A single paragraph rarely has more than one or two real footnote
// markers, so a low threshold is safe.
const NAV_LIST_SIBLING_THRESHOLD = 2;
const MAX_ANCESTOR_DEPTH = 3;
const SECTION_CONTAINER_TAGS = new Set(['BODY', 'HTML', 'MAIN', 'ARTICLE', 'SECTION']);

const countNumericSiblings = (container: Element, anchor: HTMLAnchorElement) => {
  let count = 0;
  for (const link of Array.from(container.querySelectorAll('a'))) {
    if (link === anchor || isExplicitNoteref(link)) continue;
    if (isNumericMarkerText(link.textContent)) {
      count++;
      if (count >= NAV_LIST_SIBLING_THRESHOLD) return count;
    }
  }
  return count;
};

export const shouldCheckAsFootnote = (anchor: HTMLAnchorElement): boolean => {
  if (!isNumericMarkerText(anchor.textContent)) return false;
  if (EXPLICIT_NOTE_PREFIX_RE.test(anchor.textContent!.trim())) return true;
  let container: Element | null = anchor.parentElement;
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && container; depth++) {
    if (SECTION_CONTAINER_TAGS.has(container.tagName)) break;
    const blockChildren = Array.from(container.children).filter(
      (el) => el.tagName === 'P' || el.tagName === 'DIV',
    ).length;
    if (blockChildren > 1) break;
    if (countNumericSiblings(container, anchor) >= NAV_LIST_SIBLING_THRESHOLD) {
      return false;
    }
    container = container.parentElement;
  }
  return true;
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
