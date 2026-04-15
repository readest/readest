import { BookDoc, SectionFragment, TOCItem } from '@/libs/document';

export const cloneTocItems = (items: TOCItem[]): TOCItem[] =>
  items.map((item) => ({
    ...item,
    subitems: item.subitems ? cloneTocItems(item.subitems) : undefined,
  }));

export const cloneSectionFragments = (fragments: SectionFragment[]): SectionFragment[] =>
  fragments.map((f) => ({
    id: f.id,
    href: f.href,
    cfi: f.cfi,
    size: f.size,
    linear: f.linear,
    fragments: f.fragments ? cloneSectionFragments(f.fragments) : undefined,
  }));

export const collectAllTocItems = (items: TOCItem[]): TOCItem[] => {
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

export interface SectionGroup {
  base: TOCItem | null;
  fragments: TOCItem[];
}

export const groupItemsBySection = (
  bookDoc: BookDoc,
  items: TOCItem[],
): Map<string, SectionGroup> => {
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

// Ported from foliate-js: restructure TOC so that fragment-linked subitems under
// the same section are regrouped under a natural parent when one exists.
export const groupTocSubitems = (bookDoc: BookDoc, items: TOCItem[]): void => {
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
