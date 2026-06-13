import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock control: tests can override createBehavior to change how create() behaves
let createBehavior: () => Promise<undefined> = () => Promise.resolve(undefined);

// Shared mock control for createAudioUrl() and parsed SSML marks
let createAudioUrlBehavior = vi.fn<() => Promise<string>>(() => Promise.resolve('blob:mock-url'));
type MockAudioResult = {
  url: string;
  boundaries: Array<{ offset: number; duration: number; text: string }>;
};
let createAudioBehavior = vi.fn<() => Promise<MockAudioResult>>(() =>
  Promise.resolve({ url: 'blob:mock-url', boundaries: [] }),
);
let parsedMarks: Array<{ name: string; text: string; language: string }> = [];

// --- Mocks ---

vi.mock('@/libs/edgeTTS', () => {
  const voices = [
    { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US' },
    { id: 'en-US-AnaNeural', name: 'Ana', lang: 'en-US' },
    { id: 'en-GB-SoniaNeural', name: 'Sonia', lang: 'en-GB' },
    { id: 'fr-FR-DeniseNeural', name: 'Denise', lang: 'fr-FR' },
  ];
  return {
    EdgeSpeechTTS: class MockEdgeSpeechTTS {
      static voices = voices;
      create = vi.fn().mockImplementation(() => createBehavior());
      createAudioUrl = vi.fn().mockImplementation(() => createAudioUrlBehavior());
      createAudio = vi.fn().mockImplementation(() => createAudioBehavior());
    },
    EDGE_TTS_PROTOCOL: 'wss',
  };
});

vi.mock('@/utils/ssml', () => ({
  parseSSMLMarks: vi.fn(() => ({ marks: parsedMarks })),
}));

vi.mock('@/utils/misc', () => ({
  getUserLocale: vi.fn((lang: string) => (lang === 'en' ? 'en-US' : lang)),
}));

vi.mock('@/services/tts/TTSUtils', async (importOriginal) => {
  const { TTSUtils: ActualTTSUtils } =
    await importOriginal<typeof import('@/services/tts/TTSUtils')>();
  return {
    TTSUtils: {
      getPreferredVoice: vi.fn(() => null),
      sortVoicesFunc: ActualTTSUtils.sortVoicesFunc,
      sortVoicesPreferLocaleFunc: ActualTTSUtils.sortVoicesPreferLocaleFunc,
    },
  };
});

import { EdgeTTSClient } from '@/services/tts/EdgeTTSClient';
import { TTSController } from '@/services/tts/TTSController';

// Suppress console noise during tests
const consoleSpy = {
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
};
void consoleSpy;

describe('EdgeTTSClient', () => {
  let client: EdgeTTSClient;

  beforeEach(() => {
    createBehavior = () => Promise.resolve(undefined);
    createAudioUrlBehavior = vi.fn<() => Promise<string>>(() => Promise.resolve('blob:mock-url'));
    createAudioBehavior = vi.fn<() => Promise<MockAudioResult>>(() =>
      Promise.resolve({ url: 'blob:mock-url', boundaries: [] }),
    );
    parsedMarks = [];
    client = new EdgeTTSClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    test('sets name to edge-tts', () => {
      expect(client.name).toBe('edge-tts');
    });

    test('starts uninitialized', () => {
      expect(client.initialized).toBe(false);
    });

    test('stores controller and appService when provided', () => {
      const mockController = {} as TTSController;
      const mockAppService = { isLinuxApp: false } as never;
      const c = new EdgeTTSClient(mockController, mockAppService);
      expect(c.controller).toBe(mockController);
      expect(c.appService).toBe(mockAppService);
    });

    test('controller and appService are undefined when not provided', () => {
      expect(client.controller).toBeUndefined();
      expect(client.appService).toBeUndefined();
    });
  });

  describe('init', () => {
    test('succeeds when create resolves and sets initialized to true', async () => {
      const result = await client.init();
      expect(result).toBe(true);
      expect(client.initialized).toBe(true);
    });

    test('populates voices from EdgeSpeechTTS.voices on init', async () => {
      await client.init();
      const voices = await client.getAllVoices();
      expect(voices).toHaveLength(4);
      expect(voices.map((v) => v.id)).toContain('en-US-AriaNeural');
    });

    test('wss failure falls back to https when controller is authenticated', async () => {
      const mockController = {
        isAuthenticated: true,
        dispatchEvent: vi.fn(),
      } as unknown as TTSController;
      const c = new EdgeTTSClient(mockController);

      // First call (wss protocol) fails, second call (https fallback) succeeds
      let callCount = 0;
      createBehavior = () => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('wss failed'));
        return Promise.resolve(undefined);
      };

      const result = await c.init();
      expect(result).toBe(true);
      expect(c.initialized).toBe(true);
      // Two calls: initial wss attempt + https fallback
      expect(callCount).toBe(2);
    });

    test('wss failure dispatches tts-need-auth when not authenticated', async () => {
      const dispatchEvent = vi.fn();
      const mockController = {
        isAuthenticated: false,
        dispatchEvent,
      } as unknown as TTSController;
      const c = new EdgeTTSClient(mockController);

      createBehavior = () => Promise.reject(new Error('wss failed'));

      const result = await c.init();
      expect(result).toBe(false);
      expect(dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'tts-need-auth' }),
      );
    });

    test('https failure sets initialized to false', async () => {
      const mockController = {
        isAuthenticated: true,
        dispatchEvent: vi.fn(),
      } as unknown as TTSController;
      const c = new EdgeTTSClient(mockController);

      // Both wss and https always fail
      createBehavior = () => Promise.reject(new Error('failed'));

      const result = await c.init();
      expect(result).toBe(false);
      expect(c.initialized).toBe(false);
    });
  });

  describe('setRate', () => {
    test('stores rate value', async () => {
      await client.setRate(1.5);
      // Rate is private, so we verify indirectly - no error thrown
      await expect(client.setRate(0.5)).resolves.toBeUndefined();
    });

    test('accepts boundary values', async () => {
      await expect(client.setRate(0.5)).resolves.toBeUndefined();
      await expect(client.setRate(2.0)).resolves.toBeUndefined();
    });
  });

  describe('setPitch', () => {
    test('stores pitch value', async () => {
      await expect(client.setPitch(1.2)).resolves.toBeUndefined();
    });

    test('accepts boundary values', async () => {
      await expect(client.setPitch(0.5)).resolves.toBeUndefined();
      await expect(client.setPitch(1.5)).resolves.toBeUndefined();
    });
  });

  describe('setVoice', () => {
    test('sets voice when voice id exists in voice list', async () => {
      await client.init();
      await client.setVoice('en-US-AriaNeural');
      expect(client.getVoiceId()).toBe('en-US-AriaNeural');
    });

    test('does not change voice id when voice id is not found', async () => {
      await client.init();
      await client.setVoice('en-US-AriaNeural');
      await client.setVoice('nonexistent-voice');
      expect(client.getVoiceId()).toBe('en-US-AriaNeural');
    });

    test('voice id remains empty when no voice has been set', () => {
      expect(client.getVoiceId()).toBe('');
    });
  });

  describe('setPrimaryLang', () => {
    test('sets primary language', () => {
      client.setPrimaryLang('fr');
      // No public getter for primaryLang, but we verify no error
      // The effect is observed when speak() uses it
    });

    test('accepts any language string', () => {
      client.setPrimaryLang('zh-CN');
      client.setPrimaryLang('ja');
      client.setPrimaryLang('en');
      // No error thrown
    });
  });

  describe('supportsWordBoundaries', () => {
    test('returns true (Edge reports word-boundary timings)', () => {
      expect(client.supportsWordBoundaries()).toBe(true);
    });
  });

  describe('getGranularities', () => {
    test('returns array with sentence granularity only', () => {
      const granularities = client.getGranularities();
      expect(granularities).toEqual(['sentence']);
    });

    test('returns the same value regardless of initialization', async () => {
      const before = client.getGranularities();
      await client.init();
      const after = client.getGranularities();
      expect(before).toEqual(after);
    });
  });

  describe('getVoiceId', () => {
    test('returns empty string by default', () => {
      expect(client.getVoiceId()).toBe('');
    });

    test('returns the set voice id after setVoice', async () => {
      await client.init();
      await client.setVoice('fr-FR-DeniseNeural');
      expect(client.getVoiceId()).toBe('fr-FR-DeniseNeural');
    });
  });

  describe('getSpeakingLang', () => {
    test('returns empty string by default', () => {
      expect(client.getSpeakingLang()).toBe('');
    });
  });

  describe('getAllVoices', () => {
    test('returns voices from EdgeSpeechTTS after init', async () => {
      await client.init();
      const voices = await client.getAllVoices();
      expect(voices).toHaveLength(4);
      expect(voices[0]!.id).toBe('en-US-AriaNeural');
    });

    test('marks voices as disabled when not initialized', async () => {
      // Do NOT call init
      const voices = await client.getAllVoices();
      for (const voice of voices) {
        expect(voice.disabled).toBe(true);
      }
    });

    test('marks voices as enabled when initialized', async () => {
      await client.init();
      const voices = await client.getAllVoices();
      for (const voice of voices) {
        expect(voice.disabled).toBe(false);
      }
    });

    test('returns empty array before init since voices are assigned during init', async () => {
      // Before init, #voices is the empty default
      const voices = await client.getAllVoices();
      // Actually, the constructor doesn't call init, so #voices starts as []
      // But wait - init sets #voices = EdgeSpeechTTS.voices. Without init, it stays [].
      // However, getAllVoices returns this.#voices which starts as [].
      // Let's check: the mock voices are set on static, not on the instance default.
      expect(voices).toHaveLength(0);
    });
  });

  describe('getVoices', () => {
    beforeEach(async () => {
      await client.init();
    });

    test('filters voices by language prefix', async () => {
      const groups = await client.getVoices('fr-FR');
      expect(groups).toHaveLength(1);
      expect(groups[0]!.id).toBe('edge-tts');
      expect(groups[0]!.name).toBe('Edge TTS');
      expect(groups[0]!.voices).toHaveLength(1);
      expect(groups[0]!.voices[0]!.id).toBe('fr-FR-DeniseNeural');
    });

    test('handles "en" by expanding to locale and including en-US and en-GB', async () => {
      const groups = await client.getVoices('en');
      const voiceIds = groups[0]!.voices.map((v) => v.id);
      expect(voiceIds).toContain('en-US-AriaNeural');
      expect(voiceIds).toContain('en-US-AnaNeural');
      expect(voiceIds).toContain('en-GB-SoniaNeural');
    });

    test('returns sorted voices with user-locale voices first for "en"', async () => {
      // getUserLocale is mocked to return en-US for 'en'
      const groups = await client.getVoices('en');
      const voiceIds = groups[0]!.voices.map((v) => v.id);
      expect(voiceIds).toEqual(['en-US-AnaNeural', 'en-US-AriaNeural', 'en-GB-SoniaNeural']);
    });

    // #4033: the voice set must not change between parts of a single book that
    // mix region variants of the same language (e.g. en-US front matter and
    // en-GB body text in Standard Ebooks)
    test('returns the same English voice set for any region variant', async () => {
      const ids = async (lang: string) =>
        (await client.getVoices(lang))[0]!.voices.map((v) => v.id).sort();
      const us = await ids('en-US');
      const gb = await ids('en-GB');
      const en = await ids('en');
      expect(gb).toEqual(us);
      expect(en).toEqual(us);
      expect(us).toEqual(['en-GB-SoniaNeural', 'en-US-AnaNeural', 'en-US-AriaNeural']);
    });

    test('lists voices of the requested locale first', async () => {
      const gb = await client.getVoices('en-GB');
      expect(gb[0]!.voices[0]!.id).toBe('en-GB-SoniaNeural');
      const us = await client.getVoices('en-US');
      expect(us[0]!.voices[0]!.id).toBe('en-US-AnaNeural');
    });

    test('does not include voices from other languages', async () => {
      const fr = await client.getVoices('fr-FR');
      expect(fr[0]!.voices.map((v) => v.id)).toEqual(['fr-FR-DeniseNeural']);
      const en = await client.getVoices('en-US');
      expect(en[0]!.voices.map((v) => v.id)).not.toContain('fr-FR-DeniseNeural');
    });

    test('getVoiceIdFromLang still resolves an exact-locale default voice', async () => {
      expect(await client.getVoiceIdFromLang('en-GB')).toBe('en-GB-SoniaNeural');
      // AnaNeural sorts first for en-US but is avoided as default
      expect(await client.getVoiceIdFromLang('en-US')).toBe('en-US-AriaNeural');
    });

    test('marks group as disabled when not initialized', async () => {
      const uninitClient = new EdgeTTSClient();
      // We need voices to be populated but not initialized
      // Since uninitClient hasn't called init, #voices is empty
      const groups = await uninitClient.getVoices('en');
      expect(groups[0]!.disabled).toBe(true);
    });

    test('marks group as disabled when no matching voices found', async () => {
      const groups = await client.getVoices('zh-CN');
      expect(groups[0]!.disabled).toBe(true);
      expect(groups[0]!.voices).toHaveLength(0);
    });

    test('returns group not disabled when initialized and voices match', async () => {
      const groups = await client.getVoices('en');
      expect(groups[0]!.disabled).toBe(false);
    });
  });

  describe('shutdown', () => {
    test('sets initialized to false', async () => {
      await client.init();
      expect(client.initialized).toBe(true);
      await client.shutdown();
      expect(client.initialized).toBe(false);
    });

    test('clears the voice list', async () => {
      await client.init();
      const voicesBefore = await client.getAllVoices();
      expect(voicesBefore.length).toBeGreaterThan(0);

      await client.shutdown();
      const voicesAfter = await client.getAllVoices();
      expect(voicesAfter).toHaveLength(0);
    });

    test('can be called multiple times without error', async () => {
      await client.shutdown();
      await client.shutdown();
      expect(client.initialized).toBe(false);
    });

    test('can re-initialize after shutdown', async () => {
      await client.init();
      await client.shutdown();
      expect(client.initialized).toBe(false);

      await client.init();
      expect(client.initialized).toBe(true);
      const voices = await client.getAllVoices();
      expect(voices.length).toBeGreaterThan(0);
    });
  });

  describe('speak preload retry', () => {
    const consumePreload = async (c: EdgeTTSClient, signal: AbortSignal) => {
      for await (const _ of c.speak('<ssml/>', signal, true)) {
        void _;
      }
    };

    test('retries createAudioUrl up to 3 times when preload fails', async () => {
      await client.init();
      parsedMarks = [{ name: 'mark-0', text: 'hello', language: 'en' }];
      createAudioUrlBehavior = vi.fn(() => Promise.reject(new Error('network error')));

      await consumePreload(client, new AbortController().signal);

      expect(createAudioUrlBehavior).toHaveBeenCalledTimes(3);
    });

    test('does not retry when the first preload attempt succeeds', async () => {
      await client.init();
      parsedMarks = [{ name: 'mark-0', text: 'hello', language: 'en' }];

      await consumePreload(client, new AbortController().signal);

      expect(createAudioUrlBehavior).toHaveBeenCalledTimes(1);
    });

    test('stops retrying once an attempt succeeds', async () => {
      await client.init();
      parsedMarks = [{ name: 'mark-0', text: 'hello', language: 'en' }];
      let calls = 0;
      createAudioUrlBehavior = vi.fn(() => {
        calls++;
        return calls < 2
          ? Promise.reject(new Error('network error'))
          : Promise.resolve('blob:mock-url');
      });

      await consumePreload(client, new AbortController().signal);

      expect(createAudioUrlBehavior).toHaveBeenCalledTimes(2);
    });

    test('stops retrying once the signal is aborted', async () => {
      await client.init();
      parsedMarks = [{ name: 'mark-0', text: 'hello', language: 'en' }];
      const controller = new AbortController();
      createAudioUrlBehavior = vi.fn(() => {
        controller.abort();
        return Promise.reject(new Error('network error'));
      });

      await consumePreload(client, controller.signal);

      expect(createAudioUrlBehavior).toHaveBeenCalledTimes(1);
    });
  });

  describe('pause / resume / stop', () => {
    test('pause returns true when no audio element exists', async () => {
      const result = await client.pause();
      expect(result).toBe(true);
    });

    test('resume returns true when no audio element exists', async () => {
      const result = await client.resume();
      expect(result).toBe(true);
    });

    test('stop resolves without error when no audio element exists', async () => {
      await expect(client.stop()).resolves.toBeUndefined();
    });
  });

  describe('word boundary tracking during playback', () => {
    class MockAudio {
      static instances: MockAudio[] = [];
      src = '';
      currentTime = 0;
      preload = '';
      playbackRate = 1;
      onended: ((e?: Event) => void) | null = null;
      onerror: ((e?: unknown) => void) | null = null;
      constructor() {
        MockAudio.instances.push(this);
      }
      setAttribute() {}
      play() {
        return Promise.resolve();
      }
      pause() {}
    }

    let rafCallbacks: Map<number, FrameRequestCallback>;
    let rafId = 0;
    const runRaf = () => {
      const cbs = [...rafCallbacks.values()];
      rafCallbacks.clear();
      for (const cb of cbs) cb(0);
    };
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    let mockController: {
      dispatchSpeakMark: ReturnType<typeof vi.fn>;
      prepareSpeakWords: ReturnType<typeof vi.fn>;
      dispatchSpeakWord: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      MockAudio.instances = [];
      rafCallbacks = new Map();
      vi.stubGlobal('Audio', MockAudio);
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        rafCallbacks.set(++rafId, cb);
        return rafId;
      });
      vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        rafCallbacks.delete(id);
      });
      mockController = {
        dispatchSpeakMark: vi.fn(),
        prepareSpeakWords: vi.fn(),
        dispatchSpeakWord: vi.fn(),
      };
      client = new EdgeTTSClient(mockController as unknown as TTSController);
      parsedMarks = [{ name: '0', text: 'Hello brave world', language: 'en' }];
      createAudioBehavior = vi.fn(() =>
        Promise.resolve({
          url: 'blob:mock-url',
          boundaries: [
            { offset: 1_000_000, duration: 4_000_000, text: 'Hello' },
            { offset: 6_000_000, duration: 4_000_000, text: 'brave' },
            { offset: 11_000_000, duration: 4_000_000, text: 'world' },
          ],
        }),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const startSpeak = async () => {
      await client.init();
      const it = client.speak('<ssml/>', new AbortController().signal);
      const first = await it.next();
      expect((first.value as { code: string }).code).toBe('boundary');
      const resultPromise = it.next();
      await flush();
      const audio = MockAudio.instances.at(-1)!;
      return { it, resultPromise, audio };
    };

    test('prepares speak words and dispatches word indexes as playback advances', async () => {
      const { resultPromise, audio } = await startSpeak();

      expect(mockController.prepareSpeakWords).toHaveBeenCalledWith(['Hello', 'brave', 'world']);

      audio.currentTime = 0.11;
      runRaf();
      expect(mockController.dispatchSpeakWord).toHaveBeenCalledWith(0);

      audio.currentTime = 0.65;
      runRaf();
      expect(mockController.dispatchSpeakWord).toHaveBeenLastCalledWith(1);

      // Same word index is not re-dispatched on subsequent frames.
      const callCount = mockController.dispatchSpeakWord.mock.calls.length;
      runRaf();
      expect(mockController.dispatchSpeakWord.mock.calls.length).toBe(callCount);

      audio.onended?.();
      const result = await resultPromise;
      expect((result.value as { code: string }).code).toBe('end');
    });

    test('stops dispatching after the chunk ends', async () => {
      const { resultPromise, audio } = await startSpeak();

      audio.currentTime = 0.11;
      runRaf();
      const callCount = mockController.dispatchSpeakWord.mock.calls.length;

      audio.onended?.();
      await resultPromise;

      audio.currentTime = 1.2;
      runRaf();
      expect(mockController.dispatchSpeakWord.mock.calls.length).toBe(callCount);
    });

    test('hands empty words to the controller and does not track when no boundaries', async () => {
      createAudioBehavior = vi.fn(() => Promise.resolve({ url: 'blob:mock-url', boundaries: [] }));
      const { resultPromise, audio } = await startSpeak();

      // Empty words are still forwarded so the controller can draw the
      // sentence-highlight fallback; no per-word tracking is started.
      expect(mockController.prepareSpeakWords).toHaveBeenCalledWith([]);
      audio.currentTime = 0.5;
      runRaf();
      expect(mockController.dispatchSpeakWord).not.toHaveBeenCalled();

      audio.onended?.();
      await resultPromise;
    });
  });
});
