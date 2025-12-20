import type { AISettings } from './types';

export const GATEWAY_MODELS = {
  CLAUDE_SONNET: 'openai/gpt-5.2',
  GEMINI_3_FLASH: 'google/gemini-3-flash',
  GPT_5_2_MINI: 'openai/gpt-5.2-mini',
  GEMINI_3_FLASH_EXP: 'google/gemini-3-flash-exp',
} as const;

export const OLLAMA_MODELS = {
  LLAMA: 'llama3.2:3b',
  QWEN: 'qwen2.5:7b',
} as const;

export const EMBEDDING_MODELS = {
  OPENAI_SMALL: 'openai/text-embedding-3-small',
  NOMIC: 'nomic-embed-text-v2',
} as const;

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  provider: 'ollama',

  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'llama3.2',
  ollamaEmbeddingModel: 'nomic-embed-text',

  aiGatewayModel: 'openai/gpt-5.2',
  aiGatewayEmbeddingModel: 'openai/text-embedding-3-small',

  spoilerProtection: true,
  maxContextChunks: 10,
  indexingMode: 'on-demand',
};
