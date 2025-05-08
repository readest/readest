import type { Transformer } from './types';

export const footnoteTransformer: Transformer = {
  name: 'footnote',

  transform: async (ctx) => {
    let result = ctx.content;
    result = result.replace(
      /<aside\s+epub:type\s*=\s*["'](footnote|endnote|note|rearnote)["']([^>]*)>/gi,
      '<aside class="epubtype-footnote" epub:type="$1"$2>',
    );
    return result;
  },
};
