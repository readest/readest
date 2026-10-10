import * as CFI from 'foliate-js/epubcfi.js';
import { createCfiLocationMatcher } from '@/utils/cfi';

/**
 * Ink is stored per page key.
 *
 * Fixed layout (PDF, CBZ, pre-paginated EPUB): `page:<section index>`. Each
 * section is one page, so the index is exact and stable.
 *
 * Reflowable EPUB: `cfi:<cfi>`, the start of the page the ink was drawn on.
 * Reflowed pages have no fixed identity, so a page shows every stored anchor
 * that falls inside its visible range. After a font or margin change the ink
 * follows the text it was drawn next to, onto whichever page now shows it.
 */
export type ParsedPageKey = { kind: 'page'; index: number } | { kind: 'cfi'; cfi: string };

export const fixedPageKey = (index: number) => `page:${index}`;

/**
 * Keys of the ink a reflowed page shows. The first takes new strokes: the
 * anchor at the page start, else the first anchor in range, else a new anchor
 * at the page start. The rest are other anchors a reflow brought onto the page.
 */
export const reflowPageKeys = (location: string, storedKeys: Iterable<string>): string[] => {
  const start = `cfi:${CFI.collapse(location)}`;
  const matches = createCfiLocationMatcher(location);
  const inRange = [...storedKeys].filter(
    (key) => key === start || (key.startsWith('cfi:') && matches(key.slice(4))),
  );
  const primary = inRange.includes(start) ? start : (inRange[0] ?? start);
  return [primary, ...inRange.filter((key) => key !== primary)];
};

export const parsePageKey = (key: string): ParsedPageKey | null => {
  if (key.startsWith('page:')) return { kind: 'page', index: Number(key.slice(5)) };
  if (key.startsWith('cfi:')) return { kind: 'cfi', cfi: key.slice(4) };
  return null;
};
