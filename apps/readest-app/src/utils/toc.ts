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

export const updateToc = async (
  bookDoc: BookDoc,
  sortedTOC: boolean,
  convertChineseVariant: ConvertChineseVariant,
) => {
  const items = bookDoc?.toc || [];
  if (!items.length) return;

  if (convertChineseVariant && convertChineseVariant !== 'none') {
    await initSimpleCC();
    convertTocLabels(items, convertChineseVariant);
  }

  const sections = bookDoc?.sections || [];
  if (!sections.length) return;

  const sizes = sections.map((s) => (s.linear != 'no' && s.size > 0 ? s.size : 0));
  let cumulativeSize = 0;
  const cumulativeSizes = sizes.reduce((acc: number[], size) => {
    acc.push(cumulativeSize);
    cumulativeSize += size;
    return acc;
  }, []);
  const totalSize = cumulativeSizes[cumulativeSizes.length - 1] || 0;
  const totalLocations = Math.floor(totalSize / SIZE_PER_LOC);
  sections.forEach((section, index) => {
    section.location = {
      current: Math.floor(cumulativeSizes[index]! / SIZE_PER_LOC),
      next: Math.floor((cumulativeSizes[index]! + sizes[index]!) / SIZE_PER_LOC),
      total: totalLocations,
    };
    const subitems = section.subitems || [];
    subitems.forEach((subitem, subitemIndex) => {
      subitem.location = {
        current: Math.floor(
          (cumulativeSizes[index]! +
            subitems.slice(0, subitemIndex).reduce((sum, t) => sum + (t.size || 0), 0)) /
            SIZE_PER_LOC,
        ),
        next: Math.floor(
          (cumulativeSizes[index]! +
            subitems.slice(0, subitemIndex + 1).reduce((sum, t) => sum + (t.size || 0), 0)) /
            SIZE_PER_LOC,
        ),
        total: totalLocations,
      };
    });
  });

  const sectionsMap = sections.reduce((map: Record<string, SectionItem>, section) => {
    map[section.id] = section;
    section.subitems?.forEach((subitem) => {
      if (subitem.href) {
        map[subitem.href] = subitem;
      }
    });
    return map;
  }, {});

  updateTocData(bookDoc, items, sections, sectionsMap);

  if (sortedTOC) {
    sortTocItems(items);
  }
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

const updateTocData = (
  bookDoc: BookDoc,
  items: TOCItem[],
  sections: SectionItem[],
  sectionsMap: { [id: string]: SectionItem },
  index = 0,
): number => {
  items.forEach((item) => {
    item.id ??= index++;
    if (item.href) {
      const id = bookDoc.splitTOCHref(item.href)[0]!;
      const section = sectionsMap[item.href] || sectionsMap[id];
      if (section) {
        item.cfi = section.cfi;
        if (id === item.href || items.length <= sections.length || item.href === section.href) {
          item.location = section.location;
        }
      }
    }
    if (item.subitems) {
      index = updateTocData(bookDoc, item.subitems, sections, sectionsMap, index);
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
