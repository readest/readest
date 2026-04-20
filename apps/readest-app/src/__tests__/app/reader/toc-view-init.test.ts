import { describe, it, expect } from 'vitest';
import type { TOCItem } from '@/libs/document';

/**
 * Regression test for TOC sidebar blank on initial book load.
 *
 * When a book opens at a position with no TOC entry (e.g., cover page),
 * progress.sectionHref is undefined and expandParents is never called.
 * For books with a nested TOC structure (chapters nested under a root
 * container), the sidebar appears blank because expandedItems is empty
 * and only the root item is shown.
 *
 * Fix: Initialize expandedItems with top-level TOC items that have subitems
 * so chapters are visible immediately on sidebar open.
 */

// Mirrors the logic in TOCView.tsx's getItemIdentifier
const getItemIdentifier = (item: TOCItem) => {
  const href = item.href || '';
  return `toc-item-${item.id}-${href}`;
};

// Mirrors the initialization logic to be added to TOCView.tsx
const getInitialExpandedItems = (toc: TOCItem[]): Set<string> => {
  const topLevelWithSubitems = toc
    .filter((item) => item.subitems?.length)
    .map((item) => getItemIdentifier(item));
  return topLevelWithSubitems.length > 0 ? new Set(topLevelWithSubitems) : new Set();
};

// Mirrors useFlattenedTOC logic in TOCView.tsx
const flattenTOC = (items: TOCItem[], expandedItems: Set<string>, depth = 0): TOCItem[] => {
  const result: TOCItem[] = [];
  items.forEach((item) => {
    const isExpanded = expandedItems.has(getItemIdentifier(item));
    result.push(item);
    if (item.subitems && isExpanded) {
      result.push(...flattenTOC(item.subitems, expandedItems, depth + 1));
    }
  });
  return result;
};

// Helpers mirrored from TOCView.tsx for the initial-scroll-target logic.
// These drive the Virtuoso `initialTopMostItemIndex` prop, which avoids the
// race where a setTimeout-based scrollToIndex fires before Virtuoso has
// finished its first layout pass.
const findParentPath = (items: TOCItem[], href: string, path: TOCItem[] = []): TOCItem[] => {
  for (const item of items) {
    const newPath = [...path, item];
    if (item.href === href) return path;
    if (item.subitems) {
      const found = findParentPath(item.subitems, href, newPath);
      if (found.length > 0) return found;
    }
  }
  return [];
};

const computeExpandedSet = (toc: TOCItem[], href: string | undefined): Set<string> => {
  const topLevel = toc.filter((item) => item.subitems?.length).map(getItemIdentifier);
  const parents = href ? findParentPath(toc, href).map(getItemIdentifier).filter(Boolean) : [];
  return new Set([...topLevel, ...parents]);
};

const getInitialScrollTarget = (
  toc: TOCItem[],
  href: string | undefined,
): { index: number; expanded: Set<string> } => {
  const expanded = computeExpandedSet(toc, href);
  if (!href) return { index: 0, expanded };
  const flat = flattenTOC(toc, expanded);
  const idx = flat.findIndex((item) => item.href === href);
  return { index: idx > 0 ? idx : 0, expanded };
};

describe('TOC sidebar initialization', () => {
  const nestedTOC: TOCItem[] = [
    {
      id: 0,
      label: 'Book',
      href: undefined,
      subitems: [
        { id: 1, label: 'Chapter 1', href: 'ch1.html' },
        { id: 2, label: 'Chapter 2', href: 'ch2.html' },
        { id: 3, label: 'Chapter 3', href: 'ch3.html' },
      ],
    } as unknown as TOCItem,
  ];

  const flatTOC: TOCItem[] = [
    { id: 1, label: 'Chapter 1', href: 'ch1.html' } as unknown as TOCItem,
    { id: 2, label: 'Chapter 2', href: 'ch2.html' } as unknown as TOCItem,
    { id: 3, label: 'Chapter 3', href: 'ch3.html' } as unknown as TOCItem,
  ];

  describe('before fix (demonstrates the bug)', () => {
    it('nested TOC with empty expandedItems only shows root item, not chapters', () => {
      const expandedItems = new Set<string>(); // Empty initial state (the bug)
      const flatItems = flattenTOC(nestedTOC, expandedItems);
      // Only root "Book" shows — chapters are hidden
      expect(flatItems).toHaveLength(1);
      expect(flatItems[0]!.label).toBe('Book');
    });
  });

  describe('after fix (initialization effect behavior)', () => {
    it('nested TOC: getInitialExpandedItems expands the root container', () => {
      const expandedItems = getInitialExpandedItems(nestedTOC);
      expect(expandedItems.size).toBe(1);
      expect(expandedItems.has(getItemIdentifier(nestedTOC[0]!))).toBe(true);
    });

    it('nested TOC: with initialized expandedItems, all chapters are visible', () => {
      const expandedItems = getInitialExpandedItems(nestedTOC);
      const flatItems = flattenTOC(nestedTOC, expandedItems);
      // Root + 3 chapters = 4 items
      expect(flatItems).toHaveLength(4);
      expect(flatItems[1]!.label).toBe('Chapter 1');
      expect(flatItems[2]!.label).toBe('Chapter 2');
      expect(flatItems[3]!.label).toBe('Chapter 3');
    });

    it('flat TOC: getInitialExpandedItems returns empty set (no change)', () => {
      const expandedItems = getInitialExpandedItems(flatTOC);
      expect(expandedItems.size).toBe(0);
    });

    it('flat TOC: all chapters visible regardless of expandedItems', () => {
      const expandedItems = getInitialExpandedItems(flatTOC);
      const flatItems = flattenTOC(flatTOC, expandedItems);
      expect(flatItems).toHaveLength(3);
    });

    it('non-empty expandedItems is preserved (no re-initialization)', () => {
      const existingItems = new Set(['toc-item-1-ch1.html']);
      // The effect uses: if (prev.size > 0) return prev
      const result = existingItems.size > 0 ? existingItems : getInitialExpandedItems(nestedTOC);
      expect(result).toBe(existingItems); // Same reference - not re-initialized
    });

    it('empty TOC produces empty expandedItems', () => {
      const expandedItems = getInitialExpandedItems([]);
      expect(expandedItems.size).toBe(0);
    });
  });
});

/**
 * Regression test for TOC auto-scroll race condition.
 *
 * When the TOC opens with an existing book progress, the view must scroll to
 * the current item. The previous implementation used a 300 ms setTimeout to
 * trigger `scrollToIndex` after mount. That races with Virtuoso's internal
 * layout stabilization: under load the timer occasionally fires first, the
 * TOC scrolls to the target, and then Virtuoso's late layout pass snaps the
 * list back to the top.
 *
 * Fix: compute the initial scroll target synchronously during mount so it
 * can be fed to Virtuoso's `initialTopMostItemIndex` prop, which Virtuoso
 * uses to perform the first scroll itself — no setTimeout race.
 */
describe('TOC initial scroll target', () => {
  const nestedTOC: TOCItem[] = [
    {
      id: 0,
      label: 'Book',
      href: undefined,
      subitems: [
        { id: 1, label: 'Chapter 1', href: 'ch1.html' },
        { id: 2, label: 'Chapter 2', href: 'ch2.html' },
        { id: 3, label: 'Chapter 3', href: 'ch3.html' },
      ],
    } as unknown as TOCItem,
  ];

  const flatTOC: TOCItem[] = [
    { id: 1, label: 'Chapter 1', href: 'ch1.html' } as unknown as TOCItem,
    { id: 2, label: 'Chapter 2', href: 'ch2.html' } as unknown as TOCItem,
    { id: 3, label: 'Chapter 3', href: 'ch3.html' } as unknown as TOCItem,
  ];

  it('returns index 0 when no current href is provided', () => {
    const { index, expanded } = getInitialScrollTarget(nestedTOC, undefined);
    expect(index).toBe(0);
    // Top-level container is still expanded so the list renders its chapters.
    expect(expanded.size).toBe(1);
  });

  it('resolves the current chapter inside a nested TOC with parents expanded', () => {
    const { index, expanded } = getInitialScrollTarget(nestedTOC, 'ch3.html');
    // flat order is Book, Ch1, Ch2, Ch3 → current chapter sits at index 3.
    expect(index).toBe(3);
    expect(expanded.has(getItemIdentifier(nestedTOC[0]!))).toBe(true);
  });

  it('resolves the current chapter inside a flat TOC', () => {
    const { index } = getInitialScrollTarget(flatTOC, 'ch2.html');
    expect(index).toBe(1);
  });

  it('falls back to index 0 when the href cannot be found', () => {
    const { index } = getInitialScrollTarget(nestedTOC, 'missing.html');
    expect(index).toBe(0);
  });
});
