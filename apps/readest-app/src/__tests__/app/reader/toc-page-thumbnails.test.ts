import { describe, it, expect, vi } from 'vitest';
import type { TOCItem } from '@/libs/document';
import {
  computeTOCPageRanges,
  findActiveRowIndex,
  flattenTOC,
  getItemIdentifier,
  getThumbnailsPerRow,
} from '@/app/reader/components/sidebar/tocTree';
import {
  buildTOCDisplayItems,
  isPageThumbnailsItem,
  type TOCDisplayItem,
} from '@/app/reader/components/sidebar/TOCItem';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const item = (id: number, index: number, subitems?: TOCItem[]): TOCItem => ({
  id,
  label: `Item ${id}`,
  href: `"dest-${id}"`,
  index,
  subitems,
});

// Part 1 (p.2) > Chapter 1 (p.2), Chapter 2 (p.5); Part 2 (p.9) on a 12-page PDF.
const toc: TOCItem[] = [item(1, 2, [item(2, 2), item(3, 5)]), item(4, 9)];

const summarize = (rows: TOCDisplayItem[]) =>
  rows.map((row) =>
    isPageThumbnailsItem(row)
      ? `pages ${row.pages.join(',')} @${row.depth}`
      : 'item' in row
        ? `${row.item.label} @${row.depth}`
        : 'current',
  );

describe('computeTOCPageRanges', () => {
  it('gives each entry the pages up to where the next entry starts', () => {
    const ranges = computeTOCPageRanges(toc, 12);
    expect(ranges.get(toc[0]!.subitems![1]!)).toEqual({ start: 5, end: 9 });
    expect(ranges.get(toc[1]!)).toEqual({ start: 9, end: 12 });
  });

  // Matches the reader: a PDF relocate marks the first entry on a page active.
  it('lets the first entry starting on a page own it, so no page is listed twice', () => {
    const ranges = computeTOCPageRanges(toc, 12);
    expect(ranges.get(toc[0]!)).toEqual({ start: 2, end: 5 });
    expect(ranges.has(toc[0]!.subitems![0]!)).toBe(false);
  });

  it('orders by page, not outline position', () => {
    const [late, early] = [item(1, 6), item(2, 3)];
    const ranges = computeTOCPageRanges([late, early], 10);
    expect(ranges.get(late)).toEqual({ start: 6, end: 10 });
    expect(ranges.get(early)).toEqual({ start: 3, end: 6 });
  });

  it('skips entries without a resolvable page', () => {
    const broken = { ...item(1, 0), index: undefined } as unknown as TOCItem;
    expect(computeTOCPageRanges([broken, item(2, 4)], 8).size).toBe(1);
  });
});

describe('flattenTOC with page thumbnails', () => {
  const ranges = computeTOCPageRanges(toc, 12);

  it('marks entries that own pages as expandable', () => {
    const rows = flattenTOC(toc, new Set(), ranges);
    expect(rows.map((r) => 'item' in r && r.hasPages)).toEqual([true, true]);
  });

  it('shows an unfolded entry’s thumbnails, three per row, before its subitems', () => {
    const expanded = new Set([
      getItemIdentifier(toc[0]!),
      getItemIdentifier(toc[0]!.subitems![1]!),
    ]);
    expect(summarize(flattenTOC(toc, expanded, ranges))).toEqual([
      'Item 1 @0',
      'pages 2,3,4 @1',
      'Item 2 @1',
      'Item 3 @1',
      'pages 5,6,7 @2',
      'pages 8 @2',
      'Item 4 @0',
    ]);
  });

  it('still finds the pages after ids are assigned to the TOC in place', () => {
    const fresh = [{ label: 'Only', href: '"only"', index: 0 } as TOCItem];
    const freshRanges = computeTOCPageRanges(fresh, 3);
    fresh[0]!.id = 7;
    const rows = flattenTOC(fresh, new Set([getItemIdentifier(fresh[0]!)]), freshRanges);
    expect(summarize(rows)).toEqual(['Only @0', 'pages 0,1,2 @1']);
  });

  it('fits as many thumbnails per row as the TOC width allows', () => {
    const expanded = new Set([getItemIdentifier(toc[1]!)]);
    expect(summarize(flattenTOC(toc, expanded, ranges, 2))).toEqual([
      'Item 1 @0',
      'Item 4 @0',
      'pages 9,10 @1',
      'pages 11 @1',
    ]);
  });

  it('keeps folded entries’ thumbnails hidden', () => {
    expect(summarize(flattenTOC(toc, new Set(), ranges))).toEqual(['Item 1 @0', 'Item 4 @0']);
  });
});

describe('findActiveRowIndex', () => {
  const ranges = computeTOCPageRanges(toc, 12);
  const expanded = new Set([getItemIdentifier(toc[1]!)]);
  const href = toc[1]!.href;

  it('targets the thumbnail row holding the current page', () => {
    const rows = buildTOCDisplayItems(flattenTOC(toc, expanded, ranges), href, 11);
    expect(summarize(rows)[findActiveRowIndex(rows, href, 11)]).toBe('pages 9,10,11 @1');
  });

  it('falls back to the active entry when its thumbnails are folded', () => {
    const rows = buildTOCDisplayItems(flattenTOC(toc, new Set(), ranges), href, 11);
    expect(findActiveRowIndex(rows, href, 11)).toBe(1);
  });
});

describe('getThumbnailsPerRow', () => {
  it('scales the column count with the TOC width', () => {
    expect(getThumbnailsPerRow(200)).toBe(2);
    expect(getThumbnailsPerRow(240)).toBe(3);
    expect(getThumbnailsPerRow(320)).toBe(4);
  });

  it('keeps two to four thumbnails per row', () => {
    expect(getThumbnailsPerRow(60)).toBe(2);
    expect(getThumbnailsPerRow(800)).toBe(4);
  });

  it('falls back to three columns before the TOC is measured', () => {
    expect(getThumbnailsPerRow(0)).toBe(3);
  });
});
