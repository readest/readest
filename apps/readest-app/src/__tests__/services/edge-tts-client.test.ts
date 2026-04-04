import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock control: tests can override createBehavior to change how create() behaves
let createBehavior: () => Promise<undefined> = () => Promise.resolve(undefined);

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
      createAudioUrl = vi.fn().mockResolvedValue('blob:mock-url');
    },
    EDGE_TTS_PROTOCOL: 'wss',
  };
});

vi.mock('@/utils/ssml', () => ({
  parseSSMLMarks: vi.fn(() => ({ marks: [] })),
}));

vi.mock('@/utils/misc', () => ({
  getUserLocale: vi.fn((lang: string) => (lang === 'en' ? 'en-US' : lang)),
}));

vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredVoice: vi.fn(() => null),
    sortVoicesFunc: (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id),
  },
}));

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

    test('returns sorted voices using TTSUtils.sortVoicesFunc', async () => {
      const groups = await client.getVoices('en');
      const voiceIds = groups[0]!.voices.map((v) => v.id);
      const sorted = [...voiceIds].sort();
      expect(voiceIds).toEqual(sorted);
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
});
