export type InlineInsightProvider =
  | 'ollama'
  | 'openai'
  | 'deepseek'
  | 'openrouter'
  | 'groq'
  | 'gemini'
  | 'lmstudio-rest'
  | 'custom-openai-compatible'
  | 'openai-compatible';

export interface InlineInsightSettings {
  enabled: boolean;
  provider: InlineInsightProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  maxContextChars: number;
  targetLanguage: string;
  systemPrompt: string;
  questionDirections: string[];
  cacheEnabled: boolean;
  cacheTtlMinutes: number;
}

export const DEFAULT_INLINE_INSIGHT_SETTINGS: InlineInsightSettings = {
  enabled: false,
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  apiKey: '',
  maxContextChars: 2000,
  targetLanguage: '',
  systemPrompt: '',
  questionDirections: [],
  cacheEnabled: true,
  cacheTtlMinutes: 24 * 60,
};

export interface InlineInsightQA {
  question: string;
  brief: string;
  detail: string;
}

export interface InlineInsightResult {
  qas: InlineInsightQA[];
}
