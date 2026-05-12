import type { Transformer } from './types';

export const rubyTransformer: Transformer = {
  name: 'ruby',
  transform: async (ctx) => {
    let result = ctx.content;
    if (!/<ruby/i.test(result)) return result;

    result = result.replace(/<rt([^>]*)>([\s\S]*?)<\/rt>/gi, (_, attrs, content) => {
      const text = content.replace(/<[^>]+>/g, '').trim();
      if (!text) return `<rt${attrs}></rt>`;
      const escaped = text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<rt${attrs}><span class="rt-text" data-text="${escaped}"></span></rt>`;
    });

    return result;
  },
};
