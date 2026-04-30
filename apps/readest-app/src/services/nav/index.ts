import { ConvertChineseVariant } from '@/types/book';
import { BookDoc, SectionFragment, TOCItem } from '@/libs/document';
import { initSimpleCC, runSimpleCC } from '@/utils/simplecc';
import {
  cloneSectionFragments,
  cloneTocItems,
  collectAllTocItems,
  groupItemsBySection,
  groupTocSubitems,
} from './grouping';
import { bakeLocationsAndCfis, sortTocItems } from './locations';
import { buildSectionFragments } from './fragments';
import { enrichTocFromNavElements } from './enrichment';

export { findParentPath, findTocItemBS } from './lookup';
export type { SectionFragment };

// -----------------------------------------------------------------------------
// Book navigation artifact (persisted to Books/{hash}/nav.json).
// Bump BOOK_NAV_VERSION whenever computeBookNav output semantics change
// (TOC grouping heuristic, fragment CFI/size math, hierarchy rules).
// v2: fragment CFIs are derived from the section DOM via CFI.joinIndir instead
//     of inherited from the TOC item (ported from foliate-js 317051e).
// v3: nav-enrichment fallback — when toc.ncx is sparse, scan section HTMLs for
//     embedded <nav> elements and merge their links as top-level TOC items.
// -----------------------------------------------------------------------------

export const BOOK_NAV_VERSION = 3;

export interface BookNavSection {
  id: string;
  fragments: SectionFragment[];
}

export interface BookNav {
  version: number;
  toc: TOCItem[];
  sections: Record<string, BookNavSection>;
}

const convertTocLabels = (items: TOCItem[], convertChineseVariant: ConvertChineseVariant) => {
  items.forEach((item) => {
    if (item.label) {
      item.label = runSimpleCC(item.label, convertChineseVariant);
    }
    if (item.subitems) {
      convertTocLabels(item.subitems, convertChineseVariant);
    }
  });
};

// Per-open transformations: label conversion (user setting) and optional sort.
// Structural location/cfi baking lives in computeBookNav/hydrateBookNav so
// the cached BookNav carries the expensive-to-derive fields across opens.
export const updateToc = async (
  bookDoc: BookDoc,
  sortedTOC: boolean,
  convertChineseVariant: ConvertChineseVariant,
) => {
  if (bookDoc.rendition?.layout === 'pre-paginated') return;

  const items = bookDoc?.toc || [];
  if (!items.length) return;

  if (convertChineseVariant && convertChineseVariant !== 'none') {
    await initSimpleCC();
    convertTocLabels(items, convertChineseVariant);
  }

  if (sortedTOC) sortTocItems(items);
};

/**
 * Compute a per-book navigation artifact from a freshly opened BookDoc.
 * Expensive: for each referenced section, loads the HTML text and parses the
 * XHTML DOM to compute per-fragment CFIs (via CFI.joinIndir) and byte-size
 * offsets between TOC-fragment anchors. Intended to run on cache miss; the
 * result is persisted to Books/{hash}/nav.json and replayed via
 * hydrateBookNav on subsequent opens.
 */
export const computeBookNav = async (bookDoc: BookDoc): Promise<BookNav> => {
  const tocClone = cloneTocItems(bookDoc.toc ?? []);
  const sections: Record<string, BookNavSection> = {};
  const enrichedNav = await enrichTocFromNavElements(bookDoc, tocClone);

  if (tocClone.length) {
    groupTocSubitems(bookDoc, tocClone);
  }

  const bookSections = bookDoc.sections ?? [];
  if (!tocClone.length || !bookSections.length) {
    return { version: BOOK_NAV_VERSION, toc: tocClone, sections };
  }

  const sectionMap = new Map(bookSections.map((s) => [s.id, s]));
  const allItems = collectAllTocItems(tocClone);
  const groups = groupItemsBySection(bookDoc, allItems);
  const splitHref = (href: string) => bookDoc.splitTOCHref(href);

  for (const [sectionId, { base, fragments }] of groups.entries()) {
    const section = sectionMap.get(sectionId);
    if (!section || fragments.length === 0) continue;
    if (!section.loadText) continue;

    const content = await section.loadText();
    if (!content) continue;

    let doc: Document | null = null;
    try {
      doc = await section.createDocument();
    } catch (e) {
      console.warn(`Failed to parse section ${sectionId} for fragment CFIs:`, e);
    }
    if (!doc) continue;

    const sectionFragments = buildSectionFragments(
      section,
      fragments,
      base,
      content,
      doc,
      splitHref,
    );
    if (sectionFragments.length > 0) {
      sections[sectionId] = { id: sectionId, fragments: sectionFragments };
    }
  }

  // Attach the freshly computed fragments to live sections so the bake can see
  // them via createSectionsMap. hydrateBookNav on the same bookDoc (called
  // right after by readerStore) will re-clone these, so the shared-ref write
  // here is a temporary staging step.
  for (const section of bookSections) {
    section.fragments = sections[section.id]?.fragments;
  }
  bakeLocationsAndCfis(tocClone, bookSections, splitHref);

  if (enrichedNav) {
    sortTocItems(tocClone);
  }

  return { version: BOOK_NAV_VERSION, toc: tocClone, sections };
};

/**
 * Apply a cached BookNav onto a freshly opened BookDoc, replacing its TOC
 * with the cached (post-grouping) version and attaching per-section
 * fragments to the corresponding Section objects, then (re)derive
 * section/fragment locations and TOC item cfi+location. Pure; no I/O.
 */
export const hydrateBookNav = (bookDoc: BookDoc, bookNav: BookNav): void => {
  bookDoc.toc = cloneTocItems(bookNav.toc);
  const bookSections = bookDoc.sections ?? [];
  for (const section of bookSections) {
    const cached = bookNav.sections[section.id];
    if (cached?.fragments?.length) {
      section.fragments = cloneSectionFragments(cached.fragments);
    } else {
      section.fragments = undefined;
    }
  }
  bakeLocationsAndCfis(bookDoc.toc ?? [], bookSections, (h) => bookDoc.splitTOCHref(h));
};
