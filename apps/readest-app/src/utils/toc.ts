import { ConvertChineseVariant } from '@/types/book';
import { SectionItem, TOCItem, CFI, BookDoc } from '@/libs/document';
import { initSimpleCC, runSimpleCC } from '@/utils/simplecc';
import { SIZE_PER_LOC } from '@/services/constants';

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

// Helper: Process subitems recursively to assign locations
const processSubitemLocations = (
  subitems: SectionItem[],
  parentByteOffset: number,
  parentLocation: { current: number; next: number; total: number },
  totalLocations: number,
) => {
  let currentByteOffset = parentByteOffset;

  subitems.forEach((subitem, index) => {
    const nextSubitem = index < subitems.length - 1 ? subitems[index + 1] : null;

    currentByteOffset += subitem.size || 0;
    const nextByteOffset = nextSubitem
      ? currentByteOffset + (nextSubitem.size || 0)
      : parentLocation.next * SIZE_PER_LOC;

    subitem.location = {
      current: Math.floor(currentByteOffset / SIZE_PER_LOC),
      next: Math.floor(nextByteOffset / SIZE_PER_LOC),
      total: totalLocations,
    };

    if (subitem.subitems?.length) {
      processSubitemLocations(
        subitem.subitems,
        currentByteOffset,
        subitem.location,
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

    if (section.subitems?.length) {
      processSubitemLocations(section.subitems, baseOffset, section.location, totalLocations);
    }
  });
};

// Helper: Recursively add subitems to sections map
const addSubitemsToMap = (subitems: SectionItem[], map: Record<string, SectionItem>) => {
  for (const subitem of subitems) {
    if (subitem.href) map[subitem.href] = subitem;
    if (subitem.subitems?.length) addSubitemsToMap(subitem.subitems, map);
  }
};

// Helper: Create sections lookup map including all subitems
type Href = string;
type SectionsMap = Record<Href, SectionItem>;
const createSectionsMap = (sections: SectionItem[]) => {
  const map: SectionsMap = {};

  for (const section of sections) {
    map[section.id] = section;
    if (section.subitems?.length) addSubitemsToMap(section.subitems, map);
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

  // Step 3: Update locations to sections and subitems
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
      const section = sectionsMap[item.href] || sectionsMap[id];
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
