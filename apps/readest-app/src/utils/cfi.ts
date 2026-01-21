import * as CFI from 'foliate-js/epubcfi.js';

export function isCfiInLocation(cfi: string, location: string | null | undefined): boolean {
  if (!location) return false;

  const start = CFI.collapse(location);
  const end = CFI.collapse(location, true);

  return CFI.compare(cfi, start) >= 0 && CFI.compare(cfi, end) <= 0;
}
