export type InlineInsightProvider =
  | 'ollama'
  | 'openai'
  | 'deepseek'
  | 'openrouter'
  | 'groq'
  | 'gemini'
  | 'lmstudio'
  | 'custom-openai-compatible';

export interface InlineInsightProviderProfile {
  chatUrl: string;
  modelUrl: string;
  model: string;
  apiKey: string;
}

export interface InlineInsightSettings {
  enabled: boolean;
  provider: InlineInsightProvider;
  chatUrl: string;
  modelUrl: string;
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
  chatUrl: 'http://127.0.0.1:11434/v1/chat/completions',
  modelUrl: 'http://127.0.0.1:11434/v1/models',
  model: '',
  apiKey: '',
  providerProfiles: {},
  maxContextChars: 2000,
  targetLanguage: '',
  systemPrompt: '',
  questionDirections: [],
  cacheEnabled: true,
};
