import { isWebAppPlatform } from '@/services/environment';
import { InlineInsightCacheInput, readInlineInsightCache, writeInlineInsightCache } from './cache';
import {
  extractInlineInsightStreamDeltaFromSseLine,
  type InlineInsightChatMessage,
} from './logging';
import { buildInlineInsightFollowUpMessages, buildInlineInsightMessages } from './prompts';
import type { InlineInsightSettings } from './types';
import { getMinimalThinkingParams, inlineInsightProviderSupportsApiKey } from './providers';

export type InlineInsightStreamChunk =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string };

function buildInlineInsightCacheKey(
  settings: InlineInsightSettings,
  messages: InlineInsightChatMessage[],
): string {
  return new InlineInsightCacheInput(settings, messages).buildKey();
}

async function* streamInlineInsightCached(
  messages: InlineInsightChatMessage[],
  settings: InlineInsightSettings,
  signal?: AbortSignal,
): AsyncGenerator<InlineInsightStreamChunk> {
  const cacheKey = buildInlineInsightCacheKey(settings, messages);
  if (settings.cacheEnabled) {
    const cachedText = readInlineInsightCache(cacheKey);
    if (cachedText) {
      yield { type: 'content', text: cachedText };
      return;
    }
  }

  let responseText = '';
  let completed = false;

  try {
    for await (const chunk of streamChatCompletions(messages, settings, signal)) {
      if (chunk.type === 'content') {
        responseText += chunk.text;
      }
      yield chunk;
    }
    completed = true;
  } finally {
    if (completed && cacheKey && responseText.trim()) {
      writeInlineInsightCache(cacheKey, responseText);
    }
  }
}

/**
 * Streams Inline Insight output from an OpenAI-compatible endpoint.
 * Yields raw text delta chunks as they arrive.
 * The model emits a single JSON object whose `brief` array is streamed before `details`.
 */
export async function* streamInlineInsight(
  selectedText: string,
  context: string,
  settings: InlineInsightSettings,
  targetLanguage: string,
  signal?: AbortSignal,
): AsyncGenerator<InlineInsightStreamChunk> {
  const messages = buildInlineInsightMessages(selectedText, context, settings, targetLanguage);
  yield* streamInlineInsightCached(messages, settings, signal);
}

export async function* streamInlineInsightFollowUp(
  question: string,
  selectedText: string,
  context: string,
  previousAnswer: string,
  settings: InlineInsightSettings,
  targetLanguage: string,
  signal?: AbortSignal,
): AsyncGenerator<InlineInsightStreamChunk> {
  const messages = buildInlineInsightFollowUpMessages(
    question,
    selectedText,
    context,
    previousAnswer,
    settings,
    targetLanguage,
  );
  yield* streamInlineInsightCached(messages, settings, signal);
}

async function* streamChatCompletions(
  messages: InlineInsightChatMessage[],
  settings: InlineInsightSettings,
  signal?: AbortSignal,
): AsyncGenerator<InlineInsightStreamChunk> {
  const chatEndpoint = settings.chatUrl;
  const apiKey = inlineInsightProviderSupportsApiKey(settings.provider) ? settings.apiKey : '';

  const chatBody = {
    model: settings.model,
    messages,
    stream: true,
    temperature: 0.3,
    ...getMinimalThinkingParams(settings),
  };

  // POST
  let response: Response;
  let url: string;
  let headers: Record<string, string>;
  if (isWebAppPlatform()) {
    url = '/api/inlineinsight/chat';
    headers = {
      'Content-Type': 'application/json',
      'X-InlineInsight-Endpoint': chatEndpoint,
      ...(apiKey ? { 'X-InlineInsight-Api-Key': apiKey } : {}),
    };
  } else {
    url = chatEndpoint;
    headers = {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
  }
  response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(chatBody),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Inline Insight API error ${response.status}: ${errorBody}`);
  }

  if (!response.body) {
    throw new Error('Inline Insight: response body is null');
  }

  // handle Stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() ?? '';

      // Preserve any incomplete trailing frame in `sseBuffer`; only fully separated lines
      // are safe to parse as SSE events.
      for (const line of lines) {
        const delta = extractInlineInsightStreamDeltaFromSseLine(line);
        if (delta.reasoning) {
          yield { type: 'reasoning', text: delta.reasoning };
        }
        if (delta.content) {
          yield { type: 'content', text: delta.content };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
