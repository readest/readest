import { TOCItem } from '@/libs/document';
import { findParentPath } from '@/services/nav';

export const getItemIdentifier = (item: TOCItem) => {
  const href = item.href || '';
  return `toc-item-${item.id}-${href}`;
};

// Decide which TOC nodes to auto-expand. Only the ancestors of the current
// reading location are "necessary" — expanding just that path reveals where
// the reader is while leaving the rest of a deep, multi-volume hierarchy
// collapsed and easy to scan (issue #4059). When there's no resolvable reading
// position yet, keep everything collapsed, except a lone wrapping root
// container — otherwise the sidebar would show a single uninformative row.
export const computeExpandedSet = (toc: TOCItem[], href: string | undefined): Set<string> => {
  const parents = href ? findParentPath(toc, href).map(getItemIdentifier) : [];
  if (parents.length) return new Set(parents);
  if (toc.length === 1 && toc[0]?.subitems?.length) {
    return new Set([getItemIdentifier(toc[0])]);
  }
  return new Set();
};
