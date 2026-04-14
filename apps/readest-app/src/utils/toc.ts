import { ConvertChineseVariant } from '@/types/book';
import { SectionFragment, SectionItem, TOCItem, CFI, BookDoc } from '@/libs/document';
import { initSimpleCC, runSimpleCC } from '@/utils/simplecc';
import { SIZE_PER_LOC } from '@/services/constants';

// -----------------------------------------------------------------------------
// Book navigation artifact (persisted to Books/{hash}/nav.json).
// Bump BOOK_NAV_VERSION whenever computeBookNav output semantics change
// (TOC grouping heuristic, fragment CFI/size math, hierarchy rules).
// v2: fragment CFIs are derived from the section DOM via CFI.joinIndir instead
//     of inherited from the TOC item (ported from foliate-js 317051e).
// -----------------------------------------------------------------------------

export const BOOK_NAV_VERSION = 2;

export type { SectionFragment };

export interface BookNavSection {
  id: string;
  fragments: SectionFragment[];
}

export interface BookNav {
  version: number;
  toc: TOCItem[];
  sections: Record<string, BookNavSection>;
}

export const findParentPath = (toc: TOCItem[], href: string): TOCItem[] => {
  for (const item of toc) {
    if (item.href === href) {
      return [item];
    }
    if (item.subitems) {
      const path = findParentPath(item.subitems, href);
      if (path.length) {
        return [item, ...path];
      }
    }
  }
  return [];
};

export const findTocItemBS = (toc: TOCItem[], cfi: string): TOCItem | null => {
  if (!cfi) return null;
  let left = 0;
  let right = toc.length - 1;
  let result: TOCItem | null = null;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const item = toc[mid]!;
    const currentCfi = toc[mid]!.cfi || '';
    const comparison = CFI.compare(currentCfi, cfi);
    if (comparison === 0) {
      return findInSubitems(item, cfi) ?? item;
    } else if (comparison < 0) {
      result = findInSubitems(item, cfi) ?? item;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
};

const findInSubitems = (item: TOCItem, cfi: string): TOCItem | null => {
  if (!item.subitems?.length) return null;
  return findTocItemBS(item.subitems, cfi);
};

// Helper: Calculate cumulative sizes for sections
const calculateCumulativeSizes = (sections: SectionItem[]): number[] => {
  const sizes = sections.map((s) => (s.linear !== 'no' && s.size > 0 ? s.size : 0));
  let cumulative = 0;
  return sizes.reduce((acc: number[], size) => {
    acc.push(cumulative);
    cumulative += size;
    return acc;
  }, []);
};

// Helper: Process fragments recursively to assign locations
const processFragmentLocations = (
  fragments: SectionFragment[],
  parentByteOffset: number,
  parentLocation: { current: number; next: number; total: number },
  totalLocations: number,
) => {
  let currentByteOffset = parentByteOffset;

  fragments.forEach((fragment, index) => {
    const nextFragment = index < fragments.length - 1 ? fragments[index + 1] : null;

    currentByteOffset += fragment.size || 0;
    const nextByteOffset = nextFragment
      ? currentByteOffset + (nextFragment.size || 0)
      : parentLocation.next * SIZE_PER_LOC;

    fragment.location = {
      current: Math.floor(currentByteOffset / SIZE_PER_LOC),
      next: Math.floor(nextByteOffset / SIZE_PER_LOC),
      total: totalLocations,
    };

    if (fragment.fragments?.length) {
      processFragmentLocations(
        fragment.fragments,
        currentByteOffset,
        fragment.location,
        totalLocations,
      );
    }
  });
};

const updateSectionLocations = (
  sections: SectionItem[],
  cumulativeSizes: number[],
  sizes: number[],
  totalLocations: number,
) => {
  sections.forEach((section, index) => {
    const baseOffset = cumulativeSizes[index]!;
    const sectionSize = sizes[index]!;

    section.location = {
      current: Math.floor(baseOffset / SIZE_PER_LOC),
      next: Math.floor((baseOffset + sectionSize) / SIZE_PER_LOC),
      total: totalLocations,
    };

    if (section.fragments?.length) {
      processFragmentLocations(section.fragments, baseOffset, section.location, totalLocations);
    }
  });
};

// Narrow type that both SectionItem and SectionFragment satisfy — the fields
// read by updateTocLocation when mapping TOC items to their section/fragment.
interface LocatedEntry {
  id: string;
  href?: string;
  cfi: string;
  location?: SectionFragment['location'];
}

// Helper: Recursively add fragments to sections map
const addFragmentsToMap = (fragments: SectionFragment[], map: Record<string, LocatedEntry>) => {
  for (const fragment of fragments) {
    if (fragment.href) map[fragment.href] = fragment;
    if (fragment.fragments?.length) addFragmentsToMap(fragment.fragments, map);
  }
};

// Helper: Create sections lookup map including all fragments
type Href = string;
type SectionsMap = Record<Href, LocatedEntry>;
const createSectionsMap = (sections: SectionItem[]) => {
  const map: SectionsMap = {};

  for (const section of sections) {
    map[section.id] = section;
    if (section.fragments?.length) addFragmentsToMap(section.fragments, map);
  }

  return map;
};

// Main: Update TOC with section locations and metadata
export const updateToc = async (
  bookDoc: BookDoc,
  sortedTOC: boolean,
  convertChineseVariant: ConvertChineseVariant,
) => {
  if (bookDoc.rendition?.layout === 'pre-paginated') return;

  const items = bookDoc?.toc || [];
  const sections = bookDoc?.sections || [];
  if (!items.length || !sections.length) return;

  // Step 1: Apply Chinese variant conversion if needed
  if (convertChineseVariant && convertChineseVariant !== 'none') {
    await initSimpleCC();
    convertTocLabels(items, convertChineseVariant);
  }

  // Step 2: Calculate section sizes and locations
  const sizes = sections.map((s) => (s.linear !== 'no' && s.size > 0 ? s.size : 0));
  const cumulativeSizes = calculateCumulativeSizes(sections);
  const totalSize = cumulativeSizes[cumulativeSizes.length - 1]! + sizes[sizes.length - 1]!;
  const totalLocations = Math.floor(totalSize / SIZE_PER_LOC);

  // Step 3: Update locations to sections and fragments
  updateSectionLocations(sections, cumulativeSizes, sizes, totalLocations);

  // Step 4: Create sections map and update TOC locations
  const sectionsMap = createSectionsMap(sections);
  updateTocLocation(bookDoc, items, sections, sectionsMap);

  // Step 5: Sort TOC if requested
  if (sortedTOC) sortTocItems(items);
};

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

const updateTocLocation = (
  bookDoc: BookDoc,
  items: TOCItem[],
  sections: SectionItem[],
  sectionsMap: SectionsMap,
  index = 0,
): number => {
  items.forEach((item) => {
    item.id ??= index++;
    if (item.href) {
      const id = bookDoc.splitTOCHref(item.href)[0]!;
      const exactMatch = sectionsMap[item.href];
      const baseMatch = sectionsMap[id];
      const section = (exactMatch?.cfi ? exactMatch : null) || baseMatch || exactMatch;
      if (section) {
        item.cfi = section.cfi;
        if (
          id === item.href ||
          items.length <= sections.length ||
          item.href === section.href ||
          item.href === section.id
        ) {
          item.location = section.location;
        }
      }
    }
    if (item.subitems) {
      index = updateTocLocation(bookDoc, item.subitems, sections, sectionsMap, index);
    }
  });
  return index;
};

const sortTocItems = (items: TOCItem[]): void => {
  items.sort((a, b) => {
    if (a.location && b.location) {
      return a.location.current - b.location.current;
    }
    return 0;
  });
};

// -----------------------------------------------------------------------------
// computeBookNav / hydrateBookNav
// -----------------------------------------------------------------------------

const cloneTocItems = (items: TOCItem[]): TOCItem[] =>
  items.map((item) => ({
    ...item,
    subitems: item.subitems ? cloneTocItems(item.subitems) : undefined,
  }));

// Ported from foliate-js: restructure TOC so that fragment-linked subitems under
// the same section are regrouped under a natural parent when one exists.
const groupTocSubitems = (bookDoc: BookDoc, items: TOCItem[]): void => {
  const splitHref = (href: string) => bookDoc.splitTOCHref(href);

  const groupBySection = (subitems: TOCItem[]) => {
    const grouped = new Map<string, TOCItem[]>();
    for (const subitem of subitems) {
      const [sectionId] = splitHref(subitem.href) as [string | undefined];
      const key = sectionId ?? '';
      const bucket = grouped.get(key) ?? [];
      bucket.push(subitem);
      grouped.set(key, bucket);
    }
    return grouped;
  };

  const separateParentAndFragments = (sectionId: string, subitems: TOCItem[]) => {
    let parent: TOCItem | null = null;
    const fragments: TOCItem[] = [];
    for (const subitem of subitems) {
      const [, fragmentId] = splitHref(subitem.href) as [string | undefined, string | undefined];
      if (!fragmentId || subitem.href === sectionId) {
        parent = subitem;
      } else {
        fragments.push(subitem);
      }
    }
    return { parent, fragments };
  };

  for (const item of items) {
    if (!item.subitems?.length) continue;

    const groupedBySection = groupBySection(item.subitems);
    if (groupedBySection.size <= 3) continue;

    const newSubitems: TOCItem[] = [];
    for (const [sectionId, subitems] of groupedBySection.entries()) {
      if (item.href === sectionId) {
        newSubitems.push(...subitems);
        continue;
      }
      if (subitems.length === 1) {
        newSubitems.push(subitems[0]!);
      } else {
        const { parent, fragments } = separateParentAndFragments(sectionId, subitems);
        if (parent) {
          parent.subitems = fragments.length > 0 ? fragments : parent.subitems;
          newSubitems.push(parent);
        } else {
          newSubitems.push(...subitems);
        }
      }
    }
    item.subitems = newSubitems;
  }
};

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

const calculateFragmentSize = (
  content: string,
  fragmentId: string | undefined,
  prevFragmentId: string | undefined,
): number => {
  const endPos = findFragmentPosition(content, fragmentId);
  if (endPos < 0) return 0;
  const startPos = prevFragmentId ? findFragmentPosition(content, prevFragmentId) : 0;
  const validStartPos = Math.max(0, startPos);
  if (endPos < validStartPos) return 0;
  return new Blob([content.substring(validStartPos, endPos)]).size;
};

const collectAllTocItems = (items: TOCItem[]): TOCItem[] => {
  const out: TOCItem[] = [];
  const walk = (xs: TOCItem[]) => {
    for (const x of xs) {
      out.push(x);
      if (x.subitems?.length) walk(x.subitems);
    }
  };
  walk(items);
  return out;
};

interface SectionGroup {
  base: TOCItem | null;
  fragments: TOCItem[];
}

const groupItemsBySection = (bookDoc: BookDoc, items: TOCItem[]): Map<string, SectionGroup> => {
  const groups = new Map<string, SectionGroup>();
  for (const item of items) {
    if (!item.href) continue;
    const [sectionId, fragmentId] = bookDoc.splitTOCHref(item.href) as [
      string | undefined,
      string | undefined,
    ];
    if (!sectionId) continue;
    let group = groups.get(sectionId);
    if (!group) {
      group = { base: null, fragments: [] };
      groups.set(sectionId, group);
    }
    const isBase = !fragmentId || item.href === sectionId;
    if (isBase) group.base = item;
    else group.fragments.push(item);
  }
  return groups;
};

const getHTMLFragmentElement = (doc: Document, id: string | undefined): Element | null => {
  if (!id) return null;
  return doc.getElementById(id) ?? doc.querySelector(`[name="${CSS.escape(id)}"]`);
};

type CFIModule = {
  joinIndir: (...xs: string[]) => string;
  fromElements: (elements: Element[]) => string[];
};

const buildFragmentCfi = (section: SectionItem, element: Element | null): string => {
  const cfiLib = CFI as unknown as CFIModule;
  const rel = element ? (cfiLib.fromElements([element])[0] ?? '') : '';
  return cfiLib.joinIndir(section.cfi, rel);
};

const buildSectionFragments = (
  section: SectionItem,
  fragments: TOCItem[],
  base: TOCItem | null,
  content: string,
  doc: Document,
  splitHref: (href: string) => Array<string | number>,
): SectionFragment[] => {
  const out: SectionFragment[] = [];
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
    const size = calculateFragmentSize(content, fragmentId, prevFragmentId);

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

  return { version: BOOK_NAV_VERSION, toc: tocClone, sections };
};

const cloneSectionFragments = (fragments: SectionFragment[]): SectionFragment[] =>
  fragments.map((f) => ({
    id: f.id,
    href: f.href,
    cfi: f.cfi,
    size: f.size,
    linear: f.linear,
    fragments: f.fragments ? cloneSectionFragments(f.fragments) : undefined,
  }));

/**
 * Apply a cached BookNav onto a freshly opened BookDoc, replacing its TOC
 * with the cached (post-grouping) version and attaching per-section
 * fragments to the corresponding Section objects. No I/O.
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
};
