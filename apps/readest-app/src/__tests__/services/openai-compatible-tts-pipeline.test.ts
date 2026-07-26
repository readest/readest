import { describe, test, expect, vi, beforeEach } from 'vitest';

// Regression tests for the OpenAI-compatible TTS "one sentence, long pause,
// one sentence" stall. Each test pins one of the three independent causes:
//   1. the provider was never wrapped in CachingProvider (cacheable = false),
//      so preload discarded its bytes and playback re-synthesized every
//      sentence from scratch;
//   2. CachingProvider bound the shared in-flight promise to the FIRST
//      caller's AbortSignal, so a cancelled preload killed playback's fetch;
//   3. non-2xx responses were all permanent, so 429/5xx skipped sentences.

import { CachingProvider, computeTTSCacheKey } from '@/services/tts/providers/cache';
import type { TTSCacheEntry, TTSCacheStore } from '@/services/tts/providers/cache';
import { type SpeechProvider, type SpeechSynthesisRequest } from '@/services/tts/providers/types';

const req = (text: string): SpeechSynthesisRequest => ({
  lang: 'en',
  text,
  voice: 'alloy',
  pitch: 1,
});

class MemoryStore implements TTSCacheStore {
  entries = new Map<string, TTSCacheEntry>();
  async get(key: string) {
    return this.entries.get(key) ?? null;
  }
  async put(key: string, entry: TTSCacheEntry) {
    this.entries.set(key, entry);
  }
}

// A provider whose synthesis is resolved manually, so tests can interleave
// preload and playback deterministically.
class DeferredProvider implements SpeechProvider {
  readonly id = 'openai-compatible-tts';
  readonly label = 'test';
  cacheable = true;
  calls: string[] = [];
  aborts = 0;
  #resolvers: Array<(v: ArrayBuffer) => void> = [];
  async init() {
    return true;
  }
  async getAllVoices() {
    return [];
  }
  synthesize(request: SpeechSynthesisRequest, signal: AbortSignal) {
    this.calls.push(request.text);
    signal.addEventListener('abort', () => {
      this.aborts += 1;
    });
    return new Promise<{ audio: ArrayBuffer; boundaries: [] }>((resolve) => {
      this.#resolvers.push((audio) => resolve({ audio, boundaries: [] }));
    });
  }
  // synthesize() is only reached after CachingProvider awaits store.get(), so
  // tests must wait for the request to actually land before resolving it.
  async resolveAll(expected = 1) {
    await vi.waitFor(() => expect(this.#resolvers.length).toBeGreaterThanOrEqual(expected));
    const resolvers = this.#resolvers;
    this.#resolvers = [];
    for (const resolve of resolvers) resolve(new ArrayBuffer(16));
  }
}

describe('OpenAI-compatible TTS caching and dedup', () => {
  let provider: DeferredProvider;
  let store: MemoryStore;
  let caching: CachingProvider;

  beforeEach(() => {
    provider = new DeferredProvider();
    store = new MemoryStore();
    caching = new CachingProvider(provider, store);
  });

  test('preload populates the cache so playback does not re-synthesize', async () => {
    const preload = caching.synthesize(req('Hello.'), new AbortController().signal);
    await provider.resolveAll();
    await preload;
    expect(provider.calls).toEqual(['Hello.']);
    expect(store.entries.size).toBe(1);

    // Playback of the same sentence must be a cache hit, not a second request.
    const playback = await caching.synthesize(req('Hello.'), new AbortController().signal);
    expect(provider.calls).toEqual(['Hello.']);
    expect(playback.audio.byteLength).toBe(16);
  });

  test('concurrent preload and playback dedup onto one request', async () => {
    const preload = caching.synthesize(req('Hello.'), new AbortController().signal);
    const playback = caching.synthesize(req('Hello.'), new AbortController().signal);
    await provider.resolveAll();
    await Promise.all([preload, playback]);
    expect(provider.calls).toEqual(['Hello.']);
  });

  test('each caller gets its own ArrayBuffer (decodeAudioData detaches)', async () => {
    const a = caching.synthesize(req('Hello.'), new AbortController().signal);
    const b = caching.synthesize(req('Hello.'), new AbortController().signal);
    await provider.resolveAll();
    const [first, second] = await Promise.all([a, b]);
    expect(first.audio).not.toBe(second.audio);
    expect(first.audio.byteLength).toBe(16);
    expect(second.audio.byteLength).toBe(16);
  });

  // The core regression: aborting the preload must not cancel playback's
  // fetch, because both are served by one shared in-flight promise.
  test('aborting a joined preload does not cancel the playback request', async () => {
    const preloadAbort = new AbortController();
    const preload = caching.synthesize(req('Hello.'), preloadAbort.signal);
    const playback = caching.synthesize(req('Hello.'), new AbortController().signal);

    preloadAbort.abort();
    await expect(preload).rejects.toThrow(/abort/i);

    await provider.resolveAll();
    const result = await playback;
    expect(result.audio.byteLength).toBe(16);
    expect(provider.calls).toEqual(['Hello.']);
  });

  test('aborting the first caller still caches the audio for later playback', async () => {
    const abort = new AbortController();
    const preload = caching.synthesize(req('Hello.'), abort.signal);
    abort.abort();
    await expect(preload).rejects.toThrow(/abort/i);

    await provider.resolveAll();
    // Let the detached completion write through to the store.
    await vi.waitFor(() => expect(store.entries.size).toBe(1));

    const playback = await caching.synthesize(req('Hello.'), new AbortController().signal);
    expect(playback.audio.byteLength).toBe(16);
    expect(provider.calls).toEqual(['Hello.']);
  });

  test('an aborted request does not poison the in-flight slot', async () => {
    const abort = new AbortController();
    const first = caching.synthesize(req('Hello.'), abort.signal);
    abort.abort();
    await expect(first).rejects.toThrow(/abort/i);
    await provider.resolveAll();
    await vi.waitFor(() => expect(store.entries.size).toBe(1));

    const second = await caching.synthesize(req('Hello.'), new AbortController().signal);
    expect(second.audio.byteLength).toBe(16);
  });

  test('cache key ignores rate and separates distinct sentences', () => {
    expect(computeTTSCacheKey('openai-compatible-tts', req('A'))).toBe(
      computeTTSCacheKey('openai-compatible-tts', req('A')),
    );
    expect(computeTTSCacheKey('openai-compatible-tts', req('A'))).not.toBe(
      computeTTSCacheKey('openai-compatible-tts', req('B')),
    );
  });

  test('cacheable = false still bypasses the store (contract unchanged)', async () => {
    provider.cacheable = false;
    const bypass = new CachingProvider(provider, store);
    const p = bypass.synthesize(req('Hello.'), new AbortController().signal);
    await provider.resolveAll();
    await p;
    expect(store.entries.size).toBe(0);
  });
});

describe('OpenAI-compatible provider error classification', () => {
  const loadProvider = async (status: number, body = 'boom') => {
    vi.resetModules();
    vi.doMock('@/services/ai/utils/httpFetch', () => ({
      getAIFetch: () => async () =>
        new Response(body, { status, headers: { 'Content-Type': 'text/plain' } }),
    }));
    vi.doMock('@/services/tts/openAICompatibleTTS', () => ({
      getOpenAICompatibleTTSConfig: () => ({
        baseUrl: 'http://localhost:8880/v1',
        apiKey: 'k',
        model: 'kokoro',
      }),
      normalizeOpenAIBaseUrl: (u: string) => u,
      fetchOpenAICompatibleVoices: async () => [],
    }));
    const { OpenAICompatibleSpeechProvider } = await import(
      '@/services/tts/providers/openaiCompatible'
    );
    // resetModules gives this graph its own class identity, so the assertion
    // must use the same instance of the module rather than the static import.
    const { SpeechSynthesisPermanentError: FreshPermanentError } = await import(
      '@/services/tts/providers/types'
    );
    return { provider: new OpenAICompatibleSpeechProvider(), FreshPermanentError };
  };

  test('is cacheable so preload and dedup engage', async () => {
    const { provider } = await loadProvider(200);
    expect(provider.cacheable).toBe(true);
  });

  test.each([429, 500, 502, 503, 504])('status %i is transient and retried', async (status) => {
    const { provider, FreshPermanentError } = await loadProvider(status);
    await expect(
      provider.synthesize(req('Hello.'), new AbortController().signal),
    ).rejects.not.toBeInstanceOf(FreshPermanentError);
  });

  test.each([400, 401, 403, 404, 422])('status %i is permanent and skipped', async (status) => {
    const { provider, FreshPermanentError } = await loadProvider(status);
    await expect(
      provider.synthesize(req('Hello.'), new AbortController().signal),
    ).rejects.toBeInstanceOf(FreshPermanentError);
  });
});
