import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { query, type RequestParams } from '@/utils/deepl';

describe('deepl query', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a POST request to the DeepL API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          texts: [{ text: 'Bonjour', alternatives: [] }],
          lang: 'EN',
          lang_is_confident: true,
          detectedLanguages: {},
        },
      }),
    });

    const params: RequestParams = {
      text: 'Hello',
      sourceLang: 'en',
      targetLang: 'fr',
    };

    await query(params);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://www2.deepl.com/jsonrpc');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    // Verify body is valid JSON with correct structure
    const body = JSON.parse(options.body);
    expect(body.method).toBe('LMT_handle_texts');
    expect(body.params.texts[0].text).toBe('Hello');
    expect(body.params.lang.source_lang_user_selected).toBe('EN');
    expect(body.params.lang.target_lang).toBe('FR');
  });

  it('returns translated text from the response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          texts: [{ text: 'Hola', alternatives: [{ text: 'Hola!' }] }],
          lang: 'EN',
          lang_is_confident: true,
          detectedLanguages: {},
        },
      }),
    });

    const result = await query({
      text: 'Hello',
      sourceLang: 'en',
      targetLang: 'es',
    });

    expect(result.translations).toHaveLength(1);
    expect(result.translations[0]!.text).toBe('Hola');
    expect(result.translations[0]!.detected_source_language).toBe('EN');
  });

  it('returns sourceLang as detected language when result.lang is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          texts: [{ text: 'Translated', alternatives: [] }],
          lang: '',
          lang_is_confident: false,
          detectedLanguages: {},
        },
      }),
    });

    const result = await query({
      text: 'Test',
      sourceLang: 'auto',
      targetLang: 'de',
    });

    expect(result.translations[0]!.detected_source_language).toBe('auto');
  });

  it('returns empty text when result texts are empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          texts: [],
          lang: 'EN',
          lang_is_confident: true,
          detectedLanguages: {},
        },
      }),
    });

    const result = await query({
      text: '',
      sourceLang: 'en',
      targetLang: 'fr',
    });

    expect(result.translations[0]!.text).toBe('');
  });

  it('throws on 429 Too Many Requests', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
    });

    await expect(query({ text: 'Hi', sourceLang: 'en', targetLang: 'fr' })).rejects.toThrow(
      'Too many requests',
    );
  });

  it('throws generic error on other non-OK status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(query({ text: 'Hi', sourceLang: 'en', targetLang: 'fr' })).rejects.toThrow(
      'Unknown error.',
    );
  });

  it('applies method spacing hack based on id modulo', () => {
    // The function modifies spacing around "method" in the JSON body.
    // We test this by calling query multiple times and checking the body format.
    // Since id is random, we verify the body is always valid JSON.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          texts: [{ text: 'OK', alternatives: [] }],
          lang: 'EN',
          lang_is_confident: true,
          detectedLanguages: {},
        },
      }),
    });

    const promises = Array.from({ length: 10 }, () =>
      query({ text: 'test', sourceLang: 'en', targetLang: 'fr' }),
    );

    // All should succeed without JSON parse errors
    return Promise.all(promises).then(() => {
      for (const call of mockFetch.mock.calls) {
        const body = call[1].body;
        expect(() => JSON.parse(body)).not.toThrow();
      }
    });
  });

  it('computes timestamp based on "i" count in text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          texts: [{ text: 'result', alternatives: [] }],
          lang: 'EN',
          lang_is_confident: true,
          detectedLanguages: {},
        },
      }),
    });

    // Text with multiple "i"s should have a special timestamp computation
    await query({ text: 'initial input is interesting', sourceLang: 'en', targetLang: 'fr' });
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(typeof body.params.timestamp).toBe('number');
    expect(body.params.timestamp).toBeGreaterThan(0);
  });
});
