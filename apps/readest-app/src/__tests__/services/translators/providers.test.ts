import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for empty input', async () => {
    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate([], 'en', 'fr');
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('translates text using yandexgpt service', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        translations: ['Bonjour'],
      }),
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Bonjour']);

    // Verify request format
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://translate.toil.cc/v2/translate/');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.service).toBe('yandexgpt');
    expect(body.lang).toBe('en-fr');
  });

  it('uses "en" when source language is AUTO', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        translations: ['Bonjour'],
      }),
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await yandexProvider.translate(['Hello'], 'AUTO', 'fr');

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.lang).toBe('en-fr');
  });

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate limited' }),
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await expect(yandexProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'yandexgpt failed with status 429',
    );
  });

  it('falls back to original text when translations array is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Hello']);
  });

  it('has correct provider metadata', async () => {
    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    expect(yandexProvider.name).toBe('yandex');
    expect(yandexProvider.label).toBe('Yandex Translate');
    expect(yandexProvider.authRequired).toBe(false);
  });

  it('translates multiple texts in parallel', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        translations: ['Translated'],
      }),
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate(['Hello', 'World'], 'en', 'fr');
    expect(result).toEqual(['Translated', 'Translated']);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Azure Translator Provider
// ---------------------------------------------------------------------------
describe('azureProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
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
// Provider registry — disabled providers stay visible but unselectable
// ---------------------------------------------------------------------------
describe('provider registry disabled handling', () => {
  // No `vi.resetModules()` here — these tests only inspect static provider
  // metadata, so resolving the registry once is enough. Resetting between
  // each test would re-evaluate the full import chain and churn module
  // state for no benefit.

  it('keeps yandex in getTranslators() so the UI can render it', async () => {
    const { getTranslators } = await import('@/services/translators/providers');
    const names = getTranslators().map((t) => t.name);
    expect(names).toContain('yandex');
  });

  it('exposes yandex as disabled so callers can grey it out', async () => {
    const { getTranslator } = await import('@/services/translators/providers');
    const yandex = getTranslator('yandex');
    expect(yandex).toBeDefined();
    expect(yandex!.disabled).toBe(true);
  });

  it('isTranslatorAvailable returns false for disabled providers', async () => {
    const { getTranslator, isTranslatorAvailable } =
      await import('@/services/translators/providers');
    const yandex = getTranslator('yandex')!;
    expect(isTranslatorAvailable(yandex, true)).toBe(false);
    expect(isTranslatorAvailable(yandex, false)).toBe(false);
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
    const { getTranslator, getTranslatorDisplayLabel } =
      await import('@/services/translators/providers');
    const google = getTranslator('google')!;
    expect(getTranslatorDisplayLabel(google, true, (s) => s)).toBe('Google Translate');
  });
});
