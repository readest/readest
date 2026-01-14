import { ViewSettings } from '@/types/book';

export type TransformContext = {
  bookKey: string;
  viewSettings: ViewSettings;
  userLocale: string;
  primaryLanguage?: string;
  width?: number;
  height?: number;
  content: string;
  sectionHref?: string;
  transformers: string[];
  reversePunctuationTransform?: boolean;
};

export type Transformer = {
  name: string;
  transform: (ctx: TransformContext, options?: unknown) => Promise<string>;
};
