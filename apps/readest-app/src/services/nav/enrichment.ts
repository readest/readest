// Embedded-nav fallback
//
// Some EPUBs ship a sparse toc.ncx (top-level volume/part entries only) while
// the real chapter-level TOC lives inside a content HTML as a <nav> block.
// foliate-js only parses <nav> from files flagged with properties="nav" in the
// OPF, so those embedded navs are invisible to bookDoc.toc. When the spine has
// far more sections than the TOC references, scan section HTMLs for <nav>
// elements and merge their links as ordinary top-level TOC items.

import { BookDoc, TOCItem } from '@/libs/document';
import { collectAllTocItems } from './grouping';

const NAV_ENRICH_MIN_SECTIONS = 64;
const NAV_ENRICH_TOC_RATIO = 8;
const EPUB_NS = 'http://www.idpf.org/2007/ops';

interface ExtractedNavItem {
  label: string;
  href: string;
  subitems?: ExtractedNavItem[];
}

const resolveNavHref = (href: string, sectionId: string): string => {
  if (!href) return '';
  try {
    const base = `epub:///${encodeURI(sectionId)}`;
    const url = new URL(href, base);
    if (url.protocol !== 'epub:') return '';
    const path = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return path + url.hash;
  } catch {
    return '';
  }
};

const firstChildByLocalName = (parent: Element, names: readonly string[]): Element | null => {
  for (const child of Array.from(parent.children)) {
    if (names.includes(child.localName)) return child;
  }
  return null;
};

const childrenByLocalName = (parent: Element, name: string): Element[] =>
  Array.from(parent.children).filter((c) => c.localName === name);

const normalizeWhitespace = (s: string): string => s.replace(/\s+/g, ' ').trim();

const parseNavList = (list: Element, sectionId: string): ExtractedNavItem[] => {
  const items: ExtractedNavItem[] = [];
  for (const li of childrenByLocalName(list, 'li')) {
    const anchor = firstChildByLocalName(li, ['a', 'span']);
    const sublist = firstChildByLocalName(li, ['ol', 'ul']);
    const rawHref = anchor?.getAttribute('href') ?? '';
    const href = resolveNavHref(rawHref, sectionId);
    const label =
      normalizeWhitespace(anchor?.textContent ?? '') || (anchor?.getAttribute('title') ?? '');
    const subitems = sublist ? parseNavList(sublist, sectionId) : undefined;
    if (!href && !subitems?.length) continue;
    items.push({
      label,
      href,
      subitems: subitems?.length ? subitems : undefined,
    });
  }
  return items;
};

const extractTocFromNav = (nav: Element, sectionId: string): ExtractedNavItem[] => {
  const types = (nav.getAttributeNS(EPUB_NS, 'type') ?? '').split(/\s+/).filter(Boolean);
  if (types.includes('page-list') || types.includes('landmarks')) return [];
  const list = firstChildByLocalName(nav, ['ol', 'ul']);
  return list ? parseNavList(list, sectionId) : [];
};

const toTocItems = (items: ExtractedNavItem[]): TOCItem[] =>
  items.map((item) => ({
    id: 0,
    label: item.label,
    href: item.href,
    index: 0,
    subitems: item.subitems?.length ? toTocItems(item.subitems) : undefined,
  }));

const hrefSection = (href: string): string => {
  const idx = href.indexOf('#');
  return idx < 0 ? href : href.slice(0, idx);
};

export const enrichTocFromNavElements = async (
  bookDoc: BookDoc,
  tocClone: TOCItem[],
): Promise<boolean> => {
  const sections = bookDoc.sections ?? [];
  if (sections.length <= NAV_ENRICH_MIN_SECTIONS) return false;
  const flatCount = collectAllTocItems(tocClone).length;
  if (flatCount > 0 && sections.length <= NAV_ENRICH_TOC_RATIO * flatCount) return false;

  const existingHrefs = new Set<string>();
  for (const item of collectAllTocItems(tocClone)) {
    if (!item.href) continue;
    const [rawSection] = bookDoc.splitTOCHref(item.href) as [string | undefined];
    existingHrefs.add(rawSection ?? hrefSection(item.href));
  }

  const sectionIdSet = new Set(sections.map((s) => s.id));

  const collected: ExtractedNavItem[] = [];
  const seenHref = new Set<string>();

  for (const section of sections) {
    if (!section.loadText) continue;
    let content: string | null = null;
    try {
      content = await section.loadText();
    } catch {
      content = null;
    }
    if (!content || !content.includes('<nav')) continue;

    let doc: Document;
    try {
      doc = await section.createDocument();
    } catch {
      continue;
    }

    const navs = Array.from(doc.getElementsByTagName('nav'));
    if (navs.length === 0) continue;

    for (const navEl of navs) {
      const extracted = extractTocFromNav(navEl, section.id);
      for (const item of extracted) {
        const sectionPart = hrefSection(item.href);
        if (!sectionPart || !sectionIdSet.has(sectionPart)) continue;
        if (existingHrefs.has(sectionPart)) continue;
        if (seenHref.has(item.href)) continue;
        seenHref.add(item.href);
        collected.push(item);
      }
    }
  }

  if (!collected.length) return false;

  tocClone.push(...toTocItems(collected));
  return true;
};
