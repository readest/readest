import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

import { createDeepLTranslator } from '@/services/translators/custom/deepl';
import { ErrorCodes } from '@/services/translators/types';
import type { CustomTranslator } from '@/types/translation';

const config = (apiKey: string): CustomTranslator => ({
  id: 'd1',
  type: 'deepl',
  name: 'My DeepL',
  apiKey,
  addedAt: 1,
  updatedAt: 1,
});

const ok = (texts: string[]) =>
  new Response(JSON.stringify({ translations: texts.map((text) => ({ text })) }), { status: 200 });

describe('createDeepLTranslator', () => {
  beforeEach(() => fetchMock.mockReset());

  it('uses the free host for :fx keys and sends the DeepL request shape', async () => {
    fetchMock.mockResolvedValue(ok(['Hallo']));
    const t = createDeepLTranslator(config('key:fx'));
    expect(await t.translate(['Hello'], 'en', 'de')).toEqual(['Hallo']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api-free.deepl.com/v2/translate');
    expect(init.headers.Authorization).toBe('DeepL-Auth-Key key:fx');
    expect(JSON.parse(init.body)).toEqual({
      text: ['Hello'],
      source_lang: 'EN',
      target_lang: 'DE',
    });
  });

  it('uses the pro host otherwise and omits source_lang for AUTO', async () => {
    fetchMock.mockResolvedValue(ok(['Hallo']));
    await createDeepLTranslator(config('pro-key')).translate(['Hello'], 'AUTO', 'de');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.deepl.com/v2/translate');
    expect(JSON.parse(init.body).source_lang).toBeUndefined();
  });

  it('keeps empty inputs in place', async () => {
    fetchMock.mockResolvedValue(ok(['Hallo']));
    const out = await createDeepLTranslator(config('k')).translate(['', 'Hello'], 'en', 'de');
    expect(out).toEqual(['', 'Hallo']);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).text).toEqual(['Hello']);
  });

  it('retries once after a 429', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(ok(['Hallo']));
    const promise = createDeepLTranslator(config('k')).translate(['Hello'], 'en', 'de');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await promise).toEqual(['Hallo']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('stops waiting for a 429 retry when the caller aborts', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
    );
    const controller = new AbortController();
    const promise = createDeepLTranslator(config('k')).translate(
      ['Hello'],
      'en',
      'de',
      null,
      false,
      controller.signal,
    );
    const settled = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await settled;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('caps a long Retry-After at 10 seconds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '600' } }))
      .mockResolvedValueOnce(ok(['Hallo']));
    const promise = createDeepLTranslator(config('k')).translate(['Hello'], 'en', 'de');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await promise).toEqual(['Hallo']);
    vi.useRealTimers();
  });

  it('maps 403 to UNAUTHORIZED and 456 to a quota error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));
    const t = createDeepLTranslator(config('k'));
    await expect(t.translate(['Hello'], 'en', 'de')).rejects.toThrow(ErrorCodes.UNAUTHORIZED);
    fetchMock.mockResolvedValueOnce(new Response('', { status: 456 }));
    await expect(t.translate(['Hello'], 'en', 'de')).rejects.toThrow(/quota/i);
  });
});
