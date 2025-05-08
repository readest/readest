import type { Transformer } from './types';
import { footnoteTransformer } from './footnote';
import { translateTransformer } from './translate';
import { punctuationTransformer } from './punctuation';

export const availableTransformers: Transformer[] = [
  punctuationTransformer,
  translateTransformer,
  footnoteTransformer,
  // Add more transformers here
];
