import type { AISettings } from './types';

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
