import { ViewSettings } from '@/types/book';

export type TransformContext = {
  bookKey: string;
  viewSettings: ViewSettings;
  userLocale: string;
  primaryLanguage?: string;
  width?: number;
  height?: number;
  content: string;
  transformers: string[];
  reversePunctuationTransform?: boolean;
  sectionHref?: string; // Section href for single-instance replacement tracking
};

export type Transformer = {
  name: string;
  transform: (ctx: TransformContext) => Promise<string>;
};
