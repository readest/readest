import type { InlineInsightProvider } from './types';

export type InlineInsightProviderProtocol = 'ollama' | 'openai-compatible' | 'lmstudio-rest';

export interface InlineInsightProviderConfig {
  id: InlineInsightProvider;
  label: string;
  protocol: InlineInsightProviderProtocol;
  defaultBaseUrl: string;
  modelPlaceholder: string;
  requiresApiKey: boolean;
  supportsApiKey?: boolean;
}

export const INLINE_INSIGHT_PROVIDER_OPTIONS: InlineInsightProviderConfig[] = [
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    protocol: 'ollama',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    modelPlaceholder: 'qwen3.5:9b',
    requiresApiKey: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com',
    modelPlaceholder: 'gpt-5.4-mini',
    requiresApiKey: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.deepseek.com',
    modelPlaceholder: 'deepseek-chat',
    requiresApiKey: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api',
    modelPlaceholder: 'openai/gpt-5.4-mini',
    requiresApiKey: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.groq.com/openai',
    modelPlaceholder: 'llama-3.3-70b-versatile',
    requiresApiKey: true,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelPlaceholder: 'gemini-3.1-flash-lite-preview',
    requiresApiKey: true,
  },
  {
    id: 'lmstudio-rest',
    label: 'LM Studio REST',
    protocol: 'lmstudio-rest',
    defaultBaseUrl: 'http://localhost:1234',
    modelPlaceholder: 'qwen/qwen3.5-9b',
    requiresApiKey: false,
    supportsApiKey: true,
  },
  {
    id: 'custom-openai-compatible',
    label: 'OpenAI-compatible',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com',
    modelPlaceholder: 'model-id',
    requiresApiKey: true,
  },
];

export function getProviderDefaultConfig(
  provider: InlineInsightProvider,
): InlineInsightProviderConfig {
  return (
    INLINE_INSIGHT_PROVIDER_OPTIONS.find((option) => option.id === provider) ??
    INLINE_INSIGHT_PROVIDER_OPTIONS[0]!
  );
}
