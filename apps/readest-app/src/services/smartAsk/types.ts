export type SmartAskProvider =
  | 'ollama'
  | 'openai'
  | 'deepseek'
  | 'openrouter'
  | 'groq'
  | 'gemini'
  | 'lmstudio-rest'
  | 'custom-openai-compatible'
  | 'openai-compatible';

export interface SmartAskSettings {
  enabled: boolean;
  provider: SmartAskProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  maxContextChars: number;
  targetLanguage: string;
  questionDirections: string[];
  cacheEnabled: boolean;
  cacheTtlMinutes: number;
}

export const DEFAULT_SMART_ASK_SETTINGS: SmartAskSettings = {
  enabled: false,
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  apiKey: '',
  maxContextChars: 2000,
  targetLanguage: '',
  questionDirections: [],
  cacheEnabled: true,
  cacheTtlMinutes: 24 * 60,
};

export interface SmartAskQA {
  question: string;
  brief: string;
  detail: string;
}

export interface SmartAskResult {
  qas: SmartAskQA[];
}
