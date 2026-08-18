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
