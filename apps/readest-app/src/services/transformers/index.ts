import type { Transformer } from './types';
import { footnoteTransformer } from './footnote';
import { languageTransformer } from './language';
import { punctuationTransformer } from './punctuation';
import { whitespaceTransformer } from './whitespace';

export const availableTransformers: Transformer[] = [
  punctuationTransformer,
  footnoteTransformer,
  languageTransformer,
  whitespaceTransformer,
  // Add more transformers here
];
