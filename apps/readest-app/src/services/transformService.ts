import { activeTransformers } from './transformers';
import { TransformContext } from './transformers/types';

export const transformContent = async (ctx: TransformContext): Promise<string> => {
  let transformed = ctx.content;

  for (const transformer of activeTransformers) {
    try {
      transformed = await transformer.transform({ ...ctx, content: transformed });
    } catch (error) {
      console.warn(`Error in transformer ${transformer.name}:`, error);
    }
  }

  return transformed;
};
