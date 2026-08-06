export type ContextTranslationDetailLevel = 'normal' | 'detailed';

export interface ContextTranslationInput {
  selectedText: string;
  beforeContext: string;
  afterContext: string;
  sentence?: string;
  paragraph?: string;
  sourceLanguage?: string;
  targetLanguage: string;
  bookTitle?: string;
  chapterTitle?: string;
  detailLevel: ContextTranslationDetailLevel;
}

export interface ContextTranslationSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  targetLanguage: string;
  maxContextChars: number;
}

export interface ContextTranslationNormalResult {
  mode: 'normal';
  headword: string;
  translation: string;
  explanation: string;
}

export interface ContextTranslationDetailedResult {
  mode: 'detailed';
  headword: string;
  grammarPattern?: string;
  pronunciation?: string;
  definition: string;
  translation?: string;
  explanation: string;
  examples: Array<{
    sentence: string;
    explanation: string;
  }>;
  synonyms: Array<{
    phrase: string;
    example: string;
    nuance: string;
  }>;
}

export type ContextTranslationResult =
  | ContextTranslationNormalResult
  | ContextTranslationDetailedResult;

export type ContextTranslationErrorCode =
  | 'not-configured'
  | 'unauthorized'
  | 'not-found'
  | 'rate-limited'
  | 'provider-error'
  | 'network-error'
  | 'timeout'
  | 'empty-response'
  | 'invalid-response';

export class ContextTranslationError extends Error {
  readonly code: ContextTranslationErrorCode;
  readonly retryable: boolean;

  constructor(code: ContextTranslationErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = 'ContextTranslationError';
    this.code = code;
    this.retryable = retryable;
  }
}
