import type { Transformer } from './types';

export const whitespaceTransformer: Transformer = {
  name: 'whitespace',

  transform: async (ctx) => {
    const viewSettings = ctx.viewSettings;
    if (viewSettings.overrideLayout) {
      const cleaned = ctx.content
        // Replace &nbsp; but skip literal "&amp;nbsp;"
        .replace(/(&amp;)?&nbsp;/g, (match, amp) => (amp ? match : ' '))
        // Replace literal non-breaking space characters (U+00A0) with normal spaces
        .replace(/\u00A0/g, ' ')
        // Collapse consecutive spaces into one
        .replace(/ {2,}/g, ' ');
      return cleaned;
    } else {
      return ctx.content;
    }
  },
};
