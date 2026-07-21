import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';

// Mock environment module
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => false),
  getAPIBaseUrl: vi.fn(() => 'https://api.example.com'),
}));

vi.mock('@/utils/misc', () => ({
  stubTranslation: (s: string) => s,
}));

vi.mock('@/utils/lang', () => ({
  normalizeToShortLang: vi.fn((lang: string) => {
    const map: Record<string, string> = {
      'en-US': 'en',
      'fr-FR': 'fr',
      'zh-CN': 'zh',
      AUTO: 'auto',
      en: 'en',
      fr: 'fr',
      de: 'de',
      zh: 'zh',
      auto: 'auto',
    };
    return map[lang] ?? lang;
  }),
  normalizeToFullLang: vi.fn((lang: string) => {
    const map: Record<string, string> = {
      en: 'en',
      fr: 'fr',
      de: 'de',
      zh: 'zh-Hans',
      auto: 'auto',
    };
    return map[lang] ?? lang;
  }),
}));

// Mock Tauri HTTP plugin
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

// Stub Supabase so importing the full providers registry (which pulls in
// deepl.ts → @/utils/access → @/utils/supabase) doesn't instantiate a real
// GoTrueClient on every `vi.resetModules()` round. Without this, each test
// that dynamically imports the registry logs a "Multiple GoTrueClient
// instances" warning from the real Supabase client.
vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Google Translate Provider
// ---------------------------------------------------------------------------
describe('googleProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for empty input', async () => {
    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate([], 'en', 'fr');
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('translates text array', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [[['Bonjour', 'Hello']]],
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Bonjour']);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('preserves empty strings in input', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [[['translated', 'original']]],
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate(['', 'Hello'], 'en', 'fr');
    expect(result[0]).toBe('');
    expect(result[1]).toBe('translated');
  });

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    await expect(googleProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'Translation failed with status 500',
    );
  });

  it('falls back to original text when response format is unexpected', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Hello']);
  });

  it('has correct provider metadata', async () => {
    const { googleProvider } = await import('@/services/translators/providers/google');
    expect(googleProvider.name).toBe('google');
    expect(googleProvider.label).toBe('Google Translate');
  });
});

// ---------------------------------------------------------------------------
// Yandex Translate Provider
// ---------------------------------------------------------------------------
describe('yandexProvider', () => {
  const mockTauriFetch = vi.mocked(tauriFetch);

  const sessionResponse = () => ({
    ok: true,
    status: 200,
    json: async () => ({
      session: {
        id: 'test-session-id',
        creationTimestamp: Math.floor(Date.now() / 1000),
        maxAge: 604800,
      },
    }),
  });

  const translateCalls = () =>
    mockTauriFetch.mock.calls.filter(([url]) => String(url).includes('/tr.json/translate'));
  const sessionCalls = () =>
    mockTauriFetch.mock.calls.filter(([url]) => String(url).includes('/sessions'));

  /** Routes session and translate requests to the given mock responses. */
  function mockYandexFlow(translateJson: (text: string) => unknown) {
    mockTauriFetch.mockImplementation(async (url, init) => {
      if (String(url).includes('/sessions')) return sessionResponse() as unknown as Response;
      const text = new URLSearchParams((init?.body as string) ?? '').get('text') ?? '';
      return {
        ok: true,
        status: 200,
        json: async () => translateJson(text),
      } as unknown as Response;
    });
  }

  beforeEach(() => {
    mockTauriFetch.mockReset();
    mockFetch.mockReset();
    // The provider calls Yandex directly on Tauri and via the same-origin
    // proxy on web — default to the Tauri path in these tests
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    // Reset the module-level session cache between tests by re-importing
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for empty input', async () => {
    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate([], 'en', 'fr');
    expect(result).toEqual([]);
    expect(mockTauriFetch).not.toHaveBeenCalled();
  });

  it('translates text via the direct yandex API', async () => {
    mockYandexFlow(() => ({ code: 200, lang: 'en-fr', text: ['Bonjour'] }));

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Bonjour']);

    // Verify session + translate request format
    expect(sessionCalls()).toHaveLength(1);
    expect(String(sessionCalls()[0]![0])).toContain('https://translate.yandex.ru/');

    expect(translateCalls()).toHaveLength(1);
    const [url, opts] = translateCalls()[0]!;
    expect(String(url)).toContain('https://translate.yandex.net/api/v1/tr.json/translate');
    const query = new URLSearchParams(String(url).split('?')[1]);
    expect(query.get('source_lang')).toBe('en');
    expect(query.get('target_lang')).toBe('fr');
    expect(query.get('sid')).toBe('test-session-id-5-0');
    expect(opts?.method).toBe('POST');
    const body = new URLSearchParams(opts?.body as string);
    expect(body.get('text')).toBe('Hello');
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
  });

  it('routes requests through the same-origin proxy in web builds', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    mockFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
      if (String(url).includes('endpoint=session')) {
        return sessionResponse();
      }
      const text = new URLSearchParams(init?.body ?? '').get('text') ?? '';
      return { ok: true, json: async () => ({ code: 200, lang: 'en-fr', text: [`<${text}>`] }) };
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['<Hello>']);

    const urls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain('/api/yandex-translate?endpoint=session');
    expect(urls[1]).toContain('/api/yandex-translate?endpoint=translate');
    expect(urls[1]).toContain('source_lang=en');
    expect(urls[1]).toContain('target_lang=fr');
    // the browser must not try to set the Referer — the proxy attaches it
    expect(mockTauriFetch).not.toHaveBeenCalled();
  });

  it('uses automatic detection when source language is AUTO', async () => {
    mockYandexFlow(() => ({ code: 200, lang: 'en-fr', text: ['Bonjour'] }));

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await yandexProvider.translate(['Hello'], 'AUTO', 'fr');

    const query = new URLSearchParams(String(translateCalls()[0]![0]).split('?')[1]);
    expect(query.get('source_lang')).toBe('auto');
  });

  it.each(['zh-Hans', 'zh-Hant'])('normalizes Chinese locale %s to zh', async (targetLang) => {
    mockYandexFlow(() => ({ code: 200, text: ['你好'] }));

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await yandexProvider.translate(['Hello'], 'en', targetLang);

    const query = new URLSearchParams(String(translateCalls()[0]![0]).split('?')[1]);
    expect(query.get('target_lang')).toBe('zh');
  });

  it('reuses the yandex session across calls', async () => {
    mockYandexFlow(() => ({ code: 200, lang: 'en-fr', text: ['Bonjour'] }));

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await yandexProvider.translate(['Hello'], 'en', 'fr');
    await yandexProvider.translate(['World'], 'en', 'fr');

    expect(sessionCalls()).toHaveLength(1);
    expect(translateCalls()).toHaveLength(2);
  });

  it('throws when the session request fails', async () => {
    mockTauriFetch.mockResolvedValue({ ok: false, status: 403 } as unknown as Response);

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await expect(yandexProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'yandex session request failed with status 403',
    );
  });

  it('retries once with a fresh session after a session-specific error', async () => {
    let sessionNumber = 0;
    mockTauriFetch.mockImplementation(async (url) => {
      if (String(url).includes('/sessions')) {
        sessionNumber++;
        const response = sessionResponse();
        return {
          ...response,
          json: async () => ({
            session: {
              id: `test-session-${sessionNumber}`,
              creationTimestamp: Math.floor(Date.now() / 1000),
              maxAge: 604800,
            },
          }),
        } as unknown as Response;
      }
      if (translateCalls().length === 1) {
        return {
          ok: false,
          status: 403,
          json: async () => ({ code: 403, message: 'Invalid session' }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 200, text: ['Bonjour'] }),
      } as unknown as Response;
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await expect(yandexProvider.translate(['Hello'], 'en', 'fr')).resolves.toEqual(['Bonjour']);
    expect(sessionCalls()).toHaveLength(2);
    expect(translateCalls()).toHaveLength(2);
  });

  it('does not retry a proxy 403 without a Yandex session error code', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('endpoint=session')) return sessionResponse();
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: 'Forbidden' }),
      };
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await expect(yandexProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'yandex translate failed with status 403: Forbidden',
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws on non-session translate errors without dropping the session', async () => {
    mockTauriFetch.mockImplementation(async (url) => {
      if (String(url).includes('/sessions')) return sessionResponse() as unknown as Response;
      return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await expect(yandexProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'yandex translate failed with status 500',
    );

    mockYandexFlow(() => ({ code: 200, lang: 'en-fr', text: ['Bonjour'] }));
    const result = await yandexProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Bonjour']);
    expect(sessionCalls()).toHaveLength(1);
  });

  it('throws when the translate response shape is unexpected', async () => {
    mockYandexFlow(() => ({ code: 200, text: 'Bonjour' }));

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await expect(yandexProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'yandex translate failed: malformed response',
    );
  });

  it('throws a malformed-response error for a 200 non-JSON response', async () => {
    mockTauriFetch.mockImplementation(async (url) => {
      if (String(url).includes('/sessions')) return sessionResponse() as unknown as Response;
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response;
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await expect(yandexProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'yandex translate failed: malformed response',
    );
  });

  it('rejects a session response with an invalid lifetime', async () => {
    mockTauriFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ session: { id: 'test-session-id' } }),
    } as unknown as Response);

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await expect(yandexProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'yandex session request failed: malformed response',
    );
  });

  it('has correct provider metadata', async () => {
    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    expect(yandexProvider.name).toBe('yandex');
    expect(yandexProvider.label).toBe('Yandex Translate');
    expect(yandexProvider.authRequired).toBe(false);
  });

  it('translates multiple texts in parallel', async () => {
    mockYandexFlow(() => ({ code: 200, lang: 'en-fr', text: ['Translated'] }));

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate(['Hello', 'World'], 'en', 'fr');
    expect(result).toEqual(['Translated', 'Translated']);
    expect(translateCalls()).toHaveLength(2);
    expect(sessionCalls()).toHaveLength(1);
  });

  it('shares a single in-flight session creation across concurrent calls', async () => {
    mockYandexFlow(() => ({ code: 200, lang: 'en-fr', text: ['Translated'] }));

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    // two concurrent calls on a cold session cache: without sharing the
    // in-flight creation, each would open its own session
    const [hello, world] = await Promise.all([
      yandexProvider.translate(['Hello'], 'en', 'fr'),
      yandexProvider.translate(['World'], 'en', 'fr'),
    ]);
    expect(hello).toEqual(['Translated']);
    expect(world).toEqual(['Translated']);
    expect(sessionCalls()).toHaveLength(1);
  });

  it('sends a text under the request limit in a single request', async () => {
    mockYandexFlow(() => ({ code: 200, lang: 'en-fr', text: ['Translated'] }));

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate(['a'.repeat(599)], 'en', 'fr');
    expect(result).toEqual(['Translated']);
    expect(translateCalls()).toHaveLength(1);
  });

  it('splits an oversized text into chunks within the request limit', async () => {
    mockYandexFlow((text) => ({ code: 200, lang: 'en-fr', text: [`<${text.length}>`] }));

    // ~3k chars of sentence-like content, no sentence boundary at the exact cut
    const sentence = 'This is a fairly long sentence used for chunking tests. ';
    const text = sentence.repeat(60);
    expect(text.length).toBeGreaterThan(600);

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate([text], 'en', 'fr');

    expect(result).toHaveLength(1);
    expect(translateCalls().length).toBeGreaterThan(1);
    const sentTexts = translateCalls().map(
      (call) => new URLSearchParams(call[1]?.body as string).get('text') ?? '',
    );
    for (const sent of sentTexts) {
      expect(sent.length).toBeLessThanOrEqual(600);
    }
    // chunks are reassembled into a single output in request order
    expect(sentTexts.join('')).toBe(text);
    expect(result[0]).toBe(sentTexts.map((sent) => `<${sent.length}>`).join(''));
  });

  it('does not exceed the chunk limit at an exact whitespace boundary', async () => {
    mockYandexFlow((text) => ({ code: 200, text: [text] }));
    const text = `${'x'.repeat(600)} ${'y'.repeat(10)}`;

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await yandexProvider.translate([text], 'en', 'fr');

    const sentTexts = translateCalls().map(
      (call) => new URLSearchParams(call[1]?.body as string).get('text') ?? '',
    );
    expect(Math.max(...sentTexts.map((sent) => sent.length))).toBe(600);
    expect(sentTexts.join('')).toBe(text);
  });

  it('does not split a Unicode grapheme cluster at the chunk boundary', async () => {
    mockYandexFlow((text) => ({ code: 200, text: [text] }));
    const grapheme = '👩‍👩‍👧‍👦';
    const text = `${'x'.repeat(595)}${grapheme}tail`;

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await yandexProvider.translate([text], 'en', 'fr');

    const sentTexts = translateCalls().map(
      (call) => new URLSearchParams(call[1]?.body as string).get('text') ?? '',
    );
    expect(sentTexts[0]).toHaveLength(595);
    expect(sentTexts[1]!.startsWith(grapheme)).toBe(true);
    expect(sentTexts.join('')).toBe(text);
  });

  it('rejects input that would exceed the proxy request budget before fetching', async () => {
    const { yandexProvider } = await import('@/services/translators/providers/yandex');

    await expect(yandexProvider.translate(['x'.repeat(600 * 60)], 'en', 'fr')).rejects.toThrow(
      'maximum is 29',
    );
    expect(mockTauriFetch).not.toHaveBeenCalled();
  });

  it('limits concurrent chunk requests', async () => {
    let active = 0;
    let peak = 0;
    mockTauriFetch.mockImplementation(async (url, init) => {
      if (String(url).includes('/sessions')) return sessionResponse() as unknown as Response;
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      const text = new URLSearchParams((init?.body as string) ?? '').get('text') ?? '';
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 200, text: [text] }),
      } as unknown as Response;
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await yandexProvider.translate(['x'.repeat(6000)], 'en', 'fr');

    expect(peak).toBe(3);
  });

  it('splits on sentence boundaries rather than mid-sentence when possible', async () => {
    mockYandexFlow(() => ({ code: 200, lang: 'en-fr', text: ['Translated'] }));

    const text = `${'x'.repeat(500)}. ${'y'.repeat(200)}`;

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await yandexProvider.translate([text], 'en', 'fr');

    expect(translateCalls()).toHaveLength(2);
    const firstBody = new URLSearchParams(translateCalls()[0]![1]?.body as string);
    expect(firstBody.get('text')!.endsWith('.')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Azure Translator Provider
// ---------------------------------------------------------------------------
describe('azureProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // The yandex suite above flips the platform mock to Tauri; azure uses
    // window.fetch off Tauri, so restore the default for these tests
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    // Suppress expected error noise from token fetch failure tests.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reset the module-level token cache between tests by re-importing
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Helper: mock fetch to handle token + translation in sequence */
  function mockTokenAndTranslation(translationResponse: unknown) {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'mock-token',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => translationResponse,
      });
  }

  it('returns empty array for empty input', async () => {
    const { azureProvider } = await import('@/services/translators/providers/azure');
    const result = await azureProvider.translate([], 'en', 'fr');
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('translates text with token authentication', async () => {
    mockTokenAndTranslation([{ translations: [{ text: 'Bonjour' }] }]);

    const { azureProvider } = await import('@/services/translators/providers/azure');
    const result = await azureProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Bonjour']);
  });

  it('preserves empty strings', async () => {
    mockTokenAndTranslation([{ translations: [{ text: 'Monde' }] }]);

    const { azureProvider } = await import('@/services/translators/providers/azure');
    const result = await azureProvider.translate(['', 'World'], 'en', 'fr');
    expect(result[0]).toBe('');
    expect(result[1]).toBe('Monde');
  });

  it('throws when token fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    const { azureProvider } = await import('@/services/translators/providers/azure');
    await expect(azureProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'Failed to get auth token: 403',
    );
  });

  it('throws when translation request fails', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'token',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

    const { azureProvider } = await import('@/services/translators/providers/azure');
    await expect(azureProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'Translation failed with status 500',
    );
  });

  it('falls back to original text when response format is unexpected', async () => {
    mockTokenAndTranslation([]);

    const { azureProvider } = await import('@/services/translators/providers/azure');
    const result = await azureProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Hello']);
  });

  it('has correct provider metadata', async () => {
    const { azureProvider } = await import('@/services/translators/providers/azure');
    expect(azureProvider.name).toBe('azure');
    expect(azureProvider.label).toBe('Azure Translator');
  });
});

// ---------------------------------------------------------------------------
// Provider registry — availability rules
// ---------------------------------------------------------------------------
describe('provider registry availability handling', () => {
  // No `vi.resetModules()` here — these tests only inspect static provider
  // metadata, so resolving the registry once is enough. Resetting between
  // each test would re-evaluate the full import chain and churn module
  // state for no benefit.

  it('keeps yandex in getTranslators() so the UI can render it', async () => {
    const { getTranslators } = await import('@/services/translators/providers');
    const names = getTranslators().map((t) => t.name);
    expect(names).toContain('yandex');
  });

  it('exposes yandex as available', async () => {
    const { getTranslator, isTranslatorAvailable } = await import(
      '@/services/translators/providers'
    );
    const yandex = getTranslator('yandex');
    expect(yandex).toBeDefined();
    expect(yandex!.disabled).toBeFalsy();
    expect(isTranslatorAvailable(yandex!, false)).toBe(true);
  });

  it('isTranslatorAvailable returns false for disabled providers', async () => {
    const { isTranslatorAvailable } = await import('@/services/translators/providers');
    const disabled = { name: 'x', label: 'X', disabled: true, translate: async () => [] };
    expect(isTranslatorAvailable(disabled, true)).toBe(false);
    expect(isTranslatorAvailable(disabled, false)).toBe(false);
  });

  it('isTranslatorAvailable returns false for authRequired without token', async () => {
    const { isTranslatorAvailable } = await import('@/services/translators/providers');
    const authed = { name: 'x', label: 'X', authRequired: true, translate: async () => [] };
    expect(isTranslatorAvailable(authed, false)).toBe(false);
    expect(isTranslatorAvailable(authed, true)).toBe(true);
  });

  it('isTranslatorAvailable returns false when quota is exceeded', async () => {
    const { isTranslatorAvailable } = await import('@/services/translators/providers');
    const exhausted = { name: 'x', label: 'X', quotaExceeded: true, translate: async () => [] };
    expect(isTranslatorAvailable(exhausted, true)).toBe(false);
  });

  it('getTranslatorDisplayLabel returns the plain label for healthy providers', async () => {
    const { getTranslator, getTranslatorDisplayLabel } = await import(
      '@/services/translators/providers'
    );
    const google = getTranslator('google')!;
    expect(getTranslatorDisplayLabel(google, true, (s) => s)).toBe('Google Translate');
  });
});
