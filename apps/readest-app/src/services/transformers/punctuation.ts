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
    const shouldTransform = ctx.viewSettings.vertical === true;
    if (!shouldTransform) return ctx.content;

    let result = ctx.content;
    for (const [original, vertical] of Object.entries(punctuationMap)) {
      if (ctx.reversePunctuationTransform) {
        result = result.replace(new RegExp(vertical, 'g'), original);
      } else {
        result = result.replace(new RegExp(original, 'g'), vertical);
      }
    }

    return result;
  },
};
