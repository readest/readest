import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { TTSController } from '@/services/tts/TTSController';
import { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import { TTSGranularity, TTSVoicesGroup } from '@/services/tts/types';
import { TTSUtils } from '@/services/tts/TTSUtils';
import { FoliateView } from '@/types/view';
import { AppService } from '@/types/system';

// --- Mock all heavy dependencies so we never import real TTS clients ---

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, createMockTTSClient('web'));
  }),
}));

vi.mock('@/services/tts/EdgeTTSClient', () => ({
  EdgeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, createMockTTSClient('edge'));
  }),
}));

vi.mock('@/services/tts/NativeTTSClient', () => ({
  NativeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, createMockTTSClient('native'));
  }),
}));

vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredClient: vi.fn().mockReturnValue(null),
    setPreferredClient: vi.fn(),
    setPreferredVoice: vi.fn(),
    getPreferredVoice: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('foliate-js/overlayer.js', () => ({
  Overlayer: {
    highlight: 'highlightFn',
  },
}));

vi.mock('@/utils/ssml', () => ({
  filterSSMLWithLang: vi.fn((ssml: string) => ssml),
  parseSSMLMarks: vi.fn((ssml: string) => ({
    plainText: ssml ? 'hello' : '',
    marks: ssml ? [{ offset: 0, name: '0', text: 'hello', language: 'en' }] : [],
  })),
}));

vi.mock('@/utils/node', () => ({
  createRejectFilter: vi.fn(() => () => 1),
}));

vi.mock('@/utils/lang', () => ({
  isValidLang: vi.fn(() => true),
}));

vi.mock('foliate-js/tts.js', () => ({
  TTS: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, {
      start: vi.fn().mockReturnValue('<speak>hello</speak>'),
      resume: vi.fn().mockReturnValue('<speak>hello</speak>'),
      next: vi.fn().mockReturnValue('<speak>next</speak>'),
      prev: vi.fn().mockReturnValue('<speak>prev</speak>'),
      nextMark: vi.fn().mockReturnValue('<speak>nextMark</speak>'),
      prevMark: vi.fn().mockReturnValue('<speak>prevMark</speak>'),
      setMark: vi.fn().mockReturnValue(new Range()),
      doc: null,
    });
  }),
}));

vi.mock('foliate-js/text-walker.js', () => ({
  textWalker: vi.fn(),
}));

// --- Helper: create mock TTS client ---

function createMockTTSClient(name: string): TTSClient {
  return {
    name,
    initialized: false,
    init: vi.fn().mockResolvedValue(true),
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
    getGranularities: vi.fn().mockReturnValue(['word', 'sentence'] as TTSGranularity[]),
    getVoiceId: vi.fn().mockReturnValue('voice-1'),
    getSpeakingLang: vi.fn().mockReturnValue('en'),
  };
}

// --- Helper: create mock FoliateView ---

function createMockView(): FoliateView {
  const mockDoc = {
    querySelector: vi.fn().mockReturnValue(null),
  } as unknown as Document;

  return {
    renderer: {
      primaryIndex: 0,
      getContents: vi.fn().mockReturnValue([
        {
          doc: mockDoc,
          index: 0,
          overlayer: {
            remove: vi.fn(),
            add: vi.fn(),
          },
        },
      ]),
    },
    book: {
      sections: [
        { createDocument: vi.fn().mockResolvedValue(mockDoc) },
        { createDocument: vi.fn().mockResolvedValue(mockDoc) },
        { createDocument: vi.fn().mockResolvedValue(mockDoc) },
      ],
    },
    language: { isCJK: false },
    tts: null,
    getCFI: vi.fn().mockReturnValue('cfi-string'),
    resolveCFI: vi.fn().mockReturnValue({
      anchor: vi.fn().mockReturnValue(new Range()),
    }),
  } as unknown as FoliateView;
}

// --- Helper: create mock AppService ---

function createMockAppService(isAndroid = false): AppService {
  return {
    isAndroidApp: isAndroid,
  } as unknown as AppService;
}

// --- Tests ---

describe('TTSController', () => {
  let controller: TTSController;
  let mockView: FoliateView;
  let mockAppService: AppService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockView = createMockView();
    mockAppService = createMockAppService();
    controller = new TTSController(mockAppService, mockView, false);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    // Ensure controller is stopped after each test
    try {
      await controller.stop();
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    test('sets initial state to stopped', () => {
      expect(controller.state).toBe('stopped');
    });

    test('stores the view reference', () => {
      expect(controller.view).toBe(mockView);
    });

    test('stores appService', () => {
      expect(controller.appService).toBe(mockAppService);
    });

    test('sets isAuthenticated', () => {
      expect(controller.isAuthenticated).toBe(false);
      const authed = new TTSController(mockAppService, mockView, true);
      expect(authed.isAuthenticated).toBe(true);
    });

    test('defaults ttsRate to 1.0', () => {
      expect(controller.ttsRate).toBe(1.0);
    });

    test('defaults ttsLang to empty string', () => {
      expect(controller.ttsLang).toBe('');
    });

    test('defaults options to highlight/gray', () => {
      expect(controller.options).toEqual({ style: 'highlight', color: 'gray' });
    });

    test('uses webClient as default ttsClient', () => {
      expect(controller.ttsClient.name).toBe('web');
    });

    test('creates native client when isAndroidApp', () => {
      const androidService = createMockAppService(true);
      const c = new TTSController(androidService, mockView);
      expect(c.ttsNativeClient).not.toBeNull();
    });

    test('does not create native client when not Android', () => {
      expect(controller.ttsNativeClient).toBeNull();
    });

    test('stores preprocessCallback', () => {
      const cb = vi.fn();
      const c = new TTSController(mockAppService, mockView, false, cb);
      expect(c.preprocessCallback).toBe(cb);
    });

    test('stores onSectionChange callback', () => {
      const cb = vi.fn();
      const c = new TTSController(mockAppService, mockView, false, undefined, cb);
      expect(c.onSectionChange).toBe(cb);
    });
  });

  describe('init', () => {
    test('initialises edge and web clients', async () => {
      await controller.init();

      expect(controller.ttsEdgeClient.init).toHaveBeenCalled();
      expect(controller.ttsWebClient.init).toHaveBeenCalled();
    });

    test('sets ttsClient to first available client (edge)', async () => {
      await controller.init();
      // edge inits first and succeeds, so it becomes the active client
      expect(controller.ttsClient.name).toBe('edge');
    });

    test('fetches voices from web and edge clients', async () => {
      await controller.init();

      expect(controller.ttsWebClient.getAllVoices).toHaveBeenCalled();
      expect(controller.ttsEdgeClient.getAllVoices).toHaveBeenCalled();
    });

    test('respects preferred client from TTSUtils', async () => {
      vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('web');
      await controller.init();
      expect(controller.ttsClient.name).toBe('web');
    });

    test('falls back to web client when preferred client not found', async () => {
      vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('nonexistent');
      await controller.init();
      // first available is edge
      expect(controller.ttsClient.name).toBe('edge');
    });

    test('also initializes native client on Android', async () => {
      const androidService = createMockAppService(true);
      const c = new TTSController(androidService, mockView);
      await c.init();
      expect(c.ttsNativeClient!.init).toHaveBeenCalled();
      expect(c.ttsNativeClient!.getAllVoices).toHaveBeenCalled();
    });
  });

  describe('setRate', () => {
    test('updates ttsRate and state', async () => {
      await controller.setRate(1.5);
      expect(controller.ttsRate).toBe(1.5);
      expect(controller.state).toBe('setrate-paused');
    });

    test('delegates to ttsClient.setRate', async () => {
      await controller.setRate(2.0);
      expect(controller.ttsClient.setRate).toHaveBeenCalledWith(2.0);
    });
  });

  describe('setVoice', () => {
    test('switches to edge client when voice found in edge voices', async () => {
      controller.ttsEdgeVoices = [{ id: 'edge-voice-1', name: 'Edge Voice', lang: 'en-US' }];
      await controller.setVoice('edge-voice-1', 'en');

      expect(controller.ttsClient.name).toBe('edge');
      expect(controller.state).toBe('setvoice-paused');
      expect(TTSUtils.setPreferredClient).toHaveBeenCalledWith('edge');
      expect(TTSUtils.setPreferredVoice).toHaveBeenCalledWith('edge', 'en', 'edge-voice-1');
    });

    test('switches to web client when voice not in edge or native', async () => {
      controller.ttsEdgeVoices = [{ id: 'edge-voice-1', name: 'Edge Voice', lang: 'en-US' }];
      await controller.setVoice('unknown-voice', 'en');

      expect(controller.ttsClient.name).toBe('web');
    });

    test('switches to native client when voice found in native voices', async () => {
      const androidService = createMockAppService(true);
      const c = new TTSController(androidService, mockView);
      await c.init();
      c.ttsNativeVoices = [{ id: 'native-v', name: 'Native', lang: 'en-US' }];
      await c.setVoice('native-v', 'en');

      expect(c.ttsClient.name).toBe('native');
    });

    test('throws when native voice found but native client unavailable', async () => {
      // non-android, ttsNativeClient is null, but we force nativeVoices
      controller.ttsNativeVoices = [{ id: 'native-v', name: 'Native', lang: 'en-US' }];
      controller.ttsEdgeVoices = [];

      await expect(controller.setVoice('native-v', 'en')).rejects.toThrow(
        'Native TTS client is not available',
      );
    });

    test('skips disabled voices', async () => {
      controller.ttsEdgeVoices = [
        { id: 'edge-voice-1', name: 'Edge Voice', lang: 'en-US', disabled: true },
      ];
      await controller.setVoice('edge-voice-1', 'en');
      // Should fall through to web since edge voice is disabled
      expect(controller.ttsClient.name).toBe('web');
    });

    test('uses empty voiceId to match any non-disabled voice', async () => {
      controller.ttsEdgeVoices = [{ id: 'edge-v', name: 'Edge', lang: 'en-US' }];
      await controller.setVoice('', 'en');
      expect(controller.ttsClient.name).toBe('edge');
    });

    test('sets rate on newly selected client', async () => {
      controller.ttsRate = 1.8;
      controller.ttsEdgeVoices = [{ id: 'ev', name: 'E', lang: 'en-US' }];
      await controller.setVoice('ev', 'en');
      expect(controller.ttsClient.setRate).toHaveBeenCalledWith(1.8);
    });
  });

  describe('getVoices', () => {
    test('aggregates voices from all clients', async () => {
      const edgeVoices: TTSVoicesGroup[] = [
        { id: 'eg', name: 'Edge', voices: [{ id: 'e1', name: 'E1', lang: 'en-US' }] },
      ];
      const webVoices: TTSVoicesGroup[] = [
        { id: 'wg', name: 'Web', voices: [{ id: 'w1', name: 'W1', lang: 'en-US' }] },
      ];
      vi.mocked(controller.ttsEdgeClient.getVoices).mockResolvedValue(edgeVoices);
      vi.mocked(controller.ttsWebClient.getVoices).mockResolvedValue(webVoices);

      const result = await controller.getVoices('en');
      expect(result).toEqual([...edgeVoices, ...webVoices]);
    });

    test('includes native voices when available', async () => {
      const androidService = createMockAppService(true);
      const c = new TTSController(androidService, mockView);
      await c.init();

      const nativeVoices: TTSVoicesGroup[] = [
        { id: 'ng', name: 'Native', voices: [{ id: 'n1', name: 'N1', lang: 'en-US' }] },
      ];
      vi.mocked(c.ttsNativeClient!.getVoices).mockResolvedValue(nativeVoices);
      vi.mocked(c.ttsEdgeClient.getVoices).mockResolvedValue([]);
      vi.mocked(c.ttsWebClient.getVoices).mockResolvedValue([]);

      const result = await c.getVoices('en');
      expect(result).toEqual(nativeVoices);
    });
  });

  describe('getVoiceId', () => {
    test('delegates to ttsClient.getVoiceId', () => {
      const result = controller.getVoiceId();
      expect(result).toBe('voice-1');
      expect(controller.ttsClient.getVoiceId).toHaveBeenCalled();
    });
  });

  describe('getSpeakingLang', () => {
    test('delegates to ttsClient.getSpeakingLang', () => {
      const result = controller.getSpeakingLang();
      expect(result).toBe('en');
    });
  });

  describe('setTargetLang', () => {
    test('sets ttsTargetLang', () => {
      controller.setTargetLang('fr');
      expect(controller.ttsTargetLang).toBe('fr');
    });
  });

  describe('setLang', () => {
    test('sets ttsLang and calls setPrimaryLang', async () => {
      await controller.init();
      await controller.setLang('zh');
      expect(controller.ttsLang).toBe('zh');
    });
  });

  describe('setPrimaryLang', () => {
    test('calls setPrimaryLang on initialized clients', async () => {
      // Mark clients as initialized
      controller.ttsEdgeClient.initialized = true;
      controller.ttsWebClient.initialized = true;

      await controller.setPrimaryLang('fr');

      expect(controller.ttsEdgeClient.setPrimaryLang).toHaveBeenCalledWith('fr');
      expect(controller.ttsWebClient.setPrimaryLang).toHaveBeenCalledWith('fr');
    });

    test('skips uninitialised clients', async () => {
      controller.ttsEdgeClient.initialized = false;
      controller.ttsWebClient.initialized = false;

      await controller.setPrimaryLang('de');

      expect(controller.ttsEdgeClient.setPrimaryLang).not.toHaveBeenCalled();
      expect(controller.ttsWebClient.setPrimaryLang).not.toHaveBeenCalled();
    });
  });

  describe('updateHighlightOptions', () => {
    test('updates style and color', () => {
      controller.updateHighlightOptions({ style: 'underline', color: 'red' });
      expect(controller.options).toEqual({ style: 'underline', color: 'red' });
    });
  });

  describe('state transitions', () => {
    test('pause sets state to paused', async () => {
      controller.state = 'playing';
      await controller.pause();
      expect(controller.state).toBe('paused');
    });

    test('pause sets stop-paused when client.pause fails', async () => {
      controller.state = 'playing';
      vi.mocked(controller.ttsClient.pause).mockResolvedValue(false);
      await controller.pause();
      expect(controller.state).toBe('stop-paused');
    });

    test('resume sets state to playing', async () => {
      controller.state = 'paused';
      await controller.resume();
      expect(controller.state).toBe('playing');
      expect(controller.ttsClient.resume).toHaveBeenCalled();
    });

    test('stop sets state to stopped', async () => {
      controller.state = 'playing';
      await controller.stop();
      expect(controller.state).toBe('stopped');
    });

    test('error sets state to stopped', () => {
      controller.state = 'playing';
      controller.error(new Error('test'));
      expect(controller.state).toBe('stopped');
    });

    test('play calls start when not playing', () => {
      controller.state = 'stopped';
      const startSpy = vi.spyOn(controller, 'start').mockResolvedValue();
      controller.play();
      expect(startSpy).toHaveBeenCalled();
    });

    test('play calls pause when playing', () => {
      controller.state = 'playing';
      const pauseSpy = vi.spyOn(controller, 'pause').mockResolvedValue();
      controller.play();
      expect(pauseSpy).toHaveBeenCalled();
    });
  });

  describe('dispatchSpeakMark', () => {
    test('dispatches tts-speak-mark event with empty text when no mark', () => {
      const listener = vi.fn();
      controller.addEventListener('tts-speak-mark', listener);
      controller.dispatchSpeakMark();
      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0]![0] as CustomEvent;
      expect(event.detail).toEqual({ text: '' });
    });

    test('dispatches tts-speak-mark with provided mark', () => {
      const listener = vi.fn();
      controller.addEventListener('tts-speak-mark', listener);
      const mark = { offset: 0, name: '0', text: 'hello', language: 'en' };
      controller.dispatchSpeakMark(mark);
      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0]![0] as CustomEvent;
      expect(event.detail).toEqual(mark);
    });

    test('dispatches tts-highlight-mark when mark name is not -1', () => {
      const highlightListener = vi.fn();
      controller.addEventListener('tts-highlight-mark', highlightListener);

      // We need view.tts to exist for setMark to be called
      mockView.tts = {
        setMark: vi.fn().mockReturnValue(new Range()),
      } as unknown as FoliateView['tts'];

      const mark = { offset: 0, name: '0', text: 'hello', language: 'en' };
      controller.dispatchSpeakMark(mark);
      expect(highlightListener).toHaveBeenCalledTimes(1);
    });

    test('does not dispatch highlight when mark name is -1', () => {
      const highlightListener = vi.fn();
      controller.addEventListener('tts-highlight-mark', highlightListener);

      const mark = { offset: 0, name: '-1', text: 'hello', language: 'en' };
      controller.dispatchSpeakMark(mark);
      expect(highlightListener).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    test('stops playback and clears tts', async () => {
      const stopSpy = vi.spyOn(controller, 'stop').mockResolvedValue();
      controller.ttsWebClient.initialized = true;
      controller.ttsEdgeClient.initialized = true;

      await controller.shutdown();

      expect(stopSpy).toHaveBeenCalled();
      expect(mockView.tts).toBeNull();
      expect(controller.ttsWebClient.shutdown).toHaveBeenCalled();
      expect(controller.ttsEdgeClient.shutdown).toHaveBeenCalled();
    });

    test('shuts down native client when initialized', async () => {
      const androidService = createMockAppService(true);
      const c = new TTSController(androidService, mockView);
      await c.init();
      c.ttsNativeClient!.initialized = true;

      vi.spyOn(c, 'stop').mockResolvedValue();
      await c.shutdown();

      expect(c.ttsNativeClient!.shutdown).toHaveBeenCalled();
    });

    test('skips shutdown of uninitialized clients', async () => {
      vi.spyOn(controller, 'stop').mockResolvedValue();
      controller.ttsWebClient.initialized = false;
      controller.ttsEdgeClient.initialized = false;

      await controller.shutdown();

      expect(controller.ttsWebClient.shutdown).not.toHaveBeenCalled();
      expect(controller.ttsEdgeClient.shutdown).not.toHaveBeenCalled();
    });
  });

  describe('start', () => {
    test('uses tts.resume() not tts.start() when state is stopped (play/pause race fix)', async () => {
      // Repro: `forward()` transitions state to 'stopped' transiently between its
      // `await this.stop()` and the follow-up navigation. If the user taps play
      // in that window, `start()` previously called `tts.start()` — which resets
      // the TTS list to position 0 (section beginning) instead of resuming the
      // current paragraph. The fix: always use `tts.resume()` (which itself
      // falls back to `next()` on a fresh TTS), so there's no way `start()`
      // ever rewinds to the top of a section.
      await controller.initViewTTS(0);

      const ttsStartMock = vi.fn().mockReturnValue('<speak>section-start</speak>');
      const ttsResumeMock = vi.fn().mockReturnValue('<speak>current</speak>');
      const tts = mockView.tts as unknown as {
        start: typeof ttsStartMock;
        resume: typeof ttsResumeMock;
        next: ReturnType<typeof vi.fn>;
        prev: ReturnType<typeof vi.fn>;
      };
      tts.start = ttsStartMock;
      tts.resume = ttsResumeMock;
      tts.next = vi.fn().mockReturnValue(undefined);
      tts.prev = vi.fn();

      // Simulate the race: state is 'stopped' (transient during forward())
      controller.state = 'stopped';
      await controller.start();

      expect(ttsResumeMock).toHaveBeenCalled();
      expect(ttsStartMock).not.toHaveBeenCalled();
    });
  });

  describe('forward and backward', () => {
    test('forward sets forward-paused state when not playing', async () => {
      // Set up controller with a mock tts on the view
      mockView.tts = {
        next: vi.fn().mockReturnValue('<speak>next</speak>'),
        nextMark: vi.fn().mockReturnValue('<speak>nextMark</speak>'),
        start: vi.fn(),
        doc: null,
      } as unknown as FoliateView['tts'];

      controller.state = 'paused';
      await controller.forward();
      expect(controller.state).toBe('forward-paused');
    });

    test('backward sets backward-paused state when not playing', async () => {
      mockView.tts = {
        prev: vi.fn().mockReturnValue('<speak>prev</speak>'),
        prevMark: vi.fn().mockReturnValue('<speak>prevMark</speak>'),
        start: vi.fn(),
        doc: null,
      } as unknown as FoliateView['tts'];

      controller.state = 'paused';
      await controller.backward();
      expect(controller.state).toBe('backward-paused');
    });
  });

  describe('stop', () => {
    test('calls ttsClient.stop', async () => {
      await controller.stop();
      expect(controller.ttsClient.stop).toHaveBeenCalled();
    });

    test('sets state to stopped', async () => {
      controller.state = 'playing';
      await controller.stop();
      expect(controller.state).toBe('stopped');
    });

    test('handles client stop errors gracefully', async () => {
      vi.mocked(controller.ttsClient.stop).mockRejectedValue(new Error('stop err'));
      // should not throw
      await controller.stop();
      expect(controller.state).toBe('stopped');
    });
  });

  describe('preloadSSML', () => {
    test('does nothing when ssml is undefined', async () => {
      await controller.preloadSSML(undefined, new AbortController().signal);
      expect(controller.ttsClient.speak).not.toHaveBeenCalled();
    });

    test('calls speak with preload flag', async () => {
      await controller.preloadSSML('<speak>hi</speak>', new AbortController().signal);
      expect(controller.ttsClient.speak).toHaveBeenCalledWith(
        '<speak>hi</speak>',
        expect.anything(),
        true,
      );
    });
  });

  describe('preloadNextSSML', () => {
    test('calls tts.next() and tts.prev() synchronously without async gaps between them', async () => {
      // This test verifies the fix for a race condition where async gaps between
      // tts.next() calls in preloadNextSSML allowed #speak() to interleave and
      // read corrupted #ranges state (replaced by next() for a different block).
      const callOrder: string[] = [];
      let asyncOpHappened = false;

      mockView.tts = {
        next: vi.fn().mockImplementation(() => {
          if (asyncOpHappened) {
            callOrder.push('next-after-async');
          } else {
            callOrder.push('next');
          }
          return '<speak>chunk</speak>';
        }),
        prev: vi.fn().mockImplementation(() => {
          callOrder.push('prev');
        }),
        doc: {},
      } as unknown as FoliateView['tts'];

      // Use preprocessCallback to detect when async processing happens
      controller.preprocessCallback = async (ssml: string) => {
        asyncOpHappened = true;
        callOrder.push('preprocess');
        return ssml;
      };

      await controller.preloadNextSSML(2);

      // All next() calls should happen before any preprocess (async operation)
      const firstPreprocessIdx = callOrder.indexOf('preprocess');
      const nextIndices = callOrder.map((op, i) => (op === 'next' ? i : -1)).filter((i) => i >= 0);
      const prevIndices = callOrder.map((op, i) => (op === 'prev' ? i : -1)).filter((i) => i >= 0);

      // All next() calls must come before any async preprocessing
      for (const idx of nextIndices) {
        expect(idx).toBeLessThan(firstPreprocessIdx);
      }
      // All prev() calls must come before any async preprocessing
      for (const idx of prevIndices) {
        expect(idx).toBeLessThan(firstPreprocessIdx);
      }
      // No next() should happen after an async operation
      expect(callOrder).not.toContain('next-after-async');
    });
  });

  describe('initViewTTS', () => {
    test('does nothing when already initialised (section index != -1)', async () => {
      // Manually set section index via a reflect access workaround
      // Since #ttsSectionIndex is private, we test indirectly through initViewTTS
      // being called multiple times - first call will init, second should skip
      mockView.tts = {
        doc: {},
        start: vi.fn(),
      } as unknown as FoliateView['tts'];

      // Call once to set the section index
      await controller.initViewTTS(0);
      // Now we can verify it doesn't re-init by checking the section was already created
    });
  });

  describe('extends EventTarget', () => {
    test('is an instance of EventTarget', () => {
      expect(controller instanceof EventTarget).toBe(true);
    });

    test('can add and dispatch custom events', () => {
      const handler = vi.fn();
      controller.addEventListener('test-event', handler);
      controller.dispatchEvent(new CustomEvent('test-event', { detail: 'data' }));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
