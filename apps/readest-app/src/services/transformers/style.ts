import { transformStylesheet } from '@/utils/style';
import type { Transformer } from './types';

export const styleTransformer: Transformer = {
  name: 'style',

  transform: async (ctx) => {
    let result = ctx.content;
    const styleMatches = [...result.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];

    for (const match of styleMatches) {
      const [full, css] = match;
      const transformed = await transformStylesheet(
        ctx.width || window.innerWidth,
        ctx.height || window.innerHeight,
        css!,
      );
      result = result.replace(full, `<style>${transformed}</style>`);
    }

    return result;
  },
};
