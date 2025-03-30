import type { Transformer } from './types';

const punctuationMap: Record<string, string> = {
  '“': '﹃',
  '”': '﹄',
  '‘': '﹁',
  '’': '﹂',
};

export const punctuationTransformer: Transformer = {
  name: 'punctuation',

  transform: async (ctx) => {
    if (!ctx.content.includes('<html')) return ctx.content;

    const shouldTransform = ctx.viewSettings.vertical === true;
    if (!shouldTransform) return ctx.content;

    let result = ctx.content;
    for (const [original, vertical] of Object.entries(punctuationMap)) {
      result = result.replace(new RegExp(original, 'g'), vertical);
    }

    return result;
  },
};
