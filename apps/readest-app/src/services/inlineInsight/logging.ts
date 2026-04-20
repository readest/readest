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
  error?: string;
  status?: number;
  durationMs?: number;
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
  return text
    .split('\n')
    .map((line) => extractDeltaFromSseLine(line))
    .join('');
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
  if (!isRecord(parsed) || !Array.isArray(parsed['choices'])) return '';

  const choice = parsed['choices'][0];
  if (!isRecord(choice)) return '';

  if (isRecord(choice['delta']) && typeof choice['delta']['content'] === 'string') {
    return choice['delta']['content'];
  }
  if (isRecord(choice['message']) && typeof choice['message']['content'] === 'string') {
    return choice['message']['content'];
  }
  return '';
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
