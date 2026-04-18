import { isTauriAppPlatform } from '@/services/environment';
import type { SmartAskSettings } from './types';

export const SMART_ASK_SEPARATOR = '===DETAILS===';

const SYSTEM_PROMPT = `你是一位阅读助手。用户从一本书中选取了一段文字，但没有明确提出问题。
你需要根据选取的问题，猜测用户的问题，并用读者的语言回答。

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
- 标签：1-2 个词的名词，例如：含义、背景、意义、关联、启示
- 简述：不要使用"这是指……"或"它的意思是……"等废话
- 详述：不要重复简述的内容
- 纯文本输出 — 不使用 markdown，不使用代码块

示例：
[含义] 通过理性验证的系统性知识，有别于意见或技艺。
[意义] 为"真正的理解需要超越继承的信念"这一论点奠定基础。

===DETAILS===

[含义] Episteme（ἐπιστήμη）指通过逻辑论证验证的知识，与 doxa（意见）或 techne（技艺技能）相对。柏拉图用它指对永恒真理的认识；福柯后来将其重新诠释为界定某一历史时代思想结构的隐性框架。

[意义] Doxa 是由感知和社会环境塑造的意见，而 episteme 则通过理性主张普遍有效性。这种对比揭示了论点的核心：继承的假设无法作为真正知识的基础。`;

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
): AsyncGenerator<string> {
  const baseUrl = settings.baseUrl.replace(/\/$/, '');
  const chatEndpoint = `${baseUrl}/v1/chat/completions`;

  const userMessage = `Answer in language: ${uiLanguage}\n\nContext:\n${context}\n\nSelected text:\n${selectedText}`;

  const chatBody = {
    model: settings.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    stream: true,
    temperature: 0.3,
  };

  let response: Response;
  if (isTauriAppPlatform()) {
    response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
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
        apiKey: settings.apiKey || undefined,
        body: chatBody,
      }),
      signal,
    });
  }

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
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed: unknown = JSON.parse(data);
          const delta = extractDelta(parsed);
          if (delta) yield delta;
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  } finally {
    reader.releaseLock();
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
    }
  }
  return '';
}
