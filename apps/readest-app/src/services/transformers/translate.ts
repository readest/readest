import type { Transformer } from './types';

export const translateTransformer: Transformer = {
  name: 'translate',

  transform: async (ctx) => {
    return ctx.content;
  },
};
