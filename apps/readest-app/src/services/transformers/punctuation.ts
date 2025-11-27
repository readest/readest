import type { Transformer } from './types';

const punctuationMapHans: Record<string, string> = {
  '“': '﹃',
  '”': '﹄',
  '‘': '﹁',
  '’': '﹂',
};

const punctuationMapHant: Record<string, string> = {
  '“': '﹁',
  '”': '﹂',
  '‘': '﹃',
  '’': '﹄',
};

export const punctuationTransformer: Transformer = {
  name: 'punctuation',

  transform: async (ctx) => {
    const shouldTransform = ctx.viewSettings.vertical && ctx.viewSettings.replaceQuotationMarks;
    if (!shouldTransform) return ctx.content;

    let result = ctx.content;
    const traditionalChineseLocales = ['zh-Hant', 'zh-TW', 'zh_TW'];
    let punctuationMap: Record<string, string> = punctuationMapHans;
    if (
      traditionalChineseLocales.includes(ctx.primaryLanguage || '') ||
      traditionalChineseLocales.includes(ctx.userLocale)
    ) {
      punctuationMap = punctuationMapHant;
    }
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
