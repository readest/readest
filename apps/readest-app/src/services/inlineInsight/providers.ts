import { getProviderDefaultConfig } from './providerConfigs';
import type { InlineInsightProvider, InlineInsightSettings } from './types';

export { getProviderDefaultConfig };

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function getInlineInsightChatEndpoint(settings: InlineInsightSettings): string {
  const config = getProviderDefaultConfig(settings.provider);
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  return config.protocol === 'lmstudio-rest'
    ? `${baseUrl}/api/v0/chat/completions`
    : `${baseUrl}/v1/chat/completions`;
}

export function getInlineInsightModelsEndpoint(settings: InlineInsightSettings): string {
  const config = getProviderDefaultConfig(settings.provider);
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (config.protocol === 'ollama') return `${baseUrl}/api/tags`;
  if (config.protocol === 'lmstudio-rest') return `${baseUrl}/api/v0/models`;
  return `${baseUrl}/v1/models`;
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

  // Likely not working, but won't crash
  if (provider === 'lmstudio-rest') {
    return { reasoning: 'off' };
  }

  return {};
}
