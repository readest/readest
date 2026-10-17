import { transformStylesheet } from '@/utils/style';
import type { Transformer } from './types';

// In paginated mode each column is a page, and a `page` break doesn't break a
// column. foliate-js rewrites these to column breaks in linked stylesheets;
// `<style>` blocks and `style` attributes never reach it (#6873).
const toColumnBreaks = (css: string) =>
  css
    .replace(/page-break-before\s*:/gi, '-webkit-column-break-before:')
    .replace(
      /break-before\s*:\s*(avoid-)?page/gi,
      (_, avoid) => `break-before: ${avoid ?? ''}column`,
    );

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
      result = result.replace(full, `<style${attrs}>${toColumnBreaks(transformed)}</style>`);
    }

    result = result.replace(/(\sstyle\s*=\s*)("[^"]*"|'[^']*')/gi, (attr, name, value) =>
      /break-before/i.test(value) ? name + toColumnBreaks(value) : attr,
    );

    return result;
  },
};
