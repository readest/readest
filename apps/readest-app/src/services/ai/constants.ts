import type { AISettings } from './types';

// cheapest popular models as of 2025
export const GATEWAY_MODELS = {
  GEMINI_FLASH_LITE: 'google/gemini-2.5-flash-lite', // $0.02/M - cheapest
  GEMINI_FLASH: 'google/gemini-2.5-flash', // $0.10/M
  GPT_4O_MINI: 'openai/gpt-4o-mini', // $0.15/M
  DEEPSEEK_V3: 'deepseek/deepseek-v3', // $0.27/M
} as const;

export const OLLAMA_MODELS = {
  LLAMA: 'llama3.2:3b',
  QWEN: 'qwen2.5:7b',
} as const;

export const EMBEDDING_MODELS = {
  OPENAI_SMALL: 'openai/text-embedding-3-small', // $0.02/M
  NOMIC: 'nomic-embed-text-v2',
} as const;

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  provider: 'ollama',

  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'llama3.2',
  ollamaEmbeddingModel: 'nomic-embed-text',

  aiGatewayModel: 'google/gemini-2.5-flash-lite', // cheapest @ $0.02/M input
  aiGatewayEmbeddingModel: 'openai/text-embedding-3-small', // $0.02/M

  spoilerProtection: true,
  maxContextChunks: 10,
  indexingMode: 'on-demand',
};
