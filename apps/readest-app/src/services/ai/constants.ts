import type { AISettings } from './types';

export const OPENROUTER_MODELS = {
  CLAUDE_SONNET: 'anthropic/claude-sonnet-4.5',
  GPT5_MINI: 'openai/gpt-5-mini',
  LLAMA_4: 'meta-llama/llama-4-maverick',
  QWEN_3: 'qwen/qwen-3-32b',
} as const;

export const EMBEDDING_MODELS = {
  OPENAI_SMALL: 'openai/text-embedding-3-small',
  NOMIC: 'nomic-embed-text',
} as const;

export const OLLAMA_MODELS = {
  QWEN_3_CODER: 'qwen3-coder:32b',
  LLAMA_4: 'llama4-scout:32b',
} as const;

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  provider: 'ollama',

  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen3-coder:32b',
  ollamaEmbeddingModel: 'nomic-embed-text',

  openrouterModel: 'openai/gpt-5-mini',
  openrouterEmbeddingModel: 'openai/text-embedding-3-small',

  spoilerProtection: true,
  maxContextChunks: 10,
  indexingMode: 'on-demand',
};
