export type InlineInsightProvider =
  | 'ollama'
  | 'openai'
  | 'deepseek'
  | 'openrouter'
  | 'groq'
  | 'gemini'
  | 'lmstudio-rest'
  | 'custom-openai-compatible';

export interface InlineInsightProviderProfile {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface InlineInsightSettings {
  enabled: boolean;
  provider: InlineInsightProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  providerProfiles: Partial<Record<InlineInsightProvider, InlineInsightProviderProfile>>;
  maxContextChars: number;
  targetLanguage: string;
  systemPrompt: string;
  questionDirections: string[];
  cacheEnabled: boolean;
}

export const DEFAULT_INLINE_INSIGHT_SETTINGS: InlineInsightSettings = {
  enabled: false,
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  apiKey: '',
  providerProfiles: {},
  maxContextChars: 2000,
  targetLanguage: '',
  systemPrompt: '',
  questionDirections: [],
  cacheEnabled: true,
};
