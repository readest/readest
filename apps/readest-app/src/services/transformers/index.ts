import type { Transformer } from './types';
import { translateTransformer } from './translate';
import { punctuationTransformer } from './punctuation';

export const activeTransformers: Transformer[] = [
  punctuationTransformer,
  translateTransformer,
  // Add more transformers here
];
