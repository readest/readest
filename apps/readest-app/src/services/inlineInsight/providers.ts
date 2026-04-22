import type { InlineInsightProvider, InlineInsightSettings } from './types';

type InlineInsightProviderProtocol = 'ollama' | 'openai-compatible' | 'lmstudio-rest';

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

export function getInlineInsightProviderConfig(
  provider: InlineInsightProvider,
): InlineInsightProviderConfig {
  return (
    INLINE_INSIGHT_PROVIDER_OPTIONS.find((option) => option.id === provider) ??
    INLINE_INSIGHT_PROVIDER_OPTIONS[0]!
  );
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function getInlineInsightChatEndpoint(settings: InlineInsightSettings): string {
  const config = getInlineInsightProviderConfig(settings.provider);
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  return config.protocol === 'lmstudio-rest'
    ? `${baseUrl}/api/v0/chat/completions`
    : `${baseUrl}/v1/chat/completions`;
}

export function getInlineInsightModelsEndpoint(settings: InlineInsightSettings): string {
  const config = getInlineInsightProviderConfig(settings.provider);
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (config.protocol === 'ollama') return `${baseUrl}/api/tags`;
  if (config.protocol === 'lmstudio-rest') return `${baseUrl}/api/v0/models`;
  return `${baseUrl}/v1/models`;
}

export function inlineInsightProviderNeedsApiKey(provider: InlineInsightProvider): boolean {
  return getInlineInsightProviderConfig(provider).requiresApiKey;
}

export function inlineInsightProviderSupportsApiKey(provider: InlineInsightProvider): boolean {
  const config = getInlineInsightProviderConfig(provider);
  return config.requiresApiKey || config.supportsApiKey === true;
}

export function getMinimalThinkingParams(settings: InlineInsightSettings): Record<string, unknown> {
  const provider = settings.provider;
  const model = settings.model.toLowerCase();

  // See https://ai.google.dev/gemini-api/docs/openai#thinking
  if (provider === 'gemini') {
    if (model.includes('gemini-2.5') && !model.includes('pro')) {
      return { reasoning_effort: 'none' };
    }
    if (model.includes('gemini-3')) {
      return { reasoning_effort: 'minimal' };
    }
  }

  // Likely working well
  if (provider === 'openrouter') {
    return { reasoning: { effort: 'none' } };
  }

  // Likely not working, but won't crash
  if (provider === 'lmstudio-rest') {
    return { reasoning: 'off' };
  }

  // if (provider === 'ollama') {
  //   return { reasoning_effort: 'none' };
  // }

  return {};
}
