import type { Transformer } from './types';
import { footnoteTransformer } from './footnote';
import { languageTransformer } from './language';
import { punctuationTransformer } from './punctuation';
import { whitespaceTransformer } from './whitespace';
import { sanitizerTransformer } from './sanitizer';
import { simpleccTransformer } from './simplecc';
import { styleTransformer } from './style';

export const availableTransformers: Transformer[] = [
  punctuationTransformer,
  footnoteTransformer,
  languageTransformer,
  styleTransformer,
  whitespaceTransformer,
  sanitizerTransformer,
  simpleccTransformer,
  // Add more transformers here
];
