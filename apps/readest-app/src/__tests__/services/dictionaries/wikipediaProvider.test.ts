import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wikipediaProvider } from '@/services/dictionaries/providers/wikipediaProvider';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';

const sampleSummary = {
  titles: { display: 'Cat' },
  description: 'Small carnivorous mammal',
  extract_html: '<p>Cats are small mammals.</p>',
  thumbnail: { source: 'https://example/cat.jpg' },
  dir: 'ltr',
};

describe('wikipedia provider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the supplied book language as the wiki host prefix', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleSummary,
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await wikipediaProvider.lookup('Cat', {
      lang: 'fr',
      signal: controller.signal,
      container,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url.startsWith('https://fr.wikipedia.org/api/rest_v1/page/summary/')).toBe(true);
    expect(outcome.ok).toBe(true);
    expect(container.querySelector('h1')?.textContent).toBe('Cat');
    expect(container.querySelector('div')?.innerHTML).toContain('Cats are small mammals');
  });

  it('writes into the supplied container — no document.querySelector', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleSummary,
    } as Response);
    const stray = document.createElement('main');
    document.body.appendChild(stray);
    const container = document.createElement('div');
    const controller = new AbortController();

    await wikipediaProvider.lookup('Cat', {
      lang: 'en',
      signal: controller.signal,
      container,
    });

    expect(container.children.length).toBeGreaterThan(0);
    expect(stray.children.length).toBe(0);
    document.body.removeChild(stray);
  });

  it('falls back to en.wikipedia when no lang is supplied', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleSummary,
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    await wikipediaProvider.lookup('Cat', { signal: controller.signal, container });

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url.startsWith('https://en.wikipedia.org/')).toBe(true);
  });

  it('reports an error outcome on HTTP failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await wikipediaProvider.lookup('zzz', {
      lang: 'en',
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('error');
  });

  it('has the expected provider id', () => {
    expect(wikipediaProvider.id).toBe(BUILTIN_PROVIDER_IDS.wikipedia);
  });

  it('renders a "Read on Wikipedia" link to the canonical article', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...sampleSummary,
        content_urls: {
          desktop: { page: 'https://en.wikipedia.org/wiki/Cat' },
          mobile: { page: 'https://en.m.wikipedia.org/wiki/Cat' },
        },
      }),
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();
    await wikipediaProvider.lookup('Cat', {
      lang: 'en',
      signal: controller.signal,
      container,
    });

    const link = container.querySelector<HTMLAnchorElement>('a[target="_blank"]');
    expect(link).toBeTruthy();
    expect(link!.href).toBe('https://en.wikipedia.org/wiki/Cat');
    expect(link!.rel).toBe('noopener noreferrer');
    expect(link!.textContent).toContain('Wikipedia');
  });

  it('falls back to a constructed article URL when content_urls is missing', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleSummary, // no content_urls
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();
    await wikipediaProvider.lookup('Cat', {
      lang: 'fr',
      signal: controller.signal,
      container,
    });

    const link = container.querySelector<HTMLAnchorElement>('a[target="_blank"]');
    expect(link).toBeTruthy();
    expect(link!.href).toBe('https://fr.wikipedia.org/wiki/Cat');
  });
});
