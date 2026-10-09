import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { TTSMessageEvent } from '@/services/tts/TTSClient';
import type { TTSController } from '@/services/tts/TTSController';
import type {
  SpeechProvider,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from '@/services/tts/providers/types';
import { FakeAudioContext } from './tts-fake-audio';

// Scheduler behavior for providers that synthesize in windows (Readest Voice):
// fatal errors end the session, the scheduler prefetches a bounded lookahead,
// and paragraph preloads become background prefetches instead of synthesis.

let parsedMarks: Array<{ name: string; text: string; language: string }> = [];

vi.mock('@/utils/ssml', () => ({
  parseSSMLMarks: vi.fn(() => ({ marks: parsedMarks })),
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

vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredVoice: vi.fn(() => null),
    sortVoicesPreferLocaleFunc: () => () => 0,
  },
}));

vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'log').mockImplementation(() => {});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const audio = (): SpeechSynthesisResult => ({ audio: new ArrayBuffer(24000), boundaries: [] });

type Types = typeof import('@/services/tts/providers/types');
type Client = typeof import('@/services/tts/BufferedTTSClient').BufferedTTSClient;

describe('BufferedTTSClient with a windowed provider', () => {
  let BufferedTTSClient: Client;
  let types: Types;
  let controller: TTSController;

  beforeEach(async () => {
    vi.resetModules();
    // Duration estimates calibrate per voice in localStorage; isolate tests.
    localStorage.clear();
    FakeAudioContext.instances = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    parsedMarks = [
      { name: '0', text: 'First sentence.', language: 'en' },
      { name: '1', text: 'Second sentence.', language: 'en' },
    ];
    controller = {
      dispatchSpeakMark: vi.fn(),
      prepareSpeakWords: vi.fn(),
      dispatchSpeakWord: vi.fn(),
    } as unknown as TTSController;
    // Enter at EdgeTTSClient: constants.ts circularly imports it.
    await import('@/services/tts/EdgeTTSClient');
    ({ BufferedTTSClient } = await import('@/services/tts/BufferedTTSClient'));
    types = await import('@/services/tts/providers/types');
  });

  afterEach(() => vi.unstubAllGlobals());

  const makeProvider = (overrides: Partial<SpeechProvider> = {}): SpeechProvider => ({
    id: 'windowed',
    label: 'Windowed',
    init: async () => true,
    getAllVoices: async () => [{ id: 'v1', name: 'Voice 1', lang: 'en-US' }],
    synthesize: vi.fn(async () => audio()),
    ...overrides,
  });

  const start = async (provider: SpeechProvider) => {
    const client = new BufferedTTSClient(provider, controller);
    await client.init();
    return client;
  };

  const speak = (client: InstanceType<Client>, signal: AbortSignal, preload = false) => {
    const events: TTSMessageEvent[] = [];
    const done = (async () => {
      for await (const event of await client.speak('<ssml/>', signal, preload)) events.push(event);
    })();
    return { events, done };
  };

  describe('fatal errors', () => {
    test('end the session at once: no retry, no skip, no further marks', async () => {
      const synthesize = vi.fn(async () => {
        throw new types.SpeechSynthesisFatalError('DAILY_QUOTA_EXCEEDED');
      });
      const client = await start(makeProvider({ synthesize }));
      const { events, done } = speak(client, new AbortController().signal);
      await done;
      expect(events.map((e) => e.code)).toEqual(['error']);
      expect(events[0]!.message).toBe('DAILY_QUOTA_EXCEEDED');
      expect(synthesize).toHaveBeenCalledTimes(1);
    });

    test('warmSentence rethrows them; other failures still return false', async () => {
      const { CachingProvider } = await import('@/services/tts/providers/cache');
      const store = { get: async () => null, put: async () => {} };
      const fatal = makeProvider({
        synthesize: vi.fn(async () => {
          throw new types.SpeechSynthesisFatalError('DAILY_QUOTA_EXCEEDED');
        }),
      });
      const client = await start(new CachingProvider(fatal, store));
      await expect(client.warmSentence(0, 0, 'en', 'Hi.')).rejects.toBeInstanceOf(
        types.SpeechSynthesisFatalError,
      );
      const permanent = makeProvider({
        synthesize: vi.fn(async () => {
          throw new types.SpeechSynthesisPermanentError('no audio');
        }),
      });
      const other = await start(new CachingProvider(permanent, store));
      await expect(other.warmSentence(0, 0, 'en', 'Hi.')).resolves.toBe(false);
    });
  });

  describe('listen prefetch', () => {
    const prefetchCalls = (provider: SpeechProvider) =>
      vi.mocked(provider.prefetch!).mock.calls.map(([reqs, lane, , options]) => ({
        texts: (reqs as SpeechSynthesisRequest[]).map((r) => r.text),
        lane,
        options,
      }));

    test('prefetches the current mark and its lookahead before synthesizing it', async () => {
      const order: string[] = [];
      const provider = makeProvider({
        prefetch: vi.fn((reqs: SpeechSynthesisRequest[]) => {
          order.push(`prefetch:${reqs[0]!.text}`);
        }),
        synthesize: vi.fn(async (req: SpeechSynthesisRequest) => {
          order.push(`synth:${req.text}`);
          return audio();
        }),
      });
      const client = await start(provider);
      speak(client, new AbortController().signal);
      await flush();
      await flush();
      expect(prefetchCalls(provider)[0]).toEqual({
        texts: ['First sentence.', 'Second sentence.'],
        lane: 'listen',
        options: undefined,
      });
      expect(order.slice(0, 2)).toEqual(['prefetch:First sentence.', 'synth:First sentence.']);
    });

    test('caps the lookahead at 8 marks', async () => {
      parsedMarks = Array.from({ length: 12 }, (_, i) => ({
        name: String(i),
        text: `Sentence ${i}.`,
        language: 'en',
      }));
      const provider = makeProvider({ prefetch: vi.fn() });
      const client = await start(provider);
      speak(client, new AbortController().signal);
      await flush();
      expect(prefetchCalls(provider)[0]!.texts).toHaveLength(8);
    });

    test('caps the lookahead at about 30 seconds of estimated audio', async () => {
      // 200 Latin chars is about 13 s at the default estimate: two fit, three do not.
      parsedMarks = Array.from({ length: 4 }, (_, i) => ({
        name: String(i),
        text: `${i}`.padEnd(200, 'a'),
        language: 'en',
      }));
      const provider = makeProvider({ prefetch: vi.fn() });
      const client = await start(provider);
      speak(client, new AbortController().signal);
      await flush();
      expect(prefetchCalls(provider)[0]!.texts).toHaveLength(2);
    });

    test('preloads become a background prefetch of the first two marks, never synthesis', async () => {
      parsedMarks = Array.from({ length: 5 }, (_, i) => ({
        name: String(i),
        text: `Sentence ${i}.`,
        language: 'en',
      }));
      const provider = makeProvider({ prefetch: vi.fn() });
      const client = await start(provider);
      const { events, done } = speak(client, new AbortController().signal, true);
      await done;
      expect(events.map((e) => e.code)).toEqual(['end']);
      expect(prefetchCalls(provider)).toEqual([
        { texts: ['Sentence 0.', 'Sentence 1.'], lane: 'listen', options: { background: true } },
      ]);
      expect(provider.synthesize).not.toHaveBeenCalled();
    });

    test('providers without prefetch keep synthesizing preloads', async () => {
      const provider = makeProvider();
      const client = await start(provider);
      await speak(client, new AbortController().signal, true).done;
      expect(provider.synthesize).toHaveBeenCalled();
    });
  });
  describe('downloads', () => {
    test('prefetchSentences hands a section to the provider on the download lane', async () => {
      const prefetch = vi.fn();
      const client = await start(makeProvider({ prefetch }));
      const signal = new AbortController().signal;
      await client.prefetchSentences(
        [
          { lang: 'en', text: 'A.' },
          { lang: 'en', text: 'B.' },
        ],
        signal,
      );
      expect(prefetch).toHaveBeenCalledWith(
        [
          { lang: 'en', text: 'A.', voice: 'v1', pitch: 1 },
          { lang: 'en', text: 'B.', voice: 'v1', pitch: 1 },
        ],
        'download',
        signal,
      );
    });
  });
});
