import * as CFI from 'foliate-js/epubcfi.js';
import { createCfiLocationMatcher } from '@/utils/cfi';

/**
 * Ink is stored per page key.
 *
 * Fixed layout (PDF, CBZ, pre-paginated EPUB): `page:<section index>`. Each
 * section is one page, so the index is exact and stable.
 *
 * Reflowable EPUB: `cfi:<cfi>`, the start of the page the ink was drawn on.
 * Reflowed pages have no fixed identity, so a page reuses any stored anchor
 * that falls inside its visible range. After a font or margin change the ink
 * follows the text it was drawn next to, onto whichever page now shows it.
 */
export type ParsedPageKey = { kind: 'page'; index: number } | { kind: 'cfi'; cfi: string };

export const fixedPageKey = (index: number) => `page:${index}`;

export const reflowPageKey = (location: string, storedKeys: Iterable<string>): string => {
  const start = `cfi:${CFI.collapse(location)}`;
  const matches = createCfiLocationMatcher(location);
  let anchored: string | null = null;
  for (const key of storedKeys) {
    if (key === start) return key;
    if (!anchored && key.startsWith('cfi:') && matches(key.slice(4))) anchored = key;
  }
  return anchored ?? start;
};

export const parsePageKey = (key: string): ParsedPageKey | null => {
  if (key.startsWith('page:')) return { kind: 'page', index: Number(key.slice(5)) };
  if (key.startsWith('cfi:')) return { kind: 'cfi', cfi: key.slice(4) };
  return null;
};
