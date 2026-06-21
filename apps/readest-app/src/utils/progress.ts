import { localizeNumber } from './number';
import type { TOCItem } from '@/libs/document';

interface ChapterTickSource {
  getSectionFractions: () => number[];
  resolveNavigation: (href: string) => { index?: number } | null | undefined;
}

const flattenTOCHrefs = (items: TOCItem[]): string[] =>
  items.flatMap((item) => [
    ...(item.href ? [item.href] : []),
    ...(item.subitems?.length ? flattenTOCHrefs(item.subitems) : []),
  ]);

/**
 * Reading-fraction positions (0..1) of chapter boundaries for the sticky
 * progress bar's tick marks. Each TOC entry's href is resolved to its spine
 * section index, then mapped to that section's start fraction (the same
 * size-domain as the bar fill). Ticks at the book start/end are dropped and
 * duplicates collapsed, so multiple TOC entries inside one spine file yield a
 * single tick. The first and last remaining ticks are also dropped so they
 * never crowd the bar's rounded ends.
 */
export function getChapterTickFractions(
  view: ChapterTickSource | null | undefined,
  toc: TOCItem[] | null | undefined,
): number[] {
  if (!view || !toc?.length) return [];
  const sectionFractions = view.getSectionFractions();
  if (!sectionFractions?.length) return [];
  // sectionFractions = [0, ...interior boundaries..., 1]; section `i` starts at
  // sectionFractions[i]. Keep interior starts only (1 .. length-2).
  const lastIndex = sectionFractions.length - 1;
  const ticks = new Set<number>();
  for (const href of flattenTOCHrefs(toc)) {
    const index = view.resolveNavigation(href)?.index;
    if (typeof index === 'number' && index >= 1 && index < lastIndex) {
      ticks.add(sectionFractions[index]!);
    }
  }
  return [...ticks].sort((a, b) => a - b).slice(1, -1);
}

export function formatProgress(
  current: number | undefined,
  total: number | undefined,
  template: string,
  localize: boolean = false,
  language: string = 'en',
  fractionDigits: number = 1,
): string {
  if (current !== undefined && total !== undefined && total > 0 && current >= 0) {
    const currentStr = localize ? localizeNumber(current + 1, language, true) : String(current + 1);
    const totalStr = localize ? localizeNumber(total, language, true) : String(total);
    return template
      .replace('{current}', currentStr)
      .replace('{total}', totalStr)
      .replace(
        '{percent}',
        (((current + 1) / total) * 100).toFixed(
          current + 1 < total && total > 100 ? fractionDigits : 0,
        ),
      );
  } else {
    return '';
  }
}

export interface ReferencePageItem {
  label?: string;
  subitems?: ReferencePageItem[] | null;
}

export interface ReferencePageInfo {
  current: string;
  total: number;
}

const collectLabels = (items: ReferencePageItem[]): string[] =>
  items.flatMap((item) => [
    item.label?.trim() ?? '',
    ...(item.subitems?.length ? collectLabels(item.subitems) : []),
  ]);

const estimatePage = (fraction: number, total: number) =>
  Math.min(total, Math.max(1, Math.ceil(fraction * total)));

/**
 * Resolve the physical-book page info shown by the 'reference' progress style.
 * Prefers the book's own page list (EPUB page-list nav / NCX pageList); when
 * the book has none, maps the reading fraction linearly onto a user-entered
 * page count. Returns null when neither source is available.
 */
export function getReferencePageInfo({
  pageList,
  pageItem,
  fraction,
  referencePageCount,
}: {
  pageList?: ReferencePageItem[] | null;
  pageItem?: ReferencePageItem | null;
  fraction: number;
  referencePageCount?: number;
}): ReferencePageInfo | null {
  if (pageList?.length) {
    const labels = collectLabels(pageList).filter(Boolean);
    // The last entries may be non-numeric (e.g. a roman-numeral index page),
    // so the total is the highest numeric label, not the last one.
    const numericLabels = labels.filter((label) => /^\d+$/.test(label));
    const total = numericLabels.length ? Math.max(...numericLabels.map(Number)) : labels.length;
    const current = pageItem?.label?.trim() || String(estimatePage(fraction, total));
    return { current, total };
  }
  if (referencePageCount && referencePageCount > 0) {
    return {
      current: String(estimatePage(fraction, referencePageCount)),
      total: referencePageCount,
    };
  }
  return null;
}

export function formatNumber(
  number: number | undefined,
  localize: boolean = false,
  language: string = 'en',
): string {
  if (number === undefined || number < 0) {
    return '';
  }
  return localize ? localizeNumber(number, language) : String(number);
}
