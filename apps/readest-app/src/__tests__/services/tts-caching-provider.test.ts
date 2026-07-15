import { beforeEach, describe, expect, test, vi } from 'vitest';

import { CachingProvider, TTSCacheStore } from '@/services/tts/providers/cache';
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

  test('cache hit never reaches the inner provider', async () => {
    await provider.synthesize(req(), signal());
    const result = await provider.synthesize(req(), signal());
    expect(result.audio.byteLength).toBe(8);
    expect(result.boundaries).toEqual(BOUNDARIES);
    expect(inner.synthesize).toHaveBeenCalledTimes(1);
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
