import type { InlineInsightProvider } from './types';

export interface InlineInsightProviderConfig {
  id: InlineInsightProvider;
  label: string;
  defaultChatUrl: string;
  defaultModelUrl: string;
  modelPlaceholder: string;
  requiresApiKey: boolean;
  supportsApiKey?: boolean;
}

export const INLINE_INSIGHT_PROVIDER_OPTIONS: InlineInsightProviderConfig[] = [
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    defaultChatUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    defaultModelUrl: 'http://127.0.0.1:11434/v1/models',
    modelPlaceholder: 'qwen3.5:9b',
    requiresApiKey: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultChatUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModelUrl: 'https://api.openai.com/v1/models',
    modelPlaceholder: 'gpt-5.4-mini',
    requiresApiKey: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultChatUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModelUrl: 'https://api.deepseek.com/v1/models',
    modelPlaceholder: 'deepseek-chat',
    requiresApiKey: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultChatUrl: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModelUrl: 'https://openrouter.ai/api/v1/models',
    modelPlaceholder: 'openai/gpt-5.4-mini',
    requiresApiKey: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    defaultChatUrl: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModelUrl: 'https://api.groq.com/openai/v1/models',
    modelPlaceholder: 'llama-3.3-70b-versatile',
    requiresApiKey: true,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    defaultChatUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions',
    defaultModelUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/v1/models',
    modelPlaceholder: 'gemini-3.1-flash-lite-preview',
    requiresApiKey: true,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    defaultChatUrl: 'http://localhost:1234/v1/chat/completions',
    defaultModelUrl: 'http://localhost:1234/v1/models',
    modelPlaceholder: 'qwen/qwen3.5-9b',
    requiresApiKey: false,
    supportsApiKey: true,
  },
  {
    id: 'custom-openai-compatible',
    label: 'OpenAI-compatible',
    defaultChatUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModelUrl: 'https://api.openai.com/v1/models',
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
