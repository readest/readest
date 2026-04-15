import { SectionFragment, SectionItem, TOCItem } from '@/libs/document';
import { SIZE_PER_LOC } from '@/services/constants';

export type SplitTOCHref = (href: string) => Array<string | number>;

const calculateCumulativeSizes = (sections: SectionItem[]): number[] => {
  const sizes = sections.map((s) => (s.linear !== 'no' && s.size > 0 ? s.size : 0));
  let cumulative = 0;
  return sizes.reduce((acc: number[], size) => {
    acc.push(cumulative);
    cumulative += size;
    return acc;
  }, []);
};

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

type SectionsMap = Record<string, LocatedEntry>;

const addFragmentsToMap = (fragments: SectionFragment[], map: SectionsMap) => {
  for (const fragment of fragments) {
    if (fragment.href) map[fragment.href] = fragment;
    if (fragment.fragments?.length) addFragmentsToMap(fragment.fragments, map);
  }
};

const createSectionsMap = (sections: SectionItem[]): SectionsMap => {
  const map: SectionsMap = {};
  for (const section of sections) {
    map[section.id] = section;
    if (section.fragments?.length) addFragmentsToMap(section.fragments, map);
  }
  return map;
};

const updateTocLocation = (
  splitTOCHref: SplitTOCHref,
  items: TOCItem[],
  sections: SectionItem[],
  sectionsMap: SectionsMap,
  index = 0,
): number => {
  items.forEach((item) => {
    item.id ??= index++;
    if (item.href) {
      const id = splitTOCHref(item.href)[0]!;
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
      index = updateTocLocation(splitTOCHref, item.subitems, sections, sectionsMap, index);
    }
  });
  return index;
};

// Pure: compute + write section/fragment locations and TOC item cfi+location.
// Callers are responsible for passing sections that already have any applicable
// fragments attached (hydrateBookNav does this before calling). No I/O.
export const bakeLocationsAndCfis = (
  items: TOCItem[],
  sections: SectionItem[],
  splitTOCHref: SplitTOCHref,
) => {
  if (!items.length || !sections.length) return;

  const sizes = sections.map((s) => (s.linear !== 'no' && s.size > 0 ? s.size : 0));
  const cumulativeSizes = calculateCumulativeSizes(sections);
  const totalSize = cumulativeSizes[cumulativeSizes.length - 1]! + sizes[sizes.length - 1]!;
  const totalLocations = Math.floor(totalSize / SIZE_PER_LOC);

  updateSectionLocations(sections, cumulativeSizes, sizes, totalLocations);
  const sectionsMap = createSectionsMap(sections);
  updateTocLocation(splitTOCHref, items, sections, sectionsMap);
};

export const sortTocItems = (items: TOCItem[]): void => {
  items.sort((a, b) => {
    if (a.location && b.location) {
      return a.location.current - b.location.current;
    }
    return 0;
  });
};
