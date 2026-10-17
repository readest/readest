import { transformStylesheet } from '@/utils/style';
import type { Transformer } from './types';

// In paginated mode each column is a page, and a `page` break doesn't break a
// column. foliate-js rewrites these to column breaks in linked stylesheets;
// `<style>` blocks and `style` attributes never reach it (#6873).
const toColumnBreaks = (css: string) =>
  css
    .replace(/(^|[^\w-])page-break-before\s*:/gi, '$1-webkit-column-break-before:')
    .replace(
      /(^|[^\w-])break-before\s*:\s*(avoid-)?page/gi,
      (_, before, avoid) => `${before}break-before: ${avoid ?? ''}column`,
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

    // Only `style` attributes inside opening tags, not text that reads like one.
    // Walking every quoted attribute keeps `style=` inside another value untouched.
    result = result.replace(/<[a-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/gi, (tag) =>
      tag.replace(/(\s([\w:.-]+)\s*=\s*)("[^"]*"|'[^']*')/g, (attr, prefix, name, value) =>
        name.toLowerCase() === 'style' && /break-before/i.test(value)
          ? prefix + toColumnBreaks(value)
          : attr,
      ),
    );

    return result;
  },
};
