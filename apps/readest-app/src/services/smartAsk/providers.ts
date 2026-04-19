import type { SmartAskProvider, SmartAskSettings } from './types';

type SmartAskProviderProtocol = 'ollama' | 'openai-compatible' | 'lmstudio-rest';

export interface SmartAskProviderConfig {
  id: Exclude<SmartAskProvider, 'openai-compatible'>;
  label: string;
  protocol: SmartAskProviderProtocol;
  defaultBaseUrl: string;
  modelPlaceholder: string;
  requiresApiKey: boolean;
  supportsApiKey?: boolean;
}

export const SMART_ASK_PROVIDER_OPTIONS: SmartAskProviderConfig[] = [
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    protocol: 'ollama',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    modelPlaceholder: 'qwen2.5:7b',
    requiresApiKey: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com',
    modelPlaceholder: 'gpt-4.1-mini',
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
    modelPlaceholder: 'openai/gpt-4.1-mini',
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
    modelPlaceholder: 'gemini-2.5-flash-lite',
    requiresApiKey: true,
  },
  {
    id: 'lmstudio-rest',
    label: 'LM Studio REST',
    protocol: 'lmstudio-rest',
    defaultBaseUrl: 'http://localhost:1234',
    modelPlaceholder: 'openai/gpt-oss-20b',
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

export function normalizeSmartAskProvider(
  provider: SmartAskProvider,
): SmartAskProviderConfig['id'] {
  return provider === 'openai-compatible' ? 'custom-openai-compatible' : provider;
}

export function getSmartAskProviderConfig(provider: SmartAskProvider): SmartAskProviderConfig {
  const normalized = normalizeSmartAskProvider(provider);
  return (
    SMART_ASK_PROVIDER_OPTIONS.find((option) => option.id === normalized) ??
    SMART_ASK_PROVIDER_OPTIONS[0]!
  );
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function getSmartAskChatEndpoint(settings: SmartAskSettings): string {
  const config = getSmartAskProviderConfig(settings.provider);
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  return config.protocol === 'lmstudio-rest'
    ? `${baseUrl}/api/v0/chat/completions`
    : `${baseUrl}/v1/chat/completions`;
}

export function getSmartAskModelsEndpoint(settings: SmartAskSettings): string {
  const config = getSmartAskProviderConfig(settings.provider);
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (config.protocol === 'ollama') return `${baseUrl}/api/tags`;
  if (config.protocol === 'lmstudio-rest') return `${baseUrl}/api/v0/models`;
  return `${baseUrl}/v1/models`;
}

export function smartAskProviderNeedsApiKey(provider: SmartAskProvider): boolean {
  return getSmartAskProviderConfig(provider).requiresApiKey;
}

export function smartAskProviderSupportsApiKey(provider: SmartAskProvider): boolean {
  const config = getSmartAskProviderConfig(provider);
  return config.requiresApiKey || config.supportsApiKey === true;
}

export function getSmartAskThinkingControlParams(
  settings: SmartAskSettings,
): Record<string, unknown> {
  const provider = normalizeSmartAskProvider(settings.provider);
  if (provider === 'lmstudio-rest') {
    return { reasoning: 'off' };
  }

  const model = settings.model.toLowerCase();

  switch (provider) {
    case 'ollama':
      return model.includes('gpt-oss') ? { think: 'low' } : { think: false };
    case 'openrouter':
      return { reasoning: { effort: 'none', exclude: true } };
    case 'gemini':
      if (isGemini25ThinkingOptionalModel(model)) return { reasoning_effort: 'none' };
      if (isGemini3FlashModel(model)) return { reasoning_effort: 'minimal' };
      return {};
    case 'openai':
      return isOpenAIReasoningModel(model) ? { reasoning_effort: 'minimal' } : {};
    default:
      return {};
  }
}

function isOpenAIReasoningModel(model: string): boolean {
  return (
    /^o\d/.test(model) ||
    model.startsWith('gpt-5') ||
    model.startsWith('gpt-oss') ||
    model.includes('/o') ||
    model.includes('/gpt-5') ||
    model.includes('/gpt-oss')
  );
}

function isGemini25ThinkingOptionalModel(model: string): boolean {
  return model.includes('gemini-2.5') && !model.includes('pro');
}

function isGemini3FlashModel(model: string): boolean {
  return model.includes('gemini-3') && model.includes('flash');
}
