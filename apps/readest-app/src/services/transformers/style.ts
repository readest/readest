import { transformStylesheet } from '@/utils/style';
import type { Transformer } from './types';

export const styleTransformer: Transformer = {
  name: 'style',

  transform: async (ctx) => {
    let result = ctx.content;
    if (ctx.isFixedLayout) return result;

    // Capture the opening tag's own attributes (e.g. `type`, `media`) and
    // replay them onto the rewritten tag. Rebuilding with a bare `<style>`
    // drops `media="print"`, which turns a print-only block (paired with a
    // `noprint`-classed element the book only means to hide when printed)
    // into a rule that also applies to the on-screen paginated rendering,
    // blanking the page (readest/readest#6233).
    const styleMatches = [...result.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/gi)];

    for (const match of styleMatches) {
      const [full, attrs, css] = match;
      const transformed = await transformStylesheet(
        css!,
        ctx.width || window.innerWidth,
        ctx.height || window.innerHeight,
        ctx.viewSettings.vertical,
      );
      result = result.replace(full, `<style${attrs}>${transformed}</style>`);
    }

    return result;
  },
};
