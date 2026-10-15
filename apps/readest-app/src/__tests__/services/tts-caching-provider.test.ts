import { beforeEach, describe, expect, test, vi } from 'vitest';

import { CachingProvider, computeTTSCacheKey, TTSCacheStore } from '@/services/tts/providers/cache';
import {
  SpeechProvider,
  SpeechSynthesisPermanentError,
  SpeechSynthesisResult,
} from '@/services/tts/providers/types';

const BOUNDARIES = [{ offset: 0, duration: 1_000_000, text: 'hello' }];

const makeInner = (overrides: Partial<SpeechProvider> = {}): SpeechProvider => ({
  id: 'fake',
  label: 'Fake',
  cacheable: true,
  init: vi.fn().mockResolvedValue(true),
  getAllVoices: vi.fn().mockResolvedValue([]),
  synthesize: vi.fn().mockImplementation(
    async (): Promise<SpeechSynthesisResult> => ({
      audio: new ArrayBuffer(8),
      boundaries: BOUNDARIES,
    }),
  ),
  ...overrides,
});

class MemoryStore implements TTSCacheStore {
  map = new Map<string, { audio: ArrayBuffer; boundaries: typeof BOUNDARIES }>();
  get = vi.fn().mockImplementation(async (key: string) => this.map.get(key) ?? null);
  put = vi.fn().mockImplementation(async (key: string, entry: never) => {
    this.map.set(key, entry);
  });
}

const req = (text = 'hello') => ({ lang: 'en', text, voice: 'v1', pitch: 1.0 });
const signal = () => new AbortController().signal;

describe('CachingProvider', () => {
  let inner: SpeechProvider;
  let store: MemoryStore;
  let provider: CachingProvider;

  beforeEach(() => {
    inner = makeInner();
    store = new MemoryStore();
    provider = new CachingProvider(inner, store);
  });

  test('clearing downloads forgets the audio kept in memory too', async () => {
    const clearing = Object.assign(store, {
      clearDownloads: vi.fn(async () => store.map.clear()),
    });
    await provider.synthesize(req('a'), signal());
    await provider.clearDownloads();
    expect(clearing.clearDownloads).toHaveBeenCalled();
    // Served from memory, it would never reach the store again, so the
    // re-downloaded section could not pack.
    await provider.synthesize(req('a'), signal());
    expect(inner.synthesize).toHaveBeenCalledTimes(2);
    expect(store.put).toHaveBeenCalledTimes(2);
  });

  test('tells the inner provider when the cache serves a sentence it may still have pending', async () => {
    const fulfill = vi.fn();
    const withFulfill = new CachingProvider(makeInner({ fulfill }), store);
    await withFulfill.synthesize(req('a'), signal());
    expect(fulfill).not.toHaveBeenCalled();
    // From memory, then (a fresh provider) from the store.
    await withFulfill.synthesize(req('a'), signal());
    await new CachingProvider(makeInner({ fulfill }), store).synthesize(req('a'), signal());
    expect(fulfill).toHaveBeenCalledTimes(2);
    expect(fulfill).toHaveBeenCalledWith(
      req('a'),
      expect.objectContaining({ boundaries: BOUNDARIES }),
    );
  });

  test('a synced pack that brings a sentence a fill is waiting on fulfils it', async () => {
    let onImported: (keys: string[]) => void = () => {};
    const importing = Object.assign(new MemoryStore(), {
      onImported: (listener: (keys: string[]) => void) => {
        onImported = listener;
      },
    });
    const fulfill = vi.fn();
    const pending = makeInner({
      fulfill,
      synthesize: vi.fn(() => new Promise<SpeechSynthesisResult>(() => {})),
    });
    const withSync = new CachingProvider(pending, importing);
    void withSync.synthesize(req('a'), signal());
    await new Promise((r) => setTimeout(r, 0));
    // The pull imports the pack after the fill's own lookup missed.
    importing.get.mockImplementation(async () => ({
      audio: new ArrayBuffer(4),
      boundaries: BOUNDARIES,
    }));
    onImported([computeTTSCacheKey('fake', req('a')), 'unrelated']);
    await new Promise((r) => setTimeout(r, 0));
    expect(fulfill).toHaveBeenCalledWith(
      req('a'),
      expect.objectContaining({ boundaries: BOUNDARIES }),
    );
  });

  test('finds the sentences of a section already stored and records their marks in one go', async () => {
    const batched = Object.assign(store, {
      cachedKeys: vi.fn(async (keys: string[]) => new Set(keys.filter((k) => store.map.has(k)))),
      recordMarkKeys: vi.fn(async () => {}),
    });
    await provider.synthesize(req('b'), signal());
    const cached = await provider.cachedSentences(7, [
      { ordinal: 0, req: req('a') },
      { ordinal: 1, req: req('b') },
    ]);
    expect(cached).toEqual(new Set([1]));
    expect(batched.recordMarkKeys).toHaveBeenCalledWith(7, [
      { ordinal: 1, key: computeTTSCacheKey('fake', req('b')) },
    ]);
  });

  test('mirrors the inner provider voice-language policy', () => {
    expect(provider.sameLanguageVoicesOnly).toBeUndefined();
    const strict = new CachingProvider(makeInner({ sameLanguageVoicesOnly: true }), store);
    expect(strict.sameLanguageVoicesOnly).toBe(true);
  });

  test("lists voices in the inner provider's order", () => {
    const compareVoices = vi.fn(() => -1);
    const sorted = new CachingProvider(makeInner({ compareVoices }), store);
    sorted.compareVoices!({ id: 'a', name: 'A', lang: 'en' }, { id: 'b', name: 'B', lang: 'en' });
    expect(compareVoices).toHaveBeenCalled();
    expect(new CachingProvider(makeInner(), store).compareVoices).toBeUndefined();
  });

  test('init starts opening the store, so the first lookup does not pay for it', async () => {
    const opening = Object.assign(new MemoryStore(), {
      open: vi.fn().mockResolvedValue(undefined),
    });
    await new CachingProvider(inner, opening).init();
    expect(opening.open).toHaveBeenCalledTimes(1);
  });

  test('mirrors the inner provider identity', () => {
    expect(provider.id).toBe('fake');
    expect(provider.label).toBe('Fake');
  });

  test('cache miss synthesizes once and stores the result', async () => {
    const result = await provider.synthesize(req(), signal());
    expect(result.boundaries).toEqual(BOUNDARIES);
    expect(inner.synthesize).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  test('a changed cache scope misses audio cached under the old one', async () => {
    let scope = 'model-a';
    provider = new CachingProvider(makeInner({ ...inner, cacheScope: () => scope }), store);
    await provider.synthesize(req(), signal());
    scope = 'model-b';
    await provider.synthesize(req(), signal());
    expect(inner.synthesize).toHaveBeenCalledTimes(2);
    expect(store.map.size).toBe(2);
  });

  test('cache hit never reaches the inner provider', async () => {
    await provider.synthesize(req(), signal());
    const result = await provider.synthesize(req(), signal());
    expect(result.audio.byteLength).toBe(8);
    expect(result.boundaries).toEqual(BOUNDARIES);
    expect(inner.synthesize).toHaveBeenCalledTimes(1);
  });

  test('a sentence synthesized ahead plays from memory, without a store read', async () => {
    // Store reads cost hundreds of ms on device; the paragraph that was just
    // prefetched must not wait on one at the paragraph boundary.
    await provider.synthesize(req(), signal());
    store.get.mockClear();
    const result = await provider.synthesize(req(), signal());
    expect(result.boundaries).toEqual(BOUNDARIES);
    expect(store.get).not.toHaveBeenCalled();
    expect(inner.synthesize).toHaveBeenCalledTimes(1);
  });

  test('a sentence found by a prefetch plays from memory, without a second store read', async () => {
    store.map.set(
      (await import('@/services/tts/providers/cache')).computeTTSCacheKey('fake', req('old')),
      { audio: new ArrayBuffer(8), boundaries: BOUNDARIES },
    );
    const withPrefetch = new CachingProvider(makeInner({ prefetch: vi.fn() }), store);
    withPrefetch.prefetch?.([req('old')], 'listen', signal());
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.get.mockClear();
    const result = await withPrefetch.synthesize(req('old'), signal());
    expect(result.audio.byteLength).toBe(8);
    expect(store.get).not.toHaveBeenCalled();
  });

  test('hits hand out an independent buffer per call', async () => {
    // decodeAudioData detaches its input; a shared cached buffer would break
    // the second playback of the same sentence.
    await provider.synthesize(req(), signal());
    const a = await provider.synthesize(req(), signal());
    const b = await provider.synthesize(req(), signal());
    expect(a.audio).not.toBe(b.audio);
    new Uint8Array(a.audio); // touching one must not affect the other
    expect(b.audio.byteLength).toBe(8);
  });

  test('the key covers voice, pitch, and text but never rate', async () => {
    await provider.synthesize(req('one'), signal());
    await provider.synthesize(req('two'), signal());
    await provider.synthesize({ lang: 'en', text: 'one', voice: 'v2', pitch: 1.0 }, signal());
    await provider.synthesize({ lang: 'en', text: 'one', voice: 'v1', pitch: 1.2 }, signal());
    expect(inner.synthesize).toHaveBeenCalledTimes(4);
    await provider.synthesize(req('one'), signal());
    expect(inner.synthesize).toHaveBeenCalledTimes(4);
  });

  test('concurrent requests for the same key synthesize once', async () => {
    let release!: (r: SpeechSynthesisResult) => void;
    inner = makeInner({
      synthesize: vi
        .fn()
        .mockImplementation(() => new Promise<SpeechSynthesisResult>((r) => (release = r))),
    });
    provider = new CachingProvider(inner, store);
    const p1 = provider.synthesize(req(), signal());
    const p2 = provider.synthesize(req(), signal());
    // Let the store-miss resolve so the inner synthesize (and its
    // release handle) exists before firing it.
    await new Promise((r) => setTimeout(r, 0));
    release({ audio: new ArrayBuffer(8), boundaries: BOUNDARIES });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(inner.synthesize).toHaveBeenCalledTimes(1);
    expect(r1.boundaries).toEqual(r2.boundaries);
  });

  test('a non-cacheable inner provider bypasses the store entirely', async () => {
    inner = makeInner({ cacheable: false });
    provider = new CachingProvider(inner, store);
    await provider.synthesize(req(), signal());
    expect(store.get).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
    expect(inner.synthesize).toHaveBeenCalledTimes(1);
  });

  test('synthesis failures propagate and are never cached', async () => {
    inner = makeInner({
      synthesize: vi.fn().mockRejectedValue(new SpeechSynthesisPermanentError('no audio')),
    });
    provider = new CachingProvider(inner, store);
    await expect(provider.synthesize(req(), signal())).rejects.toBeInstanceOf(
      SpeechSynthesisPermanentError,
    );
    expect(store.put).not.toHaveBeenCalled();
    // The failed in-flight slot must not poison retries.
    await expect(provider.synthesize(req(), signal())).rejects.toBeInstanceOf(
      SpeechSynthesisPermanentError,
    );
    expect(inner.synthesize).toHaveBeenCalledTimes(2);
  });

  test('store failures degrade to synthesis instead of breaking playback', async () => {
    store.get.mockRejectedValue(new Error('disk gone'));
    store.put.mockRejectedValue(new Error('disk full'));
    const result = await provider.synthesize(req(), signal());
    expect(result.boundaries).toEqual(BOUNDARIES);
    expect(inner.synthesize).toHaveBeenCalledTimes(1);
  });

  test('shutdown closes the store and chains the inner provider', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const innerShutdown = vi.fn().mockResolvedValue(undefined);
    inner = makeInner({ shutdown: innerShutdown });
    const closableStore = Object.assign(new MemoryStore(), { close });
    provider = new CachingProvider(inner, closableStore);
    await provider.shutdown();
    expect(close).toHaveBeenCalledTimes(1);
    expect(innerShutdown).toHaveBeenCalledTimes(1);
  });

  test('delegates init, voices, and default-voice policy to the inner provider', async () => {
    inner = makeInner({
      pickDefaultVoice: () => 'v-picked',
      fallbackVoiceId: 'v-fallback',
    });
    provider = new CachingProvider(inner, store);
    await expect(provider.init()).resolves.toBe(true);
    expect(provider.pickDefaultVoice?.([])).toBe('v-picked');
    expect(provider.fallbackVoiceId).toBe('v-fallback');
  });
});

describe('CachingProvider.prefetch', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  // An inner provider whose synthesize resolves only when the test delivers,
  // like a windowed provider waiting on a streamed frame.
  const windowed = () => {
    const pending = new Map<string, (r: SpeechSynthesisResult) => void>();
    const inner = makeInner({
      prefetch: vi.fn(),
      synthesize: vi
        .fn()
        .mockImplementation(
          (r: { text: string }) =>
            new Promise<SpeechSynthesisResult>((resolve) => pending.set(r.text, resolve)),
        ),
    });
    const deliver = (text: string) =>
      pending.get(text)!({ audio: new ArrayBuffer(4), boundaries: BOUNDARIES });
    return { inner, deliver };
  };

  test('forwards only uncached requests, in order, with lane and options', async () => {
    const { inner, deliver } = windowed();
    const store = new MemoryStore();
    const provider = new CachingProvider(inner, store);
    const cached = provider.synthesize(req('b'), signal());
    await flush();
    deliver('b');
    await cached;
    const s = signal();
    provider.prefetch!([req('a'), req('b'), req('c')], 'listen', s, { background: true });
    await flush();
    expect(inner.prefetch).toHaveBeenCalledWith([req('a'), req('c')], 'listen', s, {
      background: true,
    });
  });

  test('checks a whole download against the cache in one lookup', async () => {
    const { inner, deliver } = windowed();
    const store = Object.assign(new MemoryStore(), {
      cachedKeys: vi.fn(async (keys: string[]) => new Set(keys.filter((k) => store.map.has(k)))),
    });
    const provider = new CachingProvider(inner, store);
    const cached = provider.synthesize(req('b'), signal());
    await flush();
    deliver('b');
    await cached;
    store.get.mockClear();
    const s = signal();
    provider.prefetch!([req('a'), req('b'), req('c')], 'download', s);
    await flush();
    expect(store.cachedKeys).toHaveBeenCalledTimes(1);
    expect(inner.prefetch).toHaveBeenCalledWith([req('a'), req('c')], 'download', s, undefined);
    // Handed off before any per-sentence read (only the fills read after).
    const forwarded = vi.mocked(inner.prefetch!).mock.invocationCallOrder[0]!;
    expect(store.get.mock.invocationCallOrder.every((order) => order > forwarded)).toBe(true);
  });

  test('persists a delivered sentence without a later synthesize call', async () => {
    const { inner, deliver } = windowed();
    const store = new MemoryStore();
    const provider = new CachingProvider(inner, store);
    provider.prefetch!([req('a')], 'download', signal());
    await flush();
    deliver('a');
    await flush();
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  test('fills the cache of a background prefetch without making it foreground', async () => {
    const { inner } = windowed();
    const provider = new CachingProvider(inner, new MemoryStore());
    const s = signal();
    provider.prefetch!([req('a')], 'listen', s, { background: true });
    await flush();
    expect(inner.synthesize).toHaveBeenCalledWith(req('a'), s, { background: true });
  });

  test('reports cached sentences to onDelivered instead of forwarding them', async () => {
    const { inner, deliver } = windowed();
    const provider = new CachingProvider(inner, new MemoryStore());
    const cached = provider.synthesize(req('b'), signal());
    await flush();
    deliver('b');
    await cached;
    const onDelivered = vi.fn();
    provider.prefetch!([req('b')], 'listen', signal(), { onDelivered });
    await flush();
    expect(onDelivered).toHaveBeenCalledWith(
      req('b'),
      expect.objectContaining({ boundaries: BOUNDARIES }),
    );
    expect(inner.prefetch).not.toHaveBeenCalled();
  });

  test('a later synthesize joins the prefetch (inner synthesizes once)', async () => {
    const { inner, deliver } = windowed();
    const provider = new CachingProvider(inner, new MemoryStore());
    provider.prefetch!([req('a')], 'listen', signal());
    await flush();
    const joined = provider.synthesize(req('a'), signal());
    deliver('a');
    expect((await joined).audio.byteLength).toBe(4);
    expect(inner.synthesize).toHaveBeenCalledTimes(1);
  });

  test('still forwards requests already in flight, without a second synthesis', async () => {
    // A preload's cache fill may already be running when its paragraph starts:
    // the foreground prefetch must reach the provider so it can raise its priority.
    const { inner } = windowed();
    const provider = new CachingProvider(inner, new MemoryStore());
    void provider.synthesize(req('a'), signal());
    provider.prefetch!([req('a'), req('b')], 'listen', signal());
    await flush();
    expect(vi.mocked(inner.prefetch!).mock.calls[0]![0]).toEqual([req('a'), req('b')]);
    expect(vi.mocked(inner.synthesize).mock.calls.map(([r]) => r.text)).toEqual(['a', 'b']);
  });

  test('cacheable: false forwards everything and starts no synthesis', async () => {
    const { inner } = windowed();
    Object.assign(inner, { cacheable: false });
    const provider = new CachingProvider(inner, new MemoryStore());
    provider.prefetch!([req('a')], 'listen', signal());
    await flush();
    expect(inner.prefetch).toHaveBeenCalledWith([req('a')], 'listen', expect.anything(), undefined);
    expect(inner.synthesize).not.toHaveBeenCalled();
  });

  test('swallows failures of the detached synthesis', async () => {
    const inner = makeInner({
      prefetch: vi.fn(),
      synthesize: vi.fn().mockRejectedValue(new SpeechSynthesisPermanentError('no audio')),
    });
    const provider = new CachingProvider(inner, new MemoryStore());
    provider.prefetch!([req('a')], 'listen', signal());
    await flush();
    await flush();
    expect(inner.synthesize).toHaveBeenCalledTimes(1);
  });

  test('offers prefetch only when the inner provider has one', () => {
    expect(new CachingProvider(makeInner(), new MemoryStore()).prefetch).toBeUndefined();
    const windowed = makeInner({ prefetch: vi.fn() });
    expect(new CachingProvider(windowed, new MemoryStore()).prefetch).toBeTypeOf('function');
  });
});
