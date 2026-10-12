import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import type { TTSGranularity, TTSVoice } from '@/services/tts/types';
import type { FoliateView } from '@/types/view';
import type { AppService } from '@/types/system';

// Controller wiring of Readest Voice: a BufferedTTSClient over the Readest
// provider, sharing Edge's per-book cache store, registered everywhere the
// controller used to know only Edge.

const h = vi.hoisted(() => ({
  edgeArgs: [] as unknown[][],
  bufferedArgs: [] as unknown[][],
  readestClient: null as Record<string, unknown> | null,
  warmup: vi.fn(),
  store: { get: async () => null, put: async () => {} },
  readestInit: true,
  readestVoices: [] as TTSVoice[],
}));

function mockClient(name: string): TTSClient {
  return {
    name,
    initialized: false,
    init: vi.fn().mockImplementation(async function (this: { initialized: boolean }) {
      this.initialized = true;
      return true;
    }),
    shutdown: vi.fn().mockResolvedValue(undefined),
    speak: vi.fn().mockImplementation(async function* (): AsyncGenerator<TTSMessageEvent> {
      yield { code: 'end' };
    }),
    pause: vi.fn().mockResolvedValue(true),
    resume: vi.fn().mockResolvedValue(true),
    stop: vi.fn().mockResolvedValue(undefined),
    setPrimaryLang: vi.fn(),
    setRate: vi.fn().mockResolvedValue(undefined),
    setPitch: vi.fn().mockResolvedValue(undefined),
    setVoice: vi.fn().mockResolvedValue(undefined),
    getAllVoices: vi.fn().mockResolvedValue([]),
    getVoices: vi.fn().mockResolvedValue([]),
    getGranularities: vi.fn().mockReturnValue(['sentence'] as TTSGranularity[]),
    getCapabilities: vi.fn().mockReturnValue({
      wordBoundaries: true,
      mediaClock: true,
      gapControl: true,
      liveRateChange: false,
    }),
    getVoiceId: vi.fn().mockReturnValue('voice-1'),
    getSpeakingLang: vi.fn().mockReturnValue('en'),
  };
}

const bufferedExtras = () => ({
  setSentenceGap: vi.fn(),
  setParagraphGap: vi.fn(),
  canDownload: vi.fn().mockReturnValue(true),
  getSectionCacheStatuses: vi.fn().mockResolvedValue(new Map()),
  getCacheBytes: vi.fn().mockResolvedValue(0),
  beginDownloadSections: vi.fn(),
  completeDownloadSections: vi.fn(),
  cancelDownloadSections: vi.fn(),
  clearDownloads: vi.fn(),
});

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockClient('web-speech'));
  }),
}));
vi.mock('@/services/tts/EdgeTTSClient', () => ({
  // constants.ts imports this from here (circular import in production code).
  DEFAULT_SENTENCE_GAP_SEC: 0.15,
  EdgeTTSClient: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    ...args: unknown[]
  ) {
    h.edgeArgs.push(args);
    Object.assign(this, mockClient('edge-tts'), bufferedExtras());
    (this['getAllVoices'] as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US' },
    ]);
  }),
}));
vi.mock('@/services/tts/NativeTTSClient', () => ({
  NativeTTSClient: vi.fn(),
}));
vi.mock('@/services/tts/BufferedTTSClient', () => ({
  BufferedTTSClient: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    ...args: unknown[]
  ) {
    h.bufferedArgs.push(args);
    Object.assign(this, mockClient('readest-tts'), bufferedExtras());
    (this['init'] as ReturnType<typeof vi.fn>).mockImplementation(async function (this: {
      initialized: boolean;
    }) {
      this.initialized = h.readestInit;
      return h.readestInit;
    });
    (this['getAllVoices'] as ReturnType<typeof vi.fn>).mockImplementation(
      async () => h.readestVoices,
    );
    h.readestClient = this;
  }),
}));
vi.mock('@/services/tts/providers/readest', () => ({
  ReadestVoiceProvider: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, { id: 'readest-tts', warmup: h.warmup });
  }),
}));
vi.mock('@/services/tts/providers/bookCacheStore', async (orig) => ({
  ...(await orig<typeof import('@/services/tts/providers/bookCacheStore')>()),
  createBookTTSCacheStore: vi.fn(() => h.store),
}));
vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredClient: vi.fn().mockReturnValue(null),
    setPreferredClient: vi.fn(),
    setPreferredVoice: vi.fn(),
    getPreferredVoice: vi.fn().mockReturnValue(null),
  },
}));
vi.mock('foliate-js/overlayer.js', () => ({ Overlayer: { highlight: 'highlightFn' } }));
vi.mock('@/utils/node', () => ({ createRejectFilter: vi.fn(() => () => 1) }));

import { TTSController } from '@/services/tts/TTSController';
import { TTSUtils } from '@/services/tts/TTSUtils';
import { CachingProvider } from '@/services/tts/providers/cache';
import { createBookTTSCacheStore } from '@/services/tts/providers/bookCacheStore';

const READEST_VOICES = [{ id: 'kokoro:af_heart', name: 'Heart', lang: 'en-US' }];
const view = {
  renderer: { primaryIndex: 0, getContents: vi.fn().mockReturnValue([]) },
  book: { sections: [] },
  language: { isCJK: false },
  tts: null,
} as unknown as FoliateView;
const appService = { isAndroidApp: false, isIOSApp: false } as unknown as AppService;

let controller: TTSController;
const readest = () => h.readestClient as unknown as TTSClient & ReturnType<typeof bufferedExtras>;
const edge = () => controller.ttsEdgeClient as unknown as ReturnType<typeof bufferedExtras>;

beforeEach(() => {
  h.edgeArgs = [];
  h.bufferedArgs = [];
  h.readestInit = true;
  h.readestVoices = READEST_VOICES;
  h.warmup.mockReset();
  vi.mocked(TTSUtils.getPreferredClient).mockReturnValue(null);
  vi.mocked(createBookTTSCacheStore).mockClear();
  controller = new TTSController(appService, view, true);
});

afterEach(() => vi.clearAllMocks());

describe('construction', () => {
  test('Edge and Readest share one per-book cache store', () => {
    expect(createBookTTSCacheStore).toHaveBeenCalledTimes(1);
    expect(h.edgeArgs[0]![2]).toBe(h.store);
    const provider = h.bufferedArgs[0]![0];
    expect(provider).toBeInstanceOf(CachingProvider);
    expect((provider as CachingProvider).id).toBe('readest-tts');
  });

  test('without a cache store the provider is used directly', () => {
    vi.mocked(createBookTTSCacheStore).mockReturnValueOnce(null);
    h.bufferedArgs = [];
    new TTSController(appService, view, true);
    expect(h.bufferedArgs[0]![0]).not.toBeInstanceOf(CachingProvider);
  });
});

describe('init', () => {
  test('Readest Voice is available but Edge stays the default engine', async () => {
    await controller.init();
    expect(readest().init).toHaveBeenCalled();
    expect(controller.ttsClient.name).toBe('edge-tts');
    expect(controller.ttsReadestVoices).toEqual(READEST_VOICES);
  });

  test('a remembered Readest preference selects it', async () => {
    vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('readest-tts');
    await controller.init();
    expect(controller.ttsClient).toBe(readest());
  });
});

describe('voices', () => {
  test('lists the Readest group after native and before Edge, and warms the worker', async () => {
    await controller.init();
    vi.mocked(readest().getVoices).mockResolvedValue([
      { id: 'readest-tts', name: 'Readest Voice', voices: READEST_VOICES },
    ]);
    vi.mocked(controller.ttsEdgeClient.getVoices).mockResolvedValue([
      { id: 'edge-tts', name: 'Edge TTS', voices: [] },
    ]);
    const groups = await controller.getVoices('en');
    expect(groups.map((g) => g.id)).toEqual(['readest-tts', 'edge-tts']);
    expect(h.warmup).toHaveBeenCalledTimes(1);
  });

  test('hides the Readest group entirely when unavailable (free plan, kill switch)', async () => {
    h.readestInit = false;
    await controller.init();
    vi.mocked(readest().getVoices).mockResolvedValue([
      { id: 'readest-tts', name: 'Readest Voice', voices: READEST_VOICES, disabled: true },
    ]);
    const groups = await controller.getVoices('en');
    expect(groups.map((g) => g.id)).not.toContain('readest-tts');
    expect(h.warmup).not.toHaveBeenCalled();
  });
});

describe('book language', () => {
  test('a remembered Readest choice yields to Edge for a language it has no voice for', async () => {
    vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('readest-tts');
    await controller.init();
    expect(controller.ttsClient).toBe(readest());
    await controller.setLang('de');
    expect(controller.ttsClient.name).toBe('edge-tts');
    // The choice itself is kept for books Readest Voice can read.
    expect(TTSUtils.setPreferredClient).not.toHaveBeenCalled();
  });

  test('keeps Readest Voice for a language it can voice', async () => {
    vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('readest-tts');
    await controller.init();
    await controller.setLang('en-GB');
    expect(controller.ttsClient).toBe(readest());
  });

  test('the picker hides an empty Readest group', async () => {
    await controller.init();
    vi.mocked(readest().getVoices).mockResolvedValue([
      { id: 'readest-tts', name: 'Readest Voice', voices: [], disabled: true },
    ]);
    const groups = await controller.getVoices('de');
    expect(groups.map((g) => g.id)).not.toContain('readest-tts');
    expect(h.warmup).not.toHaveBeenCalled();
  });
});

describe('setVoice', () => {
  test("the engine-default voice ('') never selects Readest Voice", async () => {
    await controller.init();
    await controller.setVoice('', 'en');
    expect(controller.ttsClient.name).toBe('edge-tts');
  });

  test('a Readest voice selects the Readest client', async () => {
    await controller.init();
    await controller.setVoice('kokoro:af_heart', 'en');
    expect(controller.ttsClient).toBe(readest());
    expect(TTSUtils.setPreferredClient).toHaveBeenCalledWith('readest-tts');
    expect(readest().setVoice).toHaveBeenCalledWith('kokoro:af_heart');
  });
});

describe('settings fan out to the Readest client', () => {
  test('primary language, gaps and shutdown', async () => {
    await controller.init();
    await controller.setPrimaryLang('en');
    controller.setSentenceGap(0.2);
    controller.setParagraphGap(0.5);
    await controller.shutdown();
    expect(readest().setPrimaryLang).toHaveBeenCalledWith('en');
    expect(readest().setSentenceGap).toHaveBeenCalledWith(0.2);
    expect(readest().setParagraphGap).toHaveBeenCalledWith(0.5);
    expect(readest().shutdown).toHaveBeenCalled();
  });
});

describe('downloads follow the active synthetic engine', () => {
  test('Edge by default, Readest Voice when it is the active client', async () => {
    await controller.init();
    await controller.clearDownloads();
    expect(edge().clearDownloads).toHaveBeenCalledTimes(1);
    await controller.setVoice('kokoro:af_heart', 'en');
    await controller.clearDownloads();
    await controller.beginDownloadSections([1]);
    expect(readest().clearDownloads).toHaveBeenCalledTimes(1);
    expect(readest().beginDownloadSections).toHaveBeenCalledWith([1]);
    expect(controller.canDownload()).toBe(true);
    expect(readest().canDownload).toHaveBeenCalled();
  });
});
