import { localizeNumber } from './number';

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
