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

// @/utils/lang is deliberately NOT mocked: the providers' language-code
// handling against the real normalizers is part of what these tests verify.
// A hand-rolled lang mock previously hid that normalizeToFullLang maximizes
// bare subtags ('en' -> 'en-US'), which Bing rejects with statusCode 400.

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

  it('translates without a Readest token via the direct yandex API', async () => {
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
    expect((opts?.headers as Record<string, string>)['Authorization']).toBeUndefined();
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
    const result = await yandexProvider.translate(['Hello'], 'en', 'fr', 'readest-access-token');
    expect(result).toEqual(['<Hello>']);

    for (const [, init] of mockFetch.mock.calls) {
      expect(init.headers['Authorization']).toBe('Bearer readest-access-token');
    }
    const urls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain('/api/yandex-translate?endpoint=session');
    expect(urls[1]).toContain('/api/yandex-translate?endpoint=translate');
    expect(urls[1]).toContain('source_lang=en');
    expect(urls[1]).toContain('target_lang=fr');
    // the browser must not try to set the Referer — the proxy attaches it
    expect(mockTauriFetch).not.toHaveBeenCalled();
  });

  it('rejects web requests without a Readest token before fetching', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await expect(yandexProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'yandex translate requires authentication in web builds',
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTauriFetch).not.toHaveBeenCalled();
  });

  it('omits source_lang for automatic detection when source language is AUTO', async () => {
    mockYandexFlow(() => ({ code: 200, lang: 'en-fr', text: ['Bonjour'] }));

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await yandexProvider.translate(['Hello'], 'AUTO', 'fr');

    const query = new URLSearchParams(String(translateCalls()[0]![0]).split('?')[1]);
    expect(query.has('source_lang')).toBe(false);
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
    await expect(
      yandexProvider.translate(['Hello'], 'en', 'fr', 'readest-access-token'),
    ).rejects.toThrow('yandex translate failed with status 403: Forbidden');
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
describe('parseBingAuthParams', () => {
  it('extracts the auth material from the translator page', async () => {
    const { parseBingAuthParams } = await import('@/services/translators/providers/azureShared');
    const params = parseBingAuthParams(BING_PAGE, 1_000_000);
    expect(params.ig).toBe('01CE353230DE4BFD8A44466FDD91401A');
    expect(params.iid).toBe('translator.5025');
    expect(params.key).toBe('1786092445798');
    expect(params.token).toBe('page-token');
    // one hour TTL less the 60s safety margin
    expect(params.expiresAt).toBe(1_000_000 + 3_600_000 - 60_000);
  });

  it('stamps expiry against the supplied clock, not the page timestamp', async () => {
    const { parseBingAuthParams } = await import('@/services/translators/providers/azureShared');
    // The page's own `key` timestamp is far in the past; a skewed client must
    // still get an expiry relative to when it actually fetched the page.
    expect(parseBingAuthParams(BING_PAGE, 5_000).expiresAt).toBe(5_000 + 3_600_000 - 60_000);
  });

  it('throws when the page markup no longer carries the auth params', async () => {
    const { parseBingAuthParams } = await import('@/services/translators/providers/azureShared');
    expect(() => parseBingAuthParams('<html>nothing here</html>', 0)).toThrow(
      'could not parse the translator page',
    );
  });
});

// ---------------------------------------------------------------------------
// Azure Translator Provider (backed by the Bing Translator web API)
// ---------------------------------------------------------------------------
const BING_PAGE = `
  <html><script>var IG:"01CE353230DE4BFD8A44466FDD91401A";</script>
  <div data-iid="translator.5025"></div>
  <script>var params_AbusePreventionHelper = [1786092445798,"page-token",3600000];</script>
  </html>
`;

describe('azureProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(tauriFetch).mockReset();
    // The yandex suite above flips the platform mock to Tauri; azure uses
    // window.fetch off Tauri, so restore the default for these tests
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    // Suppress expected error noise from auth failure tests.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reset the module-level auth cache between tests by re-importing
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const translationBody = (text: string) => ({
    ok: true,
    status: 200,
    json: async () => [{ translations: [{ text }] }],
  });

  /** Web path: proxy returns parsed auth params as JSON, then a translation. */
  function mockProxyAuthAndTranslation(text: string) {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ig: 'IG1',
          iid: 'translator.5025',
          key: '1786092445798',
          token: 'proxy-token',
          expiresAt: Date.now() + 3_600_000,
        }),
      })
      .mockResolvedValueOnce(translationBody(text));
  }

  it('returns empty array for empty input', async () => {
    const { azureProvider } = await import('@/services/translators/providers/azure');
    const result = await azureProvider.translate([], 'en', 'fr');
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('translates text through the same-origin proxy in web builds', async () => {
    mockProxyAuthAndTranslation('Bonjour');

    const { azureProvider } = await import('@/services/translators/providers/azure');
    const result = await azureProvider.translate(['Hello'], 'en', 'fr', 'user-token');
    expect(result).toEqual(['Bonjour']);

    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain('/api/azure-translate?endpoint=auth');
    expect(urls[1]).toContain('/api/azure-translate?endpoint=translate');
    // The browser must never be asked to fetch bing.com directly — it has no
    // CORS headers, so such a request would be blocked.
    expect(urls.some((url) => url.includes('bing.com'))).toBe(false);
  });

  it('requires authentication only in web builds', async () => {
    const { azureProvider } = await import('@/services/translators/providers/azure');
    expect(azureProvider.authRequired).toBe(true);

    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    expect(azureProvider.authRequired).toBe(false);
  });

  it('splits texts over the 1000 character limit and rejoins them', async () => {
    // Bing answers `statusCode: 400` above 1000 characters, so a long
    // paragraph must go out in chunks rather than fail outright.
    const sentTexts: string[] = [];
    mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (String(url).includes('endpoint=auth')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ig: 'IG1',
            iid: 'translator.5025',
            key: '1',
            token: 't',
            expiresAt: Date.now() + 3_600_000,
          }),
        };
      }
      const text = new URLSearchParams(init.body as string).get('text')!;
      sentTexts.push(text);
      return {
        ok: true,
        status: 200,
        json: async () => [{ translations: [{ text: `<${text}>` }] }],
      };
    });

    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const long = sentence.repeat(60); // ~2640 chars
    const { azureProvider } = await import('@/services/translators/providers/azure');
    const [result] = await azureProvider.translate([long], 'en', 'fr', 'user-token');

    expect(sentTexts.length).toBeGreaterThan(1);
    expect(sentTexts.every((text) => text.length <= 1000)).toBe(true);
    // Nothing may be dropped or reordered when the pieces are stitched back.
    expect(sentTexts.join('')).toBe(long);
    expect(result).toBe(sentTexts.map((text) => `<${text}>`).join(''));
  });

  it('never exceeds the concurrency the proxy allows', async () => {
    // Bing translates one text per request, so an unbounded fan-out over a
    // page of paragraphs gets the surplus rejected with 429 by the proxy.
    let inFlight = 0;
    let peakInFlight = 0;
    mockFetch.mockImplementation(async (url: string) => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return String(url).includes('endpoint=auth')
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              ig: 'IG1',
              iid: 'translator.5025',
              key: '1',
              token: 't',
              expiresAt: Date.now() + 3_600_000,
            }),
          }
        : translationBody('translated');
    });

    const { azureProvider } = await import('@/services/translators/providers/azure');
    const lines = Array.from({ length: 24 }, (_, index) => `line ${index}`);
    const result = await azureProvider.translate(lines, 'en', 'fr', 'user-token');

    expect(result).toHaveLength(24);
    expect(result.every((line) => line === 'translated')).toBe(true);
    expect(peakInFlight).toBeLessThanOrEqual(3);
    // All 24 lines still go out — the cap throttles, it must not drop work.
    const translateCalls = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes('endpoint=translate'),
    );
    expect(translateCalls).toHaveLength(24);
  });

  it('rejects in web builds when there is no user token', async () => {
    const { azureProvider } = await import('@/services/translators/providers/azure');
    await expect(azureProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'azure translate requires authentication in web builds',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('scrapes bing directly on Tauri, bypassing the proxy', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(tauriFetch)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => BING_PAGE } as Response)
      .mockResolvedValueOnce(translationBody('Bonjour') as unknown as Response);

    const { azureProvider } = await import('@/services/translators/providers/azure');
    const result = await azureProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Bonjour']);

    const urls = vi.mocked(tauriFetch).mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toBe('https://www.bing.com/translator');
    expect(urls[1]).toContain('https://www.bing.com/ttranslatev3');
    // IG/IID are mandatory — the endpoint answers statusCode 400 without them.
    expect(urls[1]).toContain('IG=01CE353230DE4BFD8A44466FDD91401A');
    expect(urls[1]).toContain('IID=translator.5025');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends Bing language codes rather than maximized culture codes', async () => {
    // Bing's ttranslatev3 answers `statusCode: 400` for region-maximized
    // codes like en-US or de-DE (verified live 2026-08-11); it only accepts
    // its own list — bare subtags plus script variants like zh-Hans. The
    // retired api-edge endpoint tolerated full culture codes, so the
    // migration must not keep maximizing.
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    const sentBodies: URLSearchParams[] = [];
    vi.mocked(tauriFetch).mockImplementation(async (url, init) => {
      if (String(url).includes('/translator')) {
        return { ok: true, status: 200, text: async () => BING_PAGE } as Response;
      }
      sentBodies.push(new URLSearchParams(String(init?.body ?? '')));
      return translationBody('translated') as unknown as Response;
    });

    const { azureProvider } = await import('@/services/translators/providers/azure');
    await azureProvider.translate(['Hello'], 'AUTO', 'en');
    await azureProvider.translate(['Hello'], 'en', 'zh-CN');

    expect(sentBodies[0]!.get('fromLang')).toBe('auto-detect');
    expect(sentBodies[0]!.get('to')).toBe('en');
    expect(sentBodies[1]!.get('fromLang')).toBe('en');
    // Bing spells simplified Chinese zh-Hans, never zh-CN.
    expect(sentBodies[1]!.get('to')).toBe('zh-Hans');
  });

  it('reuses cached auth params across calls', async () => {
    mockProxyAuthAndTranslation('Bonjour');
    mockFetch.mockResolvedValueOnce(translationBody('Monde'));

    const { azureProvider } = await import('@/services/translators/providers/azure');
    await azureProvider.translate(['Hello'], 'en', 'fr', 'user-token');
    await azureProvider.translate(['World'], 'en', 'fr', 'user-token');

    const authCalls = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes('endpoint=auth'),
    );
    expect(authCalls).toHaveLength(1);
  });

  it('re-authenticates once when the token is rejected with statusCode 205', async () => {
    // Bing signals an expired token inside an HTTP 200 body, so a plain
    // response.ok check would silently return no translation.
    mockProxyAuthAndTranslation('unused');
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ig: 'IG1',
          iid: 'translator.5025',
          key: '1',
          token: 'stale',
          expiresAt: Date.now() + 3_600_000,
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ statusCode: 205 }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ig: 'IG1',
          iid: 'translator.5025',
          key: '2',
          token: 'fresh',
          expiresAt: Date.now() + 3_600_000,
        }),
      })
      .mockResolvedValueOnce(translationBody('Bonjour'));

    const { azureProvider } = await import('@/services/translators/providers/azure');
    const result = await azureProvider.translate(['Hello'], 'en', 'fr', 'user-token');
    expect(result).toEqual(['Bonjour']);

    const authCalls = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes('endpoint=auth'),
    );
    expect(authCalls).toHaveLength(2);
  });

  it('throws rather than looping when re-authentication still fails', async () => {
    const authResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        ig: 'IG1',
        iid: 'translator.5025',
        key: '1',
        token: 'stale',
        expiresAt: Date.now() + 3_600_000,
      }),
    };
    const rejected = { ok: true, status: 200, json: async () => ({ statusCode: 205 }) };
    mockFetch
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(rejected);

    const { azureProvider } = await import('@/services/translators/providers/azure');
    await expect(azureProvider.translate(['Hello'], 'en', 'fr', 'user-token')).rejects.toThrow(
      'bing translate failed with status 205',
    );
  });

  it('preserves empty strings', async () => {
    mockProxyAuthAndTranslation('Monde');

    const { azureProvider } = await import('@/services/translators/providers/azure');
    const result = await azureProvider.translate(['', 'World'], 'en', 'fr', 'user-token');
    expect(result[0]).toBe('');
    expect(result[1]).toBe('Monde');
  });

  it('throws when the auth request fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });

    const { azureProvider } = await import('@/services/translators/providers/azure');
    await expect(azureProvider.translate(['Hello'], 'en', 'fr', 'user-token')).rejects.toThrow(
      'bing translate auth failed with status 403',
    );
  });

  it('throws when translation request fails', async () => {
    mockProxyAuthAndTranslation('unused');
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ig: 'IG1',
          iid: 'translator.5025',
          key: '1',
          token: 't',
          expiresAt: Date.now() + 3_600_000,
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    const { azureProvider } = await import('@/services/translators/providers/azure');
    await expect(azureProvider.translate(['Hello'], 'en', 'fr', 'user-token')).rejects.toThrow(
      'bing translate failed with status 500',
    );
  });

  it('falls back to original text when response format is unexpected', async () => {
    mockProxyAuthAndTranslation('unused');
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ig: 'IG1',
          iid: 'translator.5025',
          key: '1',
          token: 't',
          expiresAt: Date.now() + 3_600_000,
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });

    const { azureProvider } = await import('@/services/translators/providers/azure');
    const result = await azureProvider.translate(['Hello'], 'en', 'fr', 'user-token');
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

  it('requires authentication for yandex only in web builds', async () => {
    const { getTranslator, isTranslatorAvailable } = await import(
      '@/services/translators/providers'
    );
    const yandex = getTranslator('yandex')!;

    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    expect(isTranslatorAvailable(yandex, false)).toBe(false);
    expect(isTranslatorAvailable(yandex, true)).toBe(true);

    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    expect(isTranslatorAvailable(yandex, false)).toBe(true);
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

// ---------------------------------------------------------------------------
// Inline-markup capability (#1582)
// ---------------------------------------------------------------------------
describe('preservesMarkup capability', () => {
  it('is enabled only for providers verified against their live API', async () => {
    const { getTranslators } = await import('@/services/translators');
    const capable = getTranslators()
      .filter((translator) => translator.preservesMarkup)
      .map((translator) => translator.name)
      .sort();
    // Bing/Azure and Google both reposition inline tags onto the matching
    // words. DeepL must stay out: it drops <em> outright and empties <b> when a
    // sentence also carries <i>, so markup would claim formatting that is not
    // there. Yandex is simply unverified.
    expect(capable).toEqual(['azure', 'google']);
  });
});
