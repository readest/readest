import { describe, expect, test, vi } from 'vitest';

// Enter the module graph at EdgeTTSClient: constants.ts circularly imports it
// for DEFAULT_SENTENCE_GAP_SEC, and entering at BufferedTTSClient leaves the
// base class undefined when `EdgeTTSClient extends BufferedTTSClient` runs.
import '@/services/tts/EdgeTTSClient';
import { BufferedTTSClient } from '@/services/tts/BufferedTTSClient';
import { CachingProvider, TTSCacheStore } from '@/services/tts/providers/cache';
import type { SpeechProvider } from '@/services/tts/providers/types';

describe('BufferedTTSClient.warmSentence', () => {
  test('an already-aborted warm returns false and records no mark', async () => {
    // Cancelling a download aborts the signal; #synthesizeWithRetry then
    // returns undefined without throwing. warmSentence must report the
    // sentence as not cached and record nothing — a mark recorded for an
    // unsynthesized sentence inflates progress and violates its contract.
    const synthesize = vi.fn(
      async (): Promise<{ audio: ArrayBuffer; boundaries: never[] }> => ({
        audio: new ArrayBuffer(4),
        boundaries: [],
      }),
    );
    const inner: SpeechProvider = {
      id: 'fake',
      label: 'Fake',
      init: async () => true,
      getAllVoices: async () => [{ id: 'v1', name: 'Voice 1', lang: 'en' }],
      synthesize,
    };
    const recordMarkKey = vi.fn(async () => {});
    const store: TTSCacheStore = {
      get: async () => null,
      put: async () => {},
      recordMarkKey,
    };
    const client = new BufferedTTSClient(new CachingProvider(inner, store));
    await client.init();
    const controller = new AbortController();
    controller.abort();

    await expect(client.warmSentence(0, 0, 'en', 'Hello there.', controller.signal)).resolves.toBe(
      false,
    );
    expect(synthesize).not.toHaveBeenCalled();
    expect(recordMarkKey).not.toHaveBeenCalled();
  });
});

describe('BufferedTTSClient.cachedSentences', () => {
  test('finds stored sentences under the same keys warmSentence records', async () => {
    const inner: SpeechProvider = {
      id: 'fake',
      label: 'Fake',
      init: async () => true,
      getAllVoices: async () => [{ id: 'v1', name: 'Voice 1', lang: 'en' }],
      synthesize: async () => ({ audio: new ArrayBuffer(4), boundaries: [] }),
    };
    const stored = new Set<string>();
    const recordMarkKey = vi.fn(async (_s: number, _o: number, key: string) => {
      stored.add(key);
    });
    const recordMarkKeys = vi.fn(async () => {});
    const store: TTSCacheStore = {
      get: async () => null,
      put: async () => {},
      recordMarkKey,
      recordMarkKeys,
      cachedKeys: async (keys) => new Set(keys.filter((k) => stored.has(k))),
    };
    const client = new BufferedTTSClient(new CachingProvider(inner, store));
    await client.init();
    await client.warmSentence(3, 0, 'en', 'Hello there.');
    const key = recordMarkKey.mock.calls[0]![2];

    const cached = await client.cachedSentences(3, [
      { ordinal: 0, lang: 'en', text: 'Hello there.' },
      { ordinal: 1, lang: 'en', text: 'Not yet.' },
    ]);
    expect(cached).toEqual(new Set([0]));
    expect(recordMarkKeys).toHaveBeenCalledWith(3, [{ ordinal: 0, key }]);
  });
});
