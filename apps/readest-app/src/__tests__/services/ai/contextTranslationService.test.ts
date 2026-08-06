import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextTranslationError } from '@/services/ai/contextTranslationTypes';
import {
  clearContextTranslationCache,
  requestContextTranslation,
} from '@/services/ai/contextTranslationService';

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn<typeof fetch>(),
}));

vi.mock('@/services/ai/utils/httpFetch', () => ({
  getAIFetch: () => mockFetch,
}));

const input = {
  selectedText: 'requires',
  beforeContext: 'Text often',
  afterContext: 'careful reading.',
  sentence: 'Text often requires careful reading.',
  targetLanguage: 'Vietnamese',
  detailLevel: 'normal' as const,
};

const settings = {
  baseUrl: 'https://example.test/v1/',
  apiKey: 'sk-secret-key',
  modelId: 'gpt-test',
  targetLanguage: 'Vietnamese',
  maxContextChars: 2000,
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

const completionBody = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          mode: 'normal',
          headword: 'requires',
          translation: 'đòi hỏi',
          explanation: 'Nghĩa theo ngữ cảnh.',
        }),
      },
    },
  ],
};

describe('requestContextTranslation', () => {
  beforeEach(() => {
    clearContextTranslationCache();
    mockFetch.mockReset();
  });

  it('calls chat completions with normalized URL and bearer token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(completionBody));

    const result = await requestContextTranslation(input, settings);

    expect(result).toEqual({
      mode: 'normal',
      headword: 'requires',
      translation: 'đòi hỏi',
      explanation: 'Nghĩa theo ngữ cảnh.',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer sk-secret-key',
        'Content-Type': 'application/json',
      }),
    );
    expect(JSON.parse(init?.body as string)).toEqual(
      expect.objectContaining({
        model: 'gpt-test',
        temperature: 0.2,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
      }),
    );
  });

  it('returns cached results for the same request', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(completionBody));

    const first = await requestContextTranslation(input, settings);
    const second = await requestContextTranslation(input, settings);

    expect(second).toEqual(first);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('maps 429 to rate limit error without leaking API key', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'Too many requests' } }, { status: 429 }));

    await expect(requestContextTranslation(input, settings)).rejects.toSatisfy((error: unknown) => {
      expect(error).toMatchObject({ code: 'rate-limited', retryable: true });
      expect(error instanceof Error ? error.message : String(error)).not.toContain('sk-secret-key');
      return true;
    });
  });

  it('throws not-configured when required settings are missing', async () => {
    await expect(
      requestContextTranslation(input, { ...settings, apiKey: '  ' }),
    ).rejects.toBeInstanceOf(ContextTranslationError);
    await expect(
      requestContextTranslation(input, { ...settings, apiKey: '  ' }),
    ).rejects.toMatchObject({ code: 'not-configured', retryable: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
