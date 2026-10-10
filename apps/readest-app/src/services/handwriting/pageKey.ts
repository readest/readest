/**
 * Ink is stored per page key.
 *
 * Fixed layout (PDF, CBZ, pre-paginated EPUB): `page:<section index>`. The
 * page is fixed artwork, so ink is normalized to the page itself.
 *
 * Reflowable EPUB: `sec:<section index>`. Each stroke carries its own anchor
 * (see anchor.ts), so it follows its text across pages and layout changes.
 */
export type ParsedPageKey = { kind: 'page' | 'section'; index: number };

export const fixedPageKey = (index: number) => `page:${index}`;
export const sectionPageKey = (index: number) => `sec:${index}`;

export const parsePageKey = (key: string): ParsedPageKey | null => {
  const match = /^(page|sec):(\d+)$/.exec(key);
  if (!match) return null;
  return { kind: match[1] === 'page' ? 'page' : 'section', index: Number(match[2]) };
};
