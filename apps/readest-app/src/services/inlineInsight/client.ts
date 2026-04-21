import { isTauriAppPlatform } from '@/services/environment';
import type { InlineInsightSettings } from './types';
import {
  buildInlineInsightCacheKey,
  readInlineInsightCache,
  writeInlineInsightCache,
} from './cache';
import type { InlineInsightChatMessage, InlineInsightLogEntry } from './logging';
import {
  getInlineInsightChatEndpoint,
  getInlineInsightThinkingControlParams,
  normalizeBaseUrl,
  normalizeInlineInsightProvider,
  inlineInsightProviderSupportsApiKey,
} from './providers';

export const INLINE_INSIGHT_SEPARATOR = '===DETAILS===';

export type InlineInsightCallLogger = (entry: InlineInsightLogEntry) => void | Promise<void>;

export function isInlineInsightDebugLoggingEnabled(): boolean {
  return process.env['NEXT_PUBLIC_INLINE_INSIGHT_DEBUG_LOGGING'] === 'true';
}

export const SYSTEM_PROMPT = `You are a reading assistant. The user selected text from a book, but may not have asked an explicit question.
Infer the most likely reading question from the selected text and surrounding context, then answer strictly in the target language specified in the user message.
The context, selected text, question directions, and examples may use another language. Do not follow their language. The final output must use only the target language.

### Common Insight Types (Tags)
- Unfamiliar term or proper noun -> meaning
- Rare character or word -> pronunciation
- Non-modern or difficult prose -> translation
- Person, place, historical event, allusion, metaphor, or literary function -> concise explanation

### Output Format

The output must have exactly two sections, separated by a single line containing ===DETAILS===.

First section: one short line for each insight:
[tag] One concise sentence.

===DETAILS===

Second section: one detailed paragraph for each insight, in the same order:
[tag] 2-4 sentences with explanation, background, or deeper meaning.

Rules:
- Tags: examples include meaning, background, idiom, person, place, translation, allusion
- Brief lines: avoid filler such as "This means..." or "It refers to..."
- Details: do not merely repeat the brief line
- Plain text only: no markdown and no code blocks
- Give the answer directly; do not output <think>, reasoning traces, or internal thoughts
- Language: you must use the target language specified in the user message. If the context language differs from the target language, still answer only in the target language. This includes the text inside [] tags.

Example:
[meaning] Systematic knowledge verified by reason, distinct from opinion or craft.

===DETAILS===

[meaning] Episteme (ἐπιστήμη) refers to knowledge validated through logical argument, in contrast with doxa (opinion) or techne (craft or skill). Plato used it for knowledge of eternal truths, while Foucault later reinterpreted it as the implicit framework that structures thought in a historical period.
`;

const FOLLOW_UP_SYSTEM_PROMPT = `You are a reading assistant. The user will ask follow-up questions based on selected text, context, and your previous explanation.
Answer the user's question directly, concisely, and accurately. Use strictly the target language specified in the user message.
The context, selected text, previous answer, and user question may use another language. Do not follow their language. The final output must use only the target language.
Do not output <think>, reasoning traces, or internal thoughts.`;

function formatTargetLanguageInstruction(targetLanguage: string): string {
  return [
    `TARGET LANGUAGE: ${targetLanguage}`,
    `You must write the entire answer in ${targetLanguage}.`,
    `Do not answer in the language of the selected text or context unless it is ${targetLanguage}.`,
  ].join('\n');
}

function formatQuestionDirections(settings: InlineInsightSettings): string {
  const directions = settings.questionDirections.map((item) => item.trim()).filter(Boolean);
  if (directions.length === 0) return '';

  return `Preferred question directions:\n${directions.map((item) => `- ${item}`).join('\n')}`;
}

/**
 * Streams Inline Insight output from an OpenAI-compatible endpoint.
 * Yields raw text delta chunks as they arrive.
 * The output format is two sections separated by INLINE_INSIGHT_SEPARATOR:
 *   brief lines first, then detail paragraphs.
 */
export async function* streamInlineInsight(
  selectedText: string,
  context: string,
  settings: InlineInsightSettings,
  targetLanguage: string,
  signal?: AbortSignal,
  logger?: InlineInsightCallLogger,
): AsyncGenerator<string> {
  const directions = formatQuestionDirections(settings);
  const languageInstruction = formatTargetLanguageInstruction(targetLanguage);
  const systemPrompt = settings.systemPrompt.trim() || SYSTEM_PROMPT;
  const userMessage = [
    languageInstruction,
    directions,
    `Context:\n${context}`,
    `Selected text:\n${selectedText}`,
    languageInstruction,
  ]
    .filter(Boolean)
    .join('\n\n');
  const cacheKey =
    settings.cacheEnabled && !signal?.aborted
      ? buildInlineInsightCacheKey({
          provider: normalizeInlineInsightProvider(settings.provider),
          baseUrl: normalizeBaseUrl(settings.baseUrl),
          model: settings.model,
          questionDirections: settings.questionDirections,
          targetLanguage,
          selectedText,
          context,
        })
      : '';
  const cachedText = cacheKey ? readInlineInsightCache(cacheKey, settings.cacheTtlMinutes) : null;
  if (cachedText) {
    yield cachedText;
    return;
  }

  let responseText = '';
  let completed = false;

  try {
    for await (const delta of streamChatCompletions(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      settings,
      signal,
      logger,
    )) {
      responseText += delta;
      yield delta;
    }
    completed = true;
  } finally {
    if (completed && cacheKey && !signal?.aborted && responseText.trim()) {
      writeInlineInsightCache(cacheKey, responseText);
    }
  }
}

export async function* streamInlineInsightFollowUp(
  question: string,
  selectedText: string,
  context: string,
  previousAnswer: string,
  settings: InlineInsightSettings,
  targetLanguage: string,
  signal?: AbortSignal,
  logger?: InlineInsightCallLogger,
): AsyncGenerator<string> {
  const directions = formatQuestionDirections(settings);
  const languageInstruction = formatTargetLanguageInstruction(targetLanguage);
  const userMessage = [
    languageInstruction,
    directions,
    `Context:\n${context}`,
    `Selected text:\n${selectedText}`,
    previousAnswer.trim() ? `Previous answer:\n${previousAnswer}` : '',
    `Question:\n${question}`,
    languageInstruction,
  ]
    .filter(Boolean)
    .join('\n\n');

  yield* streamChatCompletions(
    [
      { role: 'system', content: FOLLOW_UP_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    settings,
    signal,
    logger,
  );
}

async function* streamChatCompletions(
  messages: InlineInsightChatMessage[],
  settings: InlineInsightSettings,
  signal?: AbortSignal,
  logger?: InlineInsightCallLogger,
): AsyncGenerator<string> {
  const chatEndpoint = getInlineInsightChatEndpoint(settings);
  const apiKey = inlineInsightProviderSupportsApiKey(settings.provider) ? settings.apiKey : '';
  const startedAt = Date.now();
  const timestamp = new Date(startedAt).toISOString();

  const chatBody = {
    model: settings.model,
    messages,
    stream: true,
    temperature: 0.3,
    ...getInlineInsightThinkingControlParams(settings),
  };
  let responseText = '';
  let status: number | undefined;

  try {
    let response: Response;
    if (isTauriAppPlatform()) {
      // Tauri can call the provider directly, which avoids the browser's CORS restrictions.
      response = await fetch(chatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(chatBody),
        signal,
      });
    } else {
      // The web build proxies requests through Next.js so custom endpoints and API keys
      // do not depend on provider-side CORS support.
      response = await fetch('/api/inlineinsight/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: chatEndpoint,
          apiKey: apiKey || undefined,
          body: chatBody,
        }),
        signal,
      });
    }

    status = response.status;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Inline Insight API error ${response.status}: ${errorBody}`);
    }

    if (!response.body) {
      throw new Error('Inline Insight: response body is null');
    }

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
          const delta = extractDeltaFromSseLine(line);
          if (delta) {
            responseText += delta;
            yield delta;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    await logger?.({
      timestamp,
      endpoint: chatEndpoint,
      requestBody: chatBody,
      messages,
      responseText,
      status,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    await logger?.({
      timestamp,
      endpoint: chatEndpoint,
      requestBody: chatBody,
      messages,
      responseText,
      error: error instanceof Error ? error.message : 'Inline Insight request failed',
      status,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

function extractDeltaFromSseLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return '';
  const data = trimmed.slice(5).trim();
  if (!data || data === '[DONE]') return '';

  try {
    return extractDelta(JSON.parse(data));
  } catch {
    return '';
  }
}

function extractDelta(parsed: unknown): string {
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'choices' in parsed &&
    Array.isArray((parsed as Record<string, unknown>)['choices'])
  ) {
    const choices = (parsed as { choices: unknown[] }).choices;
    if (choices.length > 0) {
      const choice = choices[0];
      if (choice !== null && typeof choice === 'object' && 'delta' in choice) {
        const delta = (choice as { delta: unknown }).delta;
        if (
          delta !== null &&
          typeof delta === 'object' &&
          'content' in delta &&
          typeof (delta as { content: unknown }).content === 'string'
        ) {
          return (delta as { content: string }).content;
        }
      }
      if (choice !== null && typeof choice === 'object' && 'message' in choice) {
        const message = (choice as { message: unknown }).message;
        if (
          message !== null &&
          typeof message === 'object' &&
          'content' in message &&
          typeof (message as { content: unknown }).content === 'string'
        ) {
          return (message as { content: string }).content;
        }
      }
    }
  }
  return '';
}
