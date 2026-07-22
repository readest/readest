import { beforeEach, describe, expect, test, vi } from 'vitest';

// Offline: every Edge transport probe rejects.
let createRejects = true;

vi.mock('@/libs/edgeTTS', () => ({
  EdgeSpeechTTS: class MockEdgeSpeechTTS {
    static voices = [{ id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US' }];
    create = vi
      .fn()
      .mockImplementation(() =>
        createRejects ? Promise.reject(new Error('offline')) : Promise.resolve(undefined),
      );
    createAudioData = vi.fn().mockRejectedValue(new Error('offline'));
  },
  EDGE_TTS_PROTOCOL: 'wss',
}));

vi.mock('@/utils/misc', () => ({
  getUserLocale: vi.fn((lang: string) => (lang === 'en' ? 'en-US' : lang)),
  getOSPlatform: vi.fn(() => 'macos'),
  stubTranslation: (key: string) => key,
}));

vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => false,
}));

// Cache config is toggled per test; the store itself is a no-op so no real
// database is opened.
let cacheEnabled = true;
const noopStore = {
  get: vi.fn().mockResolvedValue(null),
  put: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/services/tts/providers/bookCacheStore', () => ({
  getTTSCacheConfig: vi.fn(() => ({ enabled: cacheEnabled, budgetMB: 200, syncEnabled: false })),
  BookTTSCacheStore: class {
    get = noopStore.get;
    put = noopStore.put;
    close = noopStore.close;
  },
}));

import { EdgeTTSClient } from '@/services/tts/EdgeTTSClient';
import { EdgeSpeechProvider } from '@/services/tts/providers/edge';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';
import type { TTSController } from '@/services/tts/TTSController';
import type { AppService } from '@/types/system';

const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
void consoleSpy;

const fakeController = (authed: boolean) => {
  const events: string[] = [];
  return {
    controller: {
      isAuthenticated: authed,
      bookKey: 'hash1-xyz',
      dispatchEvent: (e: Event) => {
        events.push(e.type);
        return true;
      },
    } as unknown as TTSController,
    events,
  };
};

const fakeAppService = {} as AppService;

describe('EdgeTTSClient offline cache-only init', () => {
  beforeEach(() => {
    createRejects = true;
    cacheEnabled = true;
    vi.clearAllMocks();
  });

  test('initializes cache-only when the probe fails but a cache exists', async () => {
    const { controller, events } = fakeController(false);
    const client = new EdgeTTSClient(controller, fakeAppService);
    await expect(client.init()).resolves.toBe(true);
    expect(client.initialized).toBe(true);
    // A signed-out user with a warm cache must NOT be nagged to sign in.
    expect(events).not.toContain('tts-need-auth');
  });

  test('without a cache, an offline unauthenticated init fails and asks for auth', async () => {
    cacheEnabled = false;
    const { controller, events } = fakeController(false);
    const client = new EdgeTTSClient(controller, fakeAppService);
    await expect(client.init()).resolves.toBe(false);
    expect(client.initialized).toBe(false);
    expect(events).toContain('tts-need-auth');
  });

  test('a successful probe still initializes normally with a cache present', async () => {
    createRejects = false;
    const { controller } = fakeController(true);
    const client = new EdgeTTSClient(controller, fakeAppService);
    await expect(client.init()).resolves.toBe(true);
    expect(client.initialized).toBe(true);
  });
});

describe('EdgeSpeechProvider offline behavior', () => {
  test('a cache miss still attempts the fetch and propagates a NON-permanent error offline', async () => {
    // A permanent error would make the buffered client skip the sentence and
    // race to the end of the book. Offline, the fetch fails with a plain
    // (transient) error, which — after the client's retries — stops playback.
    createRejects = true;
    const provider = new EdgeSpeechProvider();
    await provider.init(); // transport probe fails
    const err = await provider
      .synthesize(
        { lang: 'en', text: 'hi', voice: 'en-US-AriaNeural', pitch: 1 },
        new AbortController().signal,
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SpeechSynthesisPermanentError);
  });
});
