export type InlineInsightChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export interface InlineInsightLogEntry {
  timestamp: string;
  endpoint: string;
  requestBody: unknown;
  messages: InlineInsightChatMessage[];
  responseText?: string;
  reasoningText?: string;
  error?: string;
  status?: number;
  durationMs?: number;
}

export interface InlineInsightStreamDelta {
  content: string;
  reasoning: string;
}

export function createInlineInsightLogFilename(date = new Date()): string {
  return `${date.toISOString().replace(/[:.]/g, '-')}.md`;
}

export function formatInlineInsightLog(entry: InlineInsightLogEntry): string {
  const body = isRecord(entry.requestBody) ? entry.requestBody : {};
  const model = typeof body['model'] === 'string' ? body['model'] : '';
  const temperature =
    typeof body['temperature'] === 'number' || typeof body['temperature'] === 'string'
      ? String(body['temperature'])
      : '';

  return [
    '# Inline Insight Debug Log',
    '',
    `**Time**: ${entry.timestamp}`,
    `**Endpoint**: ${entry.endpoint}`,
    model ? `**Model**: ${model}` : '',
    temperature ? `**Temperature**: ${temperature}` : '',
    typeof entry.status === 'number' ? `**Status**: ${entry.status}` : '',
    typeof entry.durationMs === 'number' ? `**Duration**: ${entry.durationMs}ms` : '',
    '',
    ...entry.messages.flatMap((message) => [
      `## ${formatRole(message.role)}`,
      '',
      message.content,
      '',
    ]),
    '## Request Body',
    '',
    '```json',
    JSON.stringify(entry.requestBody, null, 2),
    '```',
    '',
    entry.error ? '## Error' : '## Response',
    '',
    entry.error ?? entry.responseText ?? '',
    '',
    entry.reasoningText ? ['## Reasoning', '', entry.reasoningText, ''].join('\n') : '',
  ].join('\n');
}

export function getInlineInsightMessagesFromBody(body: unknown): InlineInsightChatMessage[] {
  if (!isRecord(body) || !Array.isArray(body['messages'])) return [];

  return body['messages'].flatMap((message) => {
    if (!isRecord(message)) return [];
    const role = message['role'];
    const content = message['content'];
    if (!isInlineInsightRole(role) || typeof content !== 'string') return [];
    return [{ role, content }];
  });
}

export function extractInlineInsightDeltaFromSseText(text: string): string {
  return extractInlineInsightStreamDeltaFromSseText(text).content;
}

export function extractInlineInsightStreamDeltaFromSseText(text: string): InlineInsightStreamDelta {
  // Some providers flush multiple SSE frames in a single chunk, so parse line-by-line and
  // concatenate only the text-bearing deltas.
  return text.split('\n').reduce(
    (result, line) => {
      const delta = extractInlineInsightStreamDeltaFromSseLine(line);
      result.content += delta.content;
      result.reasoning += delta.reasoning;
      return result;
    },
    { content: '', reasoning: '' } satisfies InlineInsightStreamDelta,
  );
}

export function extractInlineInsightStreamDeltaFromSseLine(line: string): InlineInsightStreamDelta {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return { content: '', reasoning: '' };
  const data = trimmed.slice(5).trim();
  if (!data || data === '[DONE]') return { content: '', reasoning: '' };

  try {
    return extractInlineInsightStreamDelta(JSON.parse(data));
  } catch {
    return { content: '', reasoning: '' };
  }
}

function extractInlineInsightStreamDelta(parsed: unknown): InlineInsightStreamDelta {
  if (!isRecord(parsed) || !Array.isArray(parsed['choices'])) {
    return { content: '', reasoning: '' };
  }

  const choice = parsed['choices'][0];
  if (!isRecord(choice)) return { content: '', reasoning: '' };
  const delta = isRecord(choice['delta']) ? choice['delta'] : null;
  const message = isRecord(choice['message']) ? choice['message'] : null;

  return {
    // Streaming responses usually emit `delta.content`, while some compatible endpoints only
    // send `message.content` in the final event. Support both shapes in one parser.
    content: extractTextField(delta, ['content']) || extractTextField(message, ['content']),
    reasoning:
      extractTextField(delta, ['reasoning_content', 'reasoning', 'thinking']) ||
      extractTextField(message, ['reasoning_content', 'reasoning', 'thinking']),
  };
}

function formatRole(role: InlineInsightChatMessage['role']): string {
  switch (role) {
    case 'system':
      return 'System';
    case 'user':
      return 'User';
    case 'assistant':
      return 'Assistant';
  }
}

function isInlineInsightRole(value: unknown): value is InlineInsightChatMessage['role'] {
  return value === 'system' || value === 'user' || value === 'assistant';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function extractTextField(container: Record<string, unknown> | null, keys: string[]): string {
  if (!container) return '';
  for (const key of keys) {
    const text = readTextLikeValue(container[key]);
    if (text) return text;
  }
  return '';
}

function readTextLikeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => readTextLikeValue(item)).join('');
  }
  if (isRecord(value)) {
    if (typeof value['text'] === 'string') return value['text'];
    if (typeof value['content'] === 'string') return value['content'];
    if (typeof value['value'] === 'string') return value['value'];
  }
  return '';
}
