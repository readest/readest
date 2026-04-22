import { isWebAppPlatform } from '@/services/environment';
import { TRANSLATOR_LANGS } from '@/services/constants';
import { InlineInsightCacheInput, readInlineInsightCache, writeInlineInsightCache } from './cache';
import type { InlineInsightChatMessage } from './logging';
import type { InlineInsightSettings } from './types';
import {
  getInlineInsightChatEndpoint,
  getMinimalThinkingParams,
  inlineInsightProviderSupportsApiKey,
} from './providers';

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

export const INLINE_INSIGHT_SEPARATOR = '===DETAILS===';

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

<example>
[Meaning] Systematic knowledge verified by reason, distinct from opinion or craft.

===DETAILS===

[Meaning] Episteme (ἐπιστήμη) refers to knowledge validated through logical argument, in contrast with doxa (opinion) or techne (craft or skill). Plato used it for knowledge of eternal truths, while Foucault later reinterpreted it as the implicit framework that structures thought in a historical period.
</example>
`;

const FOLLOW_UP_SYSTEM_PROMPT = `You are a reading assistant. The user will ask follow-up questions based on selected text, context, and your previous explanation.
Answer the user's question directly, concisely, and accurately. Use strictly the target language specified in the user message.
The context, selected text, previous answer, and user question may use another language. Do not follow their language. The final output must use only the target language.
Do not output <think>, reasoning traces, or internal thoughts.`;

function formatTargetLanguageLabel(targetLanguage: string): string {
  const normalized = targetLanguage.trim();
  if (!normalized) return 'the requested language';

  return TRANSLATOR_LANGS[normalized as keyof typeof TRANSLATOR_LANGS] ?? normalized;
}

function formatTargetLanguageInstruction(targetLanguage: string): string {
  const targetLanguageLabel = formatTargetLanguageLabel(targetLanguage);
  return [
    `TARGET LANGUAGE: ${targetLanguageLabel}`,
    `You must write the entire answer in ${targetLanguageLabel}.`,
    `Do not answer in the language of the selected text or context unless it is ${targetLanguageLabel}.`,
  ].join('\n');
}

function formatQuestionDirections(settings: InlineInsightSettings): string {
  const directions = settings.questionDirections.map((item) => item.trim()).filter(Boolean);
  if (directions.length === 0) return '';

  return `Preferred question directions:\n${directions.map((item) => `- ${item}`).join('\n')}`;
}

function buildMessages(items: string[]): string {
  return items.filter(Boolean).join('\n\n');
}

function buildInlineInsightCacheKey(
  settings: InlineInsightSettings,
  messages: InlineInsightChatMessage[],
): string {
  return new InlineInsightCacheInput(
    settings.provider,
    settings.baseUrl,
    settings.model,
    messages,
  ).buildKey();
}

async function* streamInlineInsightCached(
  messages: InlineInsightChatMessage[],
  settings: InlineInsightSettings,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const cacheKey = buildInlineInsightCacheKey(settings, messages);
  if (settings.cacheEnabled) {
    const cachedText = readInlineInsightCache(cacheKey, settings.cacheTtlMinutes);
    if (cachedText) {
      yield cachedText;
      return;
    }
  }

  let responseText = '';
  let completed = false;

  try {
    for await (const delta of streamChatCompletions(messages, settings, signal)) {
      responseText += delta;
      yield delta;
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
 * The output format is two sections separated by INLINE_INSIGHT_SEPARATOR:
 *   brief lines first, then detail paragraphs.
 */
export async function* streamInlineInsight(
  selectedText: string,
  context: string,
  settings: InlineInsightSettings,
  targetLanguage: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const directions = formatQuestionDirections(settings);
  const languageInstruction = formatTargetLanguageInstruction(targetLanguage);
  const systemPrompt = settings.systemPrompt.trim() || SYSTEM_PROMPT;
  const messages: InlineInsightChatMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: buildMessages([
        languageInstruction,
        directions,
        `Context:\n${context}`,
        `Selected text:\n${selectedText}`,
        languageInstruction,
      ]),
    },
  ];
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
): AsyncGenerator<string> {
  const directions = formatQuestionDirections(settings);
  const languageInstruction = formatTargetLanguageInstruction(targetLanguage);
  previousAnswer = previousAnswer.trim();

  const messages: InlineInsightChatMessage[] = [
    {
      role: 'system',
      content: FOLLOW_UP_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: buildMessages([
        languageInstruction,
        directions,
        `Context:\n${context}`,
        `Selected text:\n${selectedText}`,
        `Previous answer:\n${previousAnswer}`,
        `Question:\n${question}`,
        languageInstruction,
      ]),
    },
  ];
  yield* streamInlineInsightCached(messages, settings, signal);
}

async function* streamChatCompletions(
  messages: InlineInsightChatMessage[],
  settings: InlineInsightSettings,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const chatEndpoint = getInlineInsightChatEndpoint(settings);
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
        const delta = extractDeltaFromSseLine(line);
        if (delta) {
          yield delta;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
