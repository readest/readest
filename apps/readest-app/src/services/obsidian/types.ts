import type { ReadingStatus } from '@/types/book';

export type ObsidianHighlightStyle = 'callout' | 'blockquote' | 'bullet';
export type ObsidianGroupBy = 'chapter' | 'date' | 'none';

export interface ObsidianFormatOptions {
  highlightStyle?: ObsidianHighlightStyle;
  calloutType?: string;
  colorCallouts?: boolean;
  colorTags?: boolean;
  includeDeepLinks?: boolean;
  groupHighlightsBy?: ObsidianGroupBy;
  includeCoverImage?: boolean;
  coverRelativePath?: string;
  preserveUserNotes?: boolean;
  dateFormat?: string;
  statusTagMapping?: Partial<Record<ReadingStatus, string>>;
}

export interface FormattedAnnotation {
  id: string;
  text: string;
  note?: string;
  color?: string;
  chapterTitle?: string;
  page?: number;
  cfi?: string;
  url?: string;
  timestamp: number;
}
