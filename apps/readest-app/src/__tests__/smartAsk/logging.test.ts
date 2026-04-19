import { describe, expect, it } from 'vitest';
import {
  createSmartAskLogFilename,
  extractSmartAskDeltaFromSseText,
  formatSmartAskLog,
  getSmartAskMessagesFromBody,
} from '@/services/smartAsk/logging';

describe('Inline Insight logging', () => {
  it('builds filesystem-safe markdown filenames', () => {
    expect(createSmartAskLogFilename(new Date('2026-04-18T09:25:17.869Z'))).toBe(
      '2026-04-18T09-25-17-869Z.md',
    );
  });

  it('formats request and response details as markdown', () => {
    const body = {
      model: 'qwen',
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
    };
    const markdown = formatSmartAskLog({
      timestamp: '2026-04-18T09:25:17.869Z',
      endpoint: 'http://localhost:1234/api/v0/chat/completions',
      requestBody: body,
      messages: getSmartAskMessagesFromBody(body),
      responseText: 'answer',
      status: 200,
      durationMs: 123,
    });

    expect(markdown).toContain('# Inline Insight Debug Log');
    expect(markdown).toContain('**Model**: qwen');
    expect(markdown).toContain('## System');
    expect(markdown).toContain('system prompt');
    expect(markdown).toContain('## User');
    expect(markdown).toContain('user prompt');
    expect(markdown).toContain('## Response');
    expect(markdown).toContain('answer');
  });

  it('extracts streamed chat deltas from SSE text', () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: [DONE]',
    ].join('\n');

    expect(extractSmartAskDeltaFromSseText(sse)).toBe('hello');
  });
});
