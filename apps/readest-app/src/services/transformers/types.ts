import { ViewSettings } from '@/types/book';

export type TransformContext = {
  bookKey: string;
  viewSettings: ViewSettings;
  primaryLanguage?: string;
  width?: number;
  height?: number;
  content: string;
  transformers: string[];
  reversePunctuationTransform?: boolean;
};

export type Transformer = {
  name: string;
  transform: (ctx: TransformContext) => Promise<string>;
};
