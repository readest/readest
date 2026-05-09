import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wiktionaryProvider } from '@/services/dictionaries/providers/wiktionaryProvider';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';

const sampleResponse = {
  en: [
    {
      partOfSpeech: 'Noun',
      language: 'English',
      definitions: [
        {
          definition:
            'A <a rel="mw:WikiLink" title="cat" href="/wiki/cat">cat</a> is a small animal.',
          examples: ['<i>The cat sat on the mat.</i>'],
        },
      ],
    },
  ],
};

describe('wiktionary provider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has the expected metadata', () => {
    expect(wiktionaryProvider.id).toBe(BUILTIN_PROVIDER_IDS.wiktionary);
    expect(wiktionaryProvider.kind).toBe('builtin');
  });

  it('renders results into the supplied container and reports success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleResponse,
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await wiktionaryProvider.lookup('cat', {
      lang: 'en',
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.headword).toBe('cat');
      expect(outcome.sourceLabel).toContain('Wiktionary');
    }
    expect(container.querySelector('h1')?.textContent).toBe('cat');
    expect(container.querySelector('h2')?.textContent).toBe('Noun');
    expect(container.querySelector('ol li')?.textContent).toContain('is a small animal');
  });

  it('rewires WikiLinks to call onNavigate instead of following the href', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleResponse,
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();
    const onNavigate = vi.fn();

    await wiktionaryProvider.lookup('cat', {
      lang: 'en',
      signal: controller.signal,
      container,
      onNavigate,
    });

    const link = container.querySelector<HTMLAnchorElement>('a[rel="mw:WikiLink"]');
    expect(link).toBeTruthy();
    expect(link!.className).toContain('underline');
    link!.click();
    expect(onNavigate).toHaveBeenCalledWith('cat');
  });

  it('returns empty when the API has no entries for the requested language', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await wiktionaryProvider.lookup('zzznonsense', {
      lang: 'en',
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('returns error on HTTP failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await wiktionaryProvider.lookup('cat', {
      lang: 'en',
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('error');
  });
});
