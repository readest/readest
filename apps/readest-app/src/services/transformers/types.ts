import { ViewSettings } from '@/types/book';

export type TransformContext = {
  bookKey: string;
  viewSettings: ViewSettings;
  userLocale: string;
  isFixedLayout: boolean;
  primaryLanguage?: string;
  width?: number;
  height?: number;
  content: string;
  sectionHref?: string;
  // Spine CFI of the section being transformed (`sections[i].cfi`), when the
  // format has one. Selection-scoped proofread rules match against this rather
  // than `sectionHref`, which is the TOC href at the reading position and so
  // names a different file whenever a spine item has no TOC entry (#6148).
  sectionCfi?: string;
  transformers: string[];
  reversePunctuationTransform?: boolean;
};

export type Transformer = {
  name: string;
  transform: (ctx: TransformContext, options?: unknown) => Promise<string>;
};
