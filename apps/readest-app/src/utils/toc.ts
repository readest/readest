import { SectionItem, TOCItem, CFI, BookDoc } from '@/libs/document';

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
    const currentCfi = toc[mid]!.cfi || '';
    const comparison = CFI.compare(currentCfi, cfi);
    if (comparison === 0) {
      return toc[mid]!;
    } else if (comparison < 0) {
      result = toc[mid]!;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
};

export const updateToc = (bookDoc: BookDoc, items: TOCItem[], sections: SectionItem[]): void => {
  const sizes = sections.map((s) => (s.linear != 'no' && s.size > 0 ? s.size : 0));
  let cumulativeSize = 0;
  const cumulativeSizes = sizes.reduce((acc: number[], size) => {
    acc.push(cumulativeSize);
    cumulativeSize += size;
    return acc;
  }, []);
  const totalSize = cumulativeSizes[cumulativeSizes.length - 1] || 0;
  const sizePerLoc = 1500;
  sections.forEach((section, index) => {
    section.location = {
      current: Math.floor(cumulativeSizes[index]! / sizePerLoc),
      next: Math.floor((cumulativeSizes[index]! + sizes[index]!) / sizePerLoc),
      total: Math.floor(totalSize / sizePerLoc),
    };
  });

  const sectionsMap = sections.reduce((map: Record<string, SectionItem>, section) => {
    map[section.id] = section;
    return map;
  }, {});
  updateTocData(bookDoc, items, sectionsMap);
};

const updateTocData = (
  bookDoc: BookDoc,
  items: TOCItem[],
  sections: { [id: string]: SectionItem },
  index = 0,
): number => {
  items.forEach((item) => {
    item.id ??= index++;
    if (item.href) {
      const id = bookDoc.splitTOCHref(item.href)[0]!;
      const section = sections[id];
      if (section) {
        item.cfi = section.cfi;
        item.location = section.location;
      }
    }
    if (item.subitems) {
      index = updateTocData(bookDoc, item.subitems, sections, index);
    }
  });
  return index;
};
