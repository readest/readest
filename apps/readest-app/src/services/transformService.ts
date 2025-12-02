import { availableTransformers } from './transformers';
import { TransformContext } from './transformers/types';

export const transformContent = async (ctx: TransformContext): Promise<string> => {
  
  const hasReplacement = ctx.transformers.includes('replacement');
  console.log('[DEBUG] Replacement in transformers list?', hasReplacement);
  console.log('[DEBUG] All transformers:', ctx.transformers);
  console.log('[DEBUG] Available transformers:', availableTransformers.map(t => t.name));
  
  let transformed = ctx.content;

  const activeTransformers = ctx.transformers
    .map((name) => availableTransformers.find((transformer) => transformer.name === name))
    .filter((transformer) => !!transformer);

  console.log('[TRANSFORM] Active transformers:', ctx.transformers);
  console.log('[TRANSFORM] Found transformers:', activeTransformers.map(t => t.name));
  

  for (const transformer of activeTransformers) {
    try {
      console.log('[TRANSFORM] Running transformer:', transformer.name);
      transformed = await transformer.transform({ ...ctx, content: transformed });
      console.log('[TRANSFORM] Completed transformer:', transformer.name);
    } catch (error) {
      console.warn(`Error in transformer ${transformer.name}:`, error);
    }
  }

  return transformed;
};
