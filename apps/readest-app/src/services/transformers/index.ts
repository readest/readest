import type { Transformer } from './types';
import { footnoteTransformer } from './footnote';
import { punctuationTransformer } from './punctuation';

export const availableTransformers: Transformer[] = [
  punctuationTransformer,
  footnoteTransformer,
  // Add more transformers here
];
