import { getProviderDefaultConfig } from './providerConfigs';
import type { InlineInsightProvider, InlineInsightSettings } from './types';

export { getProviderDefaultConfig };

const CHAT_SUFFIX = '/v1/chat/completions';
const MODELS_SUFFIX = '/v1/models';
const HOST_SUFFIX_CANDIDATES = [
  CHAT_SUFFIX,
  '/chat/completions',
  MODELS_SUFFIX,
  '/models',
  '/v1/chat',
  '/chat',
  '/v1',
];

function trimTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function stripKnownEndpointSuffix(url: string): string {
  let current = trimTrailingSlashes(url);
  for (const suffix of HOST_SUFFIX_CANDIDATES) {
    if (current.endsWith(suffix)) {
      current = current.slice(0, -suffix.length);
      break;
    }
  }
  return trimTrailingSlashes(current);
}

export function buildInlineInsightUrlsFromApiHost(input: string): {
  chatUrl: string;
  modelUrl: string;
} {
  const host = stripKnownEndpointSuffix(input);
  return {
    chatUrl: `${host}${CHAT_SUFFIX}`,
    modelUrl: `${host}${MODELS_SUFFIX}`,
  };
}

export function getApiHostFromInlineInsightChatUrl(chatUrl: string): string {
  return stripKnownEndpointSuffix(chatUrl);
}

export function inlineInsightProviderAllowsCustomApiHost(provider: InlineInsightProvider): boolean {
  return (
    provider === 'ollama' || provider === 'lmstudio' || provider === 'custom-openai-compatible'
  );
}

export function inlineInsightProviderNeedsApiKey(provider: InlineInsightProvider): boolean {
  return getProviderDefaultConfig(provider).requiresApiKey;
}

export function inlineInsightProviderSupportsApiKey(provider: InlineInsightProvider): boolean {
  const config = getProviderDefaultConfig(provider);
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

  // LM Studio: no way to control reasoning

  return {};
}
