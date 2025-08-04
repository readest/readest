import type { Transformer } from './types';
import { footnoteTransformer } from './footnote';
import { languageTransformer } from './language';
import { punctuationTransformer } from './punctuation';

export const availableTransformers: Transformer[] = [
  punctuationTransformer,
  footnoteTransformer,
  languageTransformer,
  // Add more transformers here
];
