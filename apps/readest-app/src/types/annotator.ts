export type AnnotationToolType =
  | 'copy'
  | 'highlight'
  | 'annotate'
  | 'search'
  | 'dictionary'
  | 'translate'
  | 'tts'
  | 'proofread'
  | 'inlineinsight';

export const DEFAULT_ANNOTATION_TOOL_TYPES: AnnotationToolType[] = [
  'copy',
  'highlight',
  'annotate',
  'search',
  'dictionary',
  'translate',
  'tts',
  'proofread',
  'inlineinsight',
];
