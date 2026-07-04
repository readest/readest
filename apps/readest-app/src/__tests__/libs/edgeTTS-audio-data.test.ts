import { beforeEach, describe, expect, test, vi } from 'vitest';

const fetchWithAuthMock = vi.fn();

vi.mock('@/utils/fetch', () => ({
  fetchWithAuth: (...args: unknown[]) => fetchWithAuthMock(...args),
}));

vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => 'http://api.test',
  isTauriAppPlatform: () => false,
}));

import {
  EdgeSpeechTTS,
  type EdgeTTSPayload,
  hashTTSPayload,
  serializeWordBoundaries,
  WORD_BOUNDARIES_HEADER,
} from '@/libs/edgeTTS';

const makePayload = (text: string): EdgeTTSPayload => ({
  lang: 'en',
  text,
  voice: 'en-US-AriaNeural',
  rate: 1.0,
  pitch: 1.0,
});

const makeResponse = () =>
  new Response(new Uint8Array([1, 2, 3, 4]).buffer, {
    status: 200,
    headers: {
      [WORD_BOUNDARIES_HEADER]: serializeWordBoundaries([
        { offset: 1_000_000, duration: 4_000_000, text: 'hello' },
      ]),
    },
  });

describe('hashTTSPayload', () => {
  test('is stable for equal payload content', () => {
    expect(hashTTSPayload(makePayload('abc'))).toBe(hashTTSPayload(makePayload('abc')));
  });

  test('differs when payload fields differ', () => {
    expect(hashTTSPayload(makePayload('abc'))).not.toBe(hashTTSPayload(makePayload('abd')));
    expect(hashTTSPayload({ ...makePayload('abc'), pitch: 1.2 })).not.toBe(
      hashTTSPayload(makePayload('abc')),
    );
  });
});

describe('createAudioData', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    fetchWithAuthMock.mockImplementation(async () => makeResponse());
  });

  test('returns audio bytes and boundaries from the network on first call', async () => {
    const tts = new EdgeSpeechTTS('https');
    const { data, boundaries } = await tts.createAudioData(makePayload('first call text'));
    expect(new Uint8Array(data)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]!.text).toBe('hello');
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(1);
  });

  test('serves the second call from cache with a fresh, non-detached buffer', async () => {
    const tts = new EdgeSpeechTTS('https');
    const payload = makePayload('cache hit text');
    const first = await tts.createAudioData(payload);
    const second = await tts.createAudioData(payload);
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(1);
    // WebKit's decodeAudioData detaches its input; every call must get its
    // own copy so replay from cache cannot hand out a detached buffer.
    expect(second.data).not.toBe(first.data);
    expect(first.data.byteLength).toBe(4);
    expect(second.data.byteLength).toBe(4);
    expect(second.boundaries).toHaveLength(1);
  });

  test('deduplicates concurrent in-flight fetches for the same payload', async () => {
    let release: (() => void) | undefined;
    fetchWithAuthMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(makeResponse());
        }),
    );
    const tts = new EdgeSpeechTTS('https');
    const payload = makePayload('concurrent text');
    const p1 = tts.createAudioData(payload);
    const p2 = tts.createAudioData(payload);
    await Promise.resolve();
    release!();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(r1.data)).toEqual(new Uint8Array(r2.data));
  });

  test('a failed fetch is not cached; the next call retries', async () => {
    fetchWithAuthMock.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    const tts = new EdgeSpeechTTS('https');
    const payload = makePayload('retry after failure');
    await expect(tts.createAudioData(payload)).rejects.toThrow('network down');
    const { data } = await tts.createAudioData(payload);
    expect(data.byteLength).toBe(4);
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(2);
  });
});
