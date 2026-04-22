import { isWebAppPlatform } from '@/services/environment';
import { TRANSLATOR_LANGS } from '@/services/constants';
import { InlineInsightCacheInput, readInlineInsightCache, writeInlineInsightCache } from './cache';
import {
  extractInlineInsightStreamDeltaFromSseLine,
  type InlineInsightChatMessage,
} from './logging';
import type { InlineInsightSettings } from './types';
import {
  getInlineInsightChatEndpoint,
  getMinimalThinkingParams,
  inlineInsightProviderSupportsApiKey,
} from './providers';

export type InlineInsightStreamChunk =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string };

export const INLINE_INSIGHT_SEPARATOR = '===DETAILS===';

export const SYSTEM_PROMPT = `You are a reading assistant. The user selected text from a book, but may not have asked an explicit question.
Infer the most likely reading question from the selected text and surrounding context, then answer strictly in the target language specified in the user message.
The context, selected text, question directions, and examples may use another language. Do not follow their language. The final output must use only the target language.

Rules:
- Output a single JSON object only. No markdown, no code fences, no prose before or after JSON.
- Start output immediately with {"brief":[
- The root object must contain exactly two keys in this order: "brief", then "details"
- "brief" must be an array of objects: {"label":"...","content":"..."}
- "details" must be an array of objects: {"label":"...","content":"..."}
- Generate every brief item first, then generate every detail item
- Keep the same labels and the same order in both arrays
- Each brief content must be one concise sentence
- Each detail content must be 2-4 sentences and must add useful context beyond the brief content
- Labels should be short categories such as "meaning", "background", "translation", "person", "place", "allusion"
- Give the answer directly; do not output <think>, reasoning traces, or internal thoughts
- Language: you must use the target language specified in the user message. If the context language differs from the target language, still answer only in the target language. This includes "label" and "content" values.

<example>
{"brief":[{"label":"Meaning","content":"Systematic knowledge verified by reason, distinct from opinion or craft."}],"details":[{"label":"Meaning","content":"Episteme refers to knowledge validated through logical argument, in contrast with doxa or techne. Plato used it for knowledge of enduring truths, and Foucault later reused the term for the hidden framework that shapes thought in a historical era."}]}
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
): AsyncGenerator<InlineInsightStreamChunk> {
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
): AsyncGenerator<InlineInsightStreamChunk> {
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
