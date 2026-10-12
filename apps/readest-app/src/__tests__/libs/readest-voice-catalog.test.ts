import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogVoice } from '@/libs/readestVoice/catalog';

const CATALOG: CatalogVoice[] = [
  { id: 'kokoro:af_heart', engine: 'kokoro', name: 'Heart', langs: ['en-US'] },
  { id: 'qwen3:serena', engine: 'qwen3', name: 'Serena', langs: ['en-US', 'de-DE'] },
  { id: 'future:x', engine: 'future', name: 'X', langs: ['en-US'] },
  { id: 'omnivoice:clara', engine: 'omnivoice', name: 'Clara', langs: ['en-US'] },
];

const fetchMock = vi.fn();

// Fresh module per test: the catalog cache is module state.
const load = async () => {
  vi.resetModules();
  return import('@/libs/readestVoice/catalog');
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('READEST_TTS_CATALOG_URL', 'https://example.test/catalog.json');
  fetchMock
    .mockReset()
    .mockImplementation(async () => Response.json({ version: 1, voices: CATALOG }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('getCatalog', () => {
  it('fetches the catalog once per TTL', async () => {
    vi.useFakeTimers();
    const { getCatalog } = await load();
    expect(await getCatalog()).toEqual(CATALOG);
    expect(await getCatalog()).toEqual(CATALOG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/catalog.json');
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await getCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when unconfigured or unreachable', async () => {
    let { getCatalog } = await load();
    vi.stubEnv('READEST_TTS_CATALOG_URL', '');
    expect(await getCatalog()).toBeNull();

    vi.stubEnv('READEST_TTS_CATALOG_URL', 'https://example.test/catalog.json');
    ({ getCatalog } = await load());
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await getCatalog()).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    expect(await getCatalog()).toBeNull();
  });

  it('keeps serving the last good catalog when a refresh fails', async () => {
    vi.useFakeTimers();
    const { getCatalog } = await load();
    await getCatalog();
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await getCatalog()).toEqual(CATALOG);
  });

  it('drops malformed rows', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ voices: [CATALOG[0], { id: 'bad' }, null, { ...CATALOG[1], langs: 'en' }] }),
    );
    const { getCatalog } = await load();
    expect(await getCatalog()).toEqual([CATALOG[0]]);
  });
});

describe('plan filtering', () => {
  it('gives Plus Kokoro, Pro Kokoro and OmniVoice, others nothing', async () => {
    // Qwen3 voices are blocked for every plan, even though the catalog lists them.
    const { voicesForPlan } = await load();
    expect(voicesForPlan(CATALOG, 'plus')).toEqual([
      { id: 'kokoro:af_heart', name: 'Heart', lang: 'en-US', tier: 'plus' },
    ]);
    expect(voicesForPlan(CATALOG, 'pro')).toEqual([
      { id: 'kokoro:af_heart', name: 'Heart', lang: 'en-US', tier: 'plus' },
      { id: 'omnivoice:clara', name: 'Clara', lang: 'en-US', tier: 'pro' },
    ]);
    expect(voicesForPlan(CATALOG, 'free')).toEqual([]);
    expect(voicesForPlan(CATALOG, 'purchase')).toEqual([]);
  });

  it('hides engines without a configured minimum plan (fail closed)', async () => {
    const { isVoiceInPlan } = await load();
    expect(isVoiceInPlan(CATALOG[2]!, 'pro')).toBe(false);
  });

  it('finds voices by id', async () => {
    const { findVoice } = await load();
    expect(findVoice(CATALOG, 'qwen3:serena')?.name).toBe('Serena');
    expect(findVoice(CATALOG, 'kokoro:nope')).toBeUndefined();
  });
});
