import {
  buildContextTranslationSystemPrompt,
  buildContextTranslationUserPayload,
} from './contextTranslationPrompt';
import { parseContextTranslationResult } from './contextTranslationParser';
import type {
  ContextTranslationInput,
  ContextTranslationResult,
  ContextTranslationSettings,
} from './contextTranslationTypes';
import { ContextTranslationError } from './contextTranslationTypes';
import { getAIFetch } from './utils/httpFetch';

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

const cache = new Map<string, ContextTranslationResult>();

export const clearContextTranslationCache = (): void => {
  cache.clear();
};

export const normalizeChatCompletionsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
};

const assertConfigured = (settings: ContextTranslationSettings): void => {
  if (!settings.baseUrl.trim() || !settings.apiKey.trim() || !settings.modelId.trim()) {
    throw new ContextTranslationError(
      'not-configured',
      'Context translation provider settings are incomplete.',
      false,
    );
  }
};

const buildCacheKey = (input: ContextTranslationInput, settings: ContextTranslationSettings): string =>
  JSON.stringify({
    input,
    baseUrl: normalizeChatCompletionsUrl(settings.baseUrl),
    modelId: settings.modelId.trim(),
  });

const mapStatusToError = (status: number): ContextTranslationError => {
  if (status === 401 || status === 403) {
    return new ContextTranslationError(
      'unauthorized',
      'Context translation provider rejected the API key.',
      false,
    );
  }
  if (status === 404) {
    return new ContextTranslationError(
      'not-found',
      'Context translation provider endpoint or model was not found.',
      false,
    );
  }
  if (status === 429) {
    return new ContextTranslationError(
      'rate-limited',
      'Context translation provider rate limit was reached.',
      true,
    );
  }
  return new ContextTranslationError(
    'provider-error',
    `Context translation provider returned HTTP ${status}.`,
    status >= 500,
  );
};

const readCompletionContent = (json: unknown): string => {
  const response = json as OpenAIChatCompletionResponse;
  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new ContextTranslationError(
      'empty-response',
      'Context translation provider returned an empty response.',
      true,
    );
  }
  return content;
};

export const requestContextTranslation = async (
  input: ContextTranslationInput,
  settings: ContextTranslationSettings,
): Promise<ContextTranslationResult> => {
  assertConfigured(settings);

  const cacheKey = buildCacheKey(input, settings);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const response = await getAIFetch()(normalizeChatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.modelId.trim(),
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: buildContextTranslationSystemPrompt(input.detailLevel),
        },
        {
          role: 'user',
          content: buildContextTranslationUserPayload(input),
        },
      ],
    }),
  });

  if (!response.ok) throw mapStatusToError(response.status);

  try {
    const result = parseContextTranslationResult(
      readCompletionContent(await response.json()),
      input.detailLevel,
    );
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    if (error instanceof ContextTranslationError) throw error;
    throw new ContextTranslationError(
      'invalid-response',
      error instanceof Error ? error.message : 'Context translation provider returned an invalid response.',
      false,
    );
  }
};
