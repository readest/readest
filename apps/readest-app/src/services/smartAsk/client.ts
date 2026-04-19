import { isTauriAppPlatform } from '@/services/environment';
import type { SmartAskSettings } from './types';
import { buildSmartAskCacheKey, readSmartAskCache, writeSmartAskCache } from './cache';
import type { SmartAskChatMessage, SmartAskLogEntry } from './logging';
import {
  getSmartAskChatEndpoint,
  getSmartAskThinkingControlParams,
  normalizeBaseUrl,
  normalizeSmartAskProvider,
  smartAskProviderSupportsApiKey,
} from './providers';

export const SMART_ASK_SEPARATOR = '===DETAILS===';

export type SmartAskCallLogger = (entry: SmartAskLogEntry) => void | Promise<void>;

const SYSTEM_PROMPT = `你是一位阅读助手。用户从一本书中选取了一段文字，但没有明确提出问题。
你需要根据选取的文字和上下文，猜测用户最可能的问题，并用读者的语言回答。

### 常见问题类型
- 出现较为生僻，或者为专有名词 -> 含义
- 生僻字 -> 注音
- 非白话文 -> 翻译

### 格式

输出内容必须严格分为两个部分，以 ===DETAILS=== 这一行分隔。

第一部分 — 每条洞见一行简短说明：
[标签] 一句简洁的话，尽可能精炼。

===DETAILS===

第二部分 — 每条洞见一段详细说明，顺序与第一部分一致：
[标签] 2-4 句话，包含具体解释、背景或深层含义。

规则：
- 标签：如含义、背景、成语、人物、地点
- 简述：不要使用"这是指……"或"它的意思是……"等废话
- 详述：不要重复简述的内容
- 纯文本输出 — 不使用 markdown，不使用代码块
- 直接给出结果，不输出 <think>、推理过程或内部思考

示例：
[含义] 通过理性验证的系统性知识，有别于意见或技艺。

===DETAILS===

[含义] Episteme（ἐπιστήμη）指通过逻辑论证验证的知识，与 doxa（意见）或 techne（技艺技能）相对。柏拉图用它指对永恒真理的认识；福柯后来将其重新诠释为界定某一历史时代思想结构的隐性框架。
`;

const FOLLOW_UP_SYSTEM_PROMPT = `你是一位阅读助手。用户会基于选中文字、上下文和你之前的解释继续提问。
请直接回答用户问题，保持简洁、准确，并优先使用用户的语言。
不要输出 <think>、推理过程或内部思考。`;

function formatQuestionDirections(settings: SmartAskSettings): string {
  const directions = settings.questionDirections.map((item) => item.trim()).filter(Boolean);
  if (directions.length === 0) return '';

  return `Preferred question directions:\n${directions.map((item) => `- ${item}`).join('\n')}`;
}

/**
 * Streams SmartAsk insights from an OpenAI-compatible endpoint.
 * Yields raw text delta chunks as they arrive.
 * The output format is two sections separated by SMART_ASK_SEPARATOR:
 *   brief lines first, then detail paragraphs.
 */
export async function* streamSmartAsk(
  selectedText: string,
  context: string,
  settings: SmartAskSettings,
  uiLanguage: string,
  signal?: AbortSignal,
  logger?: SmartAskCallLogger,
): AsyncGenerator<string> {
  const directions = formatQuestionDirections(settings);
  const userMessage = [
    `Answer in language: ${uiLanguage}`,
    directions,
    `Context:\n${context}`,
    `Selected text:\n${selectedText}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const cacheKey =
    settings.cacheEnabled && !signal?.aborted
      ? buildSmartAskCacheKey({
          provider: normalizeSmartAskProvider(settings.provider),
          baseUrl: normalizeBaseUrl(settings.baseUrl),
          model: settings.model,
          questionDirections: settings.questionDirections,
          uiLanguage,
          selectedText,
          context,
        })
      : '';
  const cachedText = cacheKey ? readSmartAskCache(cacheKey, settings.cacheTtlMinutes) : null;
  if (cachedText) {
    yield cachedText;
    return;
  }

  let responseText = '';
  let completed = false;

  try {
    for await (const delta of streamChatCompletions(
      [
        { role: 'system', content: SYSTEM_PROMPT },
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
      writeSmartAskCache(cacheKey, responseText);
    }
  }
}

export async function* streamSmartAskFollowUp(
  question: string,
  selectedText: string,
  context: string,
  previousAnswer: string,
  settings: SmartAskSettings,
  uiLanguage: string,
  signal?: AbortSignal,
  logger?: SmartAskCallLogger,
): AsyncGenerator<string> {
  const directions = formatQuestionDirections(settings);
  const userMessage = [
    `Answer in language: ${uiLanguage}`,
    directions,
    `Context:\n${context}`,
    `Selected text:\n${selectedText}`,
    previousAnswer.trim() ? `Previous answer:\n${previousAnswer}` : '',
    `Question:\n${question}`,
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
  messages: SmartAskChatMessage[],
  settings: SmartAskSettings,
  signal?: AbortSignal,
  logger?: SmartAskCallLogger,
): AsyncGenerator<string> {
  const chatEndpoint = getSmartAskChatEndpoint(settings);
  const apiKey = smartAskProviderSupportsApiKey(settings.provider) ? settings.apiKey : '';
  const startedAt = Date.now();
  const timestamp = new Date(startedAt).toISOString();

  const chatBody = {
    model: settings.model,
    messages,
    stream: true,
    temperature: 0.3,
    ...getSmartAskThinkingControlParams(settings),
  };
  let responseText = '';
  let status: number | undefined;

  try {
    let response: Response;
    if (isTauriAppPlatform()) {
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
      response = await fetch('/api/smartask/chat', {
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
      throw new Error(`SmartAsk API error ${response.status}: ${errorBody}`);
    }

    if (!response.body) {
      throw new Error('SmartAsk: response body is null');
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
      error: error instanceof Error ? error.message : 'SmartAsk request failed',
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
