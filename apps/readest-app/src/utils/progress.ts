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
      .replace('{percent}', (((current + 1) / total) * 100).toFixed(fractionDigits));
  } else {
    return '';
  }
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
