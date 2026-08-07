import type { Transformer } from './types';

// `pre` and `code` are rendered with `white-space: pre-wrap !important` (see
// getPageLayoutStyles), so runs of spaces inside them are real indentation, not
// the fake spacing this transformer normalizes away. Skip those regions.
const PRESERVED_REGIONS = /<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const collapseWhitespace = (content: string) =>
  content
    // Replace &nbsp; but skip literal "&amp;nbsp;"
    .replace(/(&amp;)?&nbsp;/g, (match, amp) => (amp ? match : ' '))
    // Replace literal non-breaking space characters (U+00A0) with normal spaces
    .replace(/\u00A0/g, ' ')
    // Collapse consecutive spaces into one
    .replace(/ {2,}/g, ' ');

export const whitespaceTransformer: Transformer = {
  name: 'whitespace',

  transform: async (ctx) => {
    const viewSettings = ctx.viewSettings;
    if (!viewSettings.overrideLayout) return ctx.content;

    let cleaned = '';
    let lastIndex = 0;
    for (const match of ctx.content.matchAll(PRESERVED_REGIONS)) {
      const start = match.index!;
      cleaned += collapseWhitespace(ctx.content.slice(lastIndex, start)) + match[0];
      lastIndex = start + match[0].length;
    }
    return cleaned + collapseWhitespace(ctx.content.slice(lastIndex));
  },
};
