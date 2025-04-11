import { ViewSettings } from '@/types/book';

export type TransformContext = {
  bookKey: string;
  viewSettings: ViewSettings;
  content: string;
  transformers: string[];
  reversePunctuationTransform?: boolean;
};

export type Transformer = {
  name: string;
  transform: (ctx: TransformContext) => Promise<string>;
};
