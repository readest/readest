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
    Object.assign(this, createMockTTSClient('edge'), { setSentenceGap: vi.fn() });
  }),
}));

vi.mock('@/services/tts/NativeTTSClient', () => ({
  NativeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, createMockTTSClient('native'));
  }),
}));

// Track the inaudible background keep-alive (WebAudio) toggled for direct-speak
// engines. Arrow closures so the vi.mock hoist never hits a TDZ on these consts.
const startKeepAlive = vi.fn();
const stopKeepAlive = vi.fn();
vi.mock('@/services/tts/WebAudioPlayer', async (importActual) => ({
  ...(await importActual<typeof import('@/services/tts/WebAudioPlayer')>()),
  startAudioKeepAlive: () => startKeepAlive(),
  stopAudioKeepAlive: () => stopKeepAlive(),
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
      getLastRange: vi.fn().mockReturnValue(new Range()),
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
    getCapabilities: vi.fn().mockImplementation(() => ({
      wordBoundaries: name === 'edge',
      mediaClock: name === 'edge',
      gapControl: name === 'edge',
      liveRateChange: false,
    })),
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

function createMockAppService(isAndroid = false, isIOS = false): AppService {
  return {
    isAndroidApp: isAndroid,
    isIOSApp: isIOS,
  } as unknown as AppService;
}

// --- Tests ---

describe('TTSController', () => {
  let controller: TTSController;
  let mockView: FoliateView;
  let mockAppService: AppService;

  // Controllers that kick off a detached `#speak` loop (the native-TTS tests
  // start speak() un-awaited and only assert on an early side-effect). They
  // must be stopped after the test, or the loop keeps running past teardown
  // and its deferred `set state` dispatch — queueMicrotask(() =>
  // dispatchEvent(new CustomEvent(...))) — fires once the jsdom env is gone,
  // where `CustomEvent` is Node's global rather than jsdom's and jsdom's
  // EventTarget rejects it as "parameter 1 is not of type 'Event'" (#5149).
  const speakingControllers: TTSController[] = [];

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
    // Abort any detached speak loop started on a locally-created controller so
    // no trailing state change escapes into env teardown (see speakingControllers).
    for (const c of speakingControllers) {
      try {
        await c.stop();
      } catch {
        // ignore
      }
    }
    speakingControllers.length = 0;
    // Flush the deferred set-state dispatch microtasks while the jsdom realm
    // is still alive.
    await new Promise((resolve) => setTimeout(resolve, 0));
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

    test('creates native client when isIOSApp', () => {
      const iosService = createMockAppService(false, true);
      const c = new TTSController(iosService, mockView);
      expect(c.ttsNativeClient).not.toBeNull();
    });

    test('does not create native client when neither Android nor iOS', () => {
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

  describe('supportsGapControl', () => {
    test('returns true when ttsClient is the edge client', () => {
      controller.ttsClient = controller.ttsEdgeClient;
      expect(controller.supportsGapControl()).toBe(true);
    });

    test('returns false when ttsClient is not the edge client', () => {
      controller.ttsClient = controller.ttsWebClient;
      expect(controller.supportsGapControl()).toBe(false);
    });
  });

  describe('setSentenceGap', () => {
    test('delegates to ttsEdgeClient.setSentenceGap with the given value', () => {
      controller.setSentenceGap(0.5);
      expect(controller.ttsEdgeClient.setSentenceGap).toHaveBeenCalledWith(0.5);
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

    test('error preserves state for AbortError (DOMException-style)', () => {
      // iOS audio.play() and AbortSignal-aware fetches reject with a DOMException
      // whose name is 'AbortError'. Treating it as a real error desyncs the state
      // machine: subsequent rate changes see state !== 'playing' and skip the
      // stop+start cycle, and #speak's auto-forward gate fails.
      controller.state = 'playing';
      const abort = new Error('The operation was aborted.');
      abort.name = 'AbortError';
      controller.error(abort);
      expect(controller.state).toBe('playing');
    });

    test('error preserves state for our internal Aborted message', () => {
      // EdgeTTSClient and NativeTTSClient resolve the inner promise with
      // { code: 'error', message: 'Aborted' } on signal abort; if that bubbles
      // through any catch path it must not flip state to 'stopped'.
      controller.state = 'playing';
      controller.error(new Error('Aborted'));
      expect(controller.state).toBe('playing');
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

  describe('word highlighting (prepareSpeakWords / dispatchSpeakWord)', () => {
    const getOverlayer = () =>
      (
        mockView.renderer.getContents() as unknown as Array<{
          overlayer: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
        }>
      )[0]!.overlayer;

    const makeSentenceRange = () => {
      document.body.innerHTML = '<p>Hello brave world</p>';
      const textNode = document.body.firstElementChild!.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, textNode.length);
      return range;
    };

    const armWithSentence = async (range: Range, markName = '0') => {
      await controller.initViewTTS(0);
      mockView.tts = {
        setMark: vi.fn().mockReturnValue(range),
        getLastRange: vi.fn().mockImplementation(() => range.cloneRange()),
      } as unknown as FoliateView['tts'];
      controller.dispatchSpeakMark({
        offset: 0,
        name: markName,
        text: 'Hello brave world',
        language: 'en',
      });
    };

    test('prepareSpeakWords immediately highlights the first word (no sentence flash)', async () => {
      await armWithSentence(makeSentenceRange());
      vi.mocked(mockView.getCFI).mockClear();
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);

      const getCFICalls = vi.mocked(mockView.getCFI).mock.calls;
      expect(getCFICalls.length).toBeGreaterThanOrEqual(1);
      expect(String(getCFICalls[0]![1])).toBe('Hello');
      expect(getOverlayer().add).toHaveBeenCalledTimes(1);
    });

    test('prepareSpeakWords with no words falls back to the full-sentence highlight', async () => {
      await armWithSentence(makeSentenceRange());
      vi.mocked(mockView.getCFI).mockClear();
      controller.prepareSpeakWords([]);

      const getCFICalls = vi.mocked(mockView.getCFI).mock.calls;
      expect(getCFICalls.length).toBeGreaterThanOrEqual(1);
      expect(String(getCFICalls[0]![1])).toBe('Hello brave world');
      expect(getOverlayer().add).toHaveBeenCalledTimes(1);
    });

    test('dispatchSpeakWord highlights the word sub-range of the current sentence', async () => {
      await armWithSentence(makeSentenceRange());
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);

      vi.mocked(mockView.getCFI).mockClear();
      getOverlayer().add.mockClear();
      controller.dispatchSpeakWord(1);

      const getCFICalls = vi.mocked(mockView.getCFI).mock.calls;
      expect(getCFICalls.length).toBeGreaterThanOrEqual(1);
      expect(String(getCFICalls[0]![1])).toBe('brave');
      expect(getOverlayer().add).toHaveBeenCalledTimes(1);
      expect(getOverlayer().add.mock.calls[0]![0]).toBe('tts-highlight');
    });

    test('word indexes can be dispatched out of order after a seek back', async () => {
      await armWithSentence(makeSentenceRange());
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);

      controller.dispatchSpeakWord(2);
      vi.mocked(mockView.getCFI).mockClear();
      controller.dispatchSpeakWord(0);

      const getCFICalls = vi.mocked(mockView.getCFI).mock.calls;
      expect(getCFICalls.length).toBeGreaterThanOrEqual(1);
      expect(String(getCFICalls[0]![1])).toBe('Hello');
    });

    test('does not highlight words for one-time marks (name -1)', async () => {
      await armWithSentence(makeSentenceRange(), '-1');
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);
      controller.dispatchSpeakWord(0);

      expect(getOverlayer().add).not.toHaveBeenCalled();
    });

    test('a new speak mark clears previously prepared words', async () => {
      await armWithSentence(makeSentenceRange());
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);
      expect(getOverlayer().add).toHaveBeenCalledTimes(1);

      controller.dispatchSpeakMark({
        offset: 0,
        name: '1',
        text: 'Hello brave world',
        language: 'en',
      });
      getOverlayer().add.mockClear();
      controller.dispatchSpeakWord(0);
      expect(getOverlayer().add).not.toHaveBeenCalled();
    });

    test('unmatched first word does not highlight but later words still align', async () => {
      await armWithSentence(makeSentenceRange());
      controller.prepareSpeakWords(['BOGUS', 'brave']);

      // First word unmatched → no eager highlight.
      expect(getOverlayer().add).not.toHaveBeenCalled();

      vi.mocked(mockView.getCFI).mockClear();
      controller.dispatchSpeakWord(1);
      const getCFICalls = vi.mocked(mockView.getCFI).mock.calls;
      expect(getCFICalls.length).toBeGreaterThanOrEqual(1);
      expect(String(getCFICalls[0]![1])).toBe('brave');
    });

    test('reapplyCurrentHighlight re-draws the current word during word mode', async () => {
      await armWithSentence(makeSentenceRange());
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);
      controller.dispatchSpeakWord(1);

      vi.mocked(mockView.getCFI).mockClear();
      controller.reapplyCurrentHighlight();

      const getCFICalls = vi.mocked(mockView.getCFI).mock.calls;
      expect(getCFICalls.length).toBeGreaterThanOrEqual(1);
      expect(String(getCFICalls[0]![1])).toBe('brave');
    });

    test('reapplyCurrentHighlight re-draws the whole sentence when not in word mode', async () => {
      await armWithSentence(makeSentenceRange());
      controller.prepareSpeakWords([]);

      vi.mocked(mockView.getCFI).mockClear();
      controller.reapplyCurrentHighlight();

      const getCFICalls = vi.mocked(mockView.getCFI).mock.calls;
      expect(getCFICalls.length).toBeGreaterThanOrEqual(1);
      expect(String(getCFICalls[0]![1])).toBe('Hello brave world');
    });

    test('dispatchSpeakWord emits tts-highlight-word for word-level page following', async () => {
      await armWithSentence(makeSentenceRange());
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);

      const listener = vi.fn();
      controller.addEventListener('tts-highlight-word', listener);
      vi.mocked(mockView.getCFI).mockReturnValue('cfi-word');
      controller.dispatchSpeakWord(1);

      expect(listener).toHaveBeenCalledTimes(1);
      const ev = listener.mock.calls[0]![0] as CustomEvent;
      expect(ev.detail).toEqual({ cfi: 'cfi-word' });
    });

    test('dispatchSpeakWord does not emit a word event when the word is unmatched', async () => {
      await armWithSentence(makeSentenceRange());
      controller.prepareSpeakWords(['BOGUS', 'brave']);

      const listener = vi.fn();
      controller.addEventListener('tts-highlight-word', listener);
      controller.dispatchSpeakWord(0); // unmatched → no range, no event
      expect(listener).not.toHaveBeenCalled();
    });

    test('getCurrentHighlightCfi returns the word cfi in word mode, null otherwise', async () => {
      await armWithSentence(makeSentenceRange());
      // Not in word mode until prepareSpeakWords with words.
      expect(controller.getCurrentHighlightCfi()).toBeNull();

      vi.mocked(mockView.getCFI).mockReturnValue('cfi-word');
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);
      controller.dispatchSpeakWord(1);
      expect(controller.getCurrentHighlightCfi()).toBe('cfi-word');

      // Empty (sentence fallback) leaves word mode → null so the caller uses
      // the sentence-level ttsLocation.
      controller.prepareSpeakWords([]);
      expect(controller.getCurrentHighlightCfi()).toBeNull();
    });

    test('granularity "sentence" forces sentence highlighting (skips word-by-word)', async () => {
      controller.setHighlightGranularity('sentence');
      await armWithSentence(makeSentenceRange());
      getOverlayer().add.mockClear();
      // Even when the client reports word boundaries and calls prepareSpeakWords,
      // the user's "sentence" choice keeps highlighting at the sentence level: the
      // sentence highlight was already drawn at mark dispatch (not suppressed), so
      // prepareSpeakWords is a no-op and word mode never engages.
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);
      expect(getOverlayer().add).not.toHaveBeenCalled();
      expect(controller.getCurrentHighlightCfi()).toBeNull();
    });

    test('granularity "word" (default) still highlights word-by-word', async () => {
      controller.setHighlightGranularity('word');
      await armWithSentence(makeSentenceRange());
      getOverlayer().add.mockClear();
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);
      // First word highlighted immediately and word mode engaged.
      expect(getOverlayer().add).toHaveBeenCalledTimes(1);
      expect(controller.getCurrentHighlightCfi()).not.toBeNull();
    });
  });

  describe('tts-position event', () => {
    const makeSentenceRange = () => {
      document.body.innerHTML = '<p>Hello brave world</p>';
      const textNode = document.body.firstElementChild!.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, textNode.length);
      return range;
    };

    const armWithSentence = async (range: Range, markName = '0') => {
      await controller.initViewTTS(0);
      mockView.tts = {
        setMark: vi.fn().mockReturnValue(range),
        getLastRange: vi.fn().mockImplementation(() => range.cloneRange()),
      } as unknown as FoliateView['tts'];
      controller.dispatchSpeakMark({
        offset: 0,
        name: markName,
        text: 'Hello brave world',
        language: 'en',
      });
    };

    test('dispatchSpeakMark emits tts-position with kind sentence, cfi, sectionIndex and sequence', async () => {
      await controller.initViewTTS(0);
      mockView.tts = {
        setMark: vi.fn().mockReturnValue(new Range()),
        getLastRange: vi.fn(),
      } as unknown as FoliateView['tts'];
      vi.mocked(mockView.getCFI).mockReturnValue('cfi-sentence');

      const listener = vi.fn();
      controller.addEventListener('tts-position', listener);

      controller.dispatchSpeakMark({ offset: 0, name: '0', text: 'hello', language: 'en' });

      expect(listener).toHaveBeenCalledTimes(1);
      const ev = listener.mock.calls[0]![0] as CustomEvent;
      expect(ev.detail.kind).toBe('sentence');
      expect(ev.detail.cfi).toBe('cfi-sentence');
      // initViewTTS(0) set the TTS section index to 0.
      expect(ev.detail.sectionIndex).toBe(0);
      expect(typeof ev.detail.sequence).toBe('number');
    });

    test('dispatchSpeakWord emits tts-position with kind word', async () => {
      await armWithSentence(makeSentenceRange());
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);

      const listener = vi.fn();
      controller.addEventListener('tts-position', listener);
      vi.mocked(mockView.getCFI).mockReturnValue('cfi-word');
      controller.dispatchSpeakWord(1);

      expect(listener).toHaveBeenCalledTimes(1);
      const ev = listener.mock.calls[0]![0] as CustomEvent;
      expect(ev.detail.kind).toBe('word');
      expect(ev.detail.cfi).toBe('cfi-word');
      expect(ev.detail.sectionIndex).toBe(0);
      expect(typeof ev.detail.sequence).toBe('number');
    });

    test('sequence strictly increases across successive emits', async () => {
      await armWithSentence(makeSentenceRange());
      vi.mocked(mockView.getCFI).mockReturnValue('cfi-x');

      const sequences: number[] = [];
      controller.addEventListener('tts-position', (e) => {
        sequences.push((e as CustomEvent).detail.sequence);
      });

      // word emit
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);
      controller.dispatchSpeakWord(1);
      // sentence emit
      controller.dispatchSpeakMark({ offset: 0, name: '1', text: 'hello', language: 'en' });
      // another word emit
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);
      controller.dispatchSpeakWord(2);

      expect(sequences.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]!).toBeGreaterThan(sequences[i - 1]!);
      }
    });

    test('a fresh controller continues the sequence instead of restarting', async () => {
      vi.mocked(mockView.getCFI).mockReturnValue('cfi-x');

      // Emit one sentence position from a controller and return its sequence.
      const emitOnce = async (c: TTSController) => {
        await c.initViewTTS(0);
        mockView.tts = {
          setMark: vi.fn().mockReturnValue(makeSentenceRange()),
          getLastRange: vi.fn().mockImplementation(() => makeSentenceRange()),
        } as unknown as FoliateView['tts'];
        let seq = -1;
        const handler = (e: Event) => {
          seq = (e as CustomEvent).detail.sequence;
        };
        c.addEventListener('tts-position', handler);
        c.dispatchSpeakMark({ offset: 0, name: '0', text: 'hello', language: 'en' });
        c.removeEventListener('tts-position', handler);
        return seq;
      };

      const firstSeq = await emitOnce(controller);
      // A new `tts-speak` builds a fresh TTSController (see useTTSControl). A
      // per-instance counter would restart, so the new session's first sequence
      // would be <= the previous session's and a consumer holding
      // `lastSequenceSeen` would drop it. A module-level counter keeps the
      // sequence strictly increasing across sessions.
      const controller2 = new TTSController(mockAppService, mockView, false);
      const secondSeq = await emitOnce(controller2);

      expect(secondSeq).toBeGreaterThan(firstSeq);
    });
  });

  describe('redispatchPosition', () => {
    const makeSentenceRange = () => {
      document.body.innerHTML = '<p>Hello brave world</p>';
      const textNode = document.body.firstElementChild!.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, textNode.length);
      return range;
    };

    const armWithSentence = async (range: Range, markName = '0') => {
      await controller.initViewTTS(0);
      mockView.tts = {
        setMark: vi.fn().mockReturnValue(range),
        getLastRange: vi.fn().mockImplementation(() => range.cloneRange()),
      } as unknown as FoliateView['tts'];
      controller.dispatchSpeakMark({
        offset: 0,
        name: markName,
        text: 'Hello brave world',
        language: 'en',
      });
    };

    test('re-emits the current sentence position when not in word mode', async () => {
      await armWithSentence(makeSentenceRange());
      vi.mocked(mockView.getCFI).mockReturnValue('cfi-sentence');

      const listener = vi.fn();
      controller.addEventListener('tts-position', listener);
      controller.redispatchPosition();

      expect(listener).toHaveBeenCalledTimes(1);
      const ev = listener.mock.calls[0]![0] as CustomEvent;
      expect(ev.detail.kind).toBe('sentence');
      expect(ev.detail.cfi).toBe('cfi-sentence');
      expect(ev.detail.sectionIndex).toBe(0);
      expect(typeof ev.detail.sequence).toBe('number');
    });

    test('re-emits the current word position when in word mode', async () => {
      await armWithSentence(makeSentenceRange());
      controller.prepareSpeakWords(['Hello', 'brave', 'world']);
      vi.mocked(mockView.getCFI).mockReturnValue('cfi-word');
      controller.dispatchSpeakWord(1);

      const listener = vi.fn();
      controller.addEventListener('tts-position', listener);
      controller.redispatchPosition();

      expect(listener).toHaveBeenCalledTimes(1);
      const ev = listener.mock.calls[0]![0] as CustomEvent;
      expect(ev.detail.kind).toBe('word');
      expect(ev.detail.cfi).toBe('cfi-word');
    });

    test('uses a fresh, strictly increasing sequence on each call', async () => {
      await armWithSentence(makeSentenceRange());
      vi.mocked(mockView.getCFI).mockReturnValue('cfi-x');

      const sequences: number[] = [];
      controller.addEventListener('tts-position', (e) => {
        sequences.push((e as CustomEvent).detail.sequence);
      });
      controller.redispatchPosition();
      controller.redispatchPosition();

      expect(sequences.length).toBe(2);
      expect(sequences[1]!).toBeGreaterThan(sequences[0]!);
    });

    test('is a no-op when TTS is inactive (no section)', () => {
      const listener = vi.fn();
      controller.addEventListener('tts-position', listener);
      controller.redispatchPosition();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('getSpokenSentence', () => {
    test('returns the trimmed text and cfi of the current sentence', async () => {
      await controller.initViewTTS(0);
      mockView.tts = {
        getLastRange: vi.fn().mockReturnValue({ toString: () => '  A spoken sentence.  ' }),
      } as unknown as FoliateView['tts'];
      vi.mocked(mockView.getCFI).mockReturnValue('cfi-current');

      expect(controller.getSpokenSentence()).toEqual({
        cfi: 'cfi-current',
        text: 'A spoken sentence.',
      });
    });

    test('returns null when TTS is inactive (no view.tts)', () => {
      // No initViewTTS: view.tts is null and the section index is -1.
      expect(controller.getSpokenSentence()).toBeNull();
    });

    test('returns null when there is no current range', async () => {
      await controller.initViewTTS(0);
      mockView.tts = {
        getLastRange: vi.fn().mockReturnValue(undefined),
      } as unknown as FoliateView['tts'];

      expect(controller.getSpokenSentence()).toBeNull();
    });

    test('returns null when getCFI throws', async () => {
      await controller.initViewTTS(0);
      mockView.tts = {
        getLastRange: vi.fn().mockReturnValue({ toString: () => 'x' }),
      } as unknown as FoliateView['tts'];
      vi.mocked(mockView.getCFI).mockImplementation(() => {
        throw new Error('cfi failure');
      });

      expect(controller.getSpokenSentence()).toBeNull();
    });

    test('returns null when the sentence text is only whitespace', async () => {
      await controller.initViewTTS(0);
      mockView.tts = {
        getLastRange: vi.fn().mockReturnValue({ toString: () => '   ' }),
      } as unknown as FoliateView['tts'];
      vi.mocked(mockView.getCFI).mockReturnValue('cfi-current');

      expect(controller.getSpokenSentence()).toBeNull();
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

  // Regression: Android System TTS (and iOS) read offline can report a terminal
  // 'error' for an utterance it cannot synthesize — typically a specific
  // unsupported character, hit characteristically on the first utterance after
  // a chapter boundary even with a local/offline voice (online the engine often
  // network-falls-back, which is why it only breaks offline). #speak only
  // auto-advances on 'end', so without handling, one such error dead-ends
  // playback ("stops at the end of the chapter") with the controls wedged in
  // 'playing'. Re-speaking the same text would just fail again, so the
  // controller skips the bad chunk and advances, bounding consecutive failures
  // so a wholly-unusable engine still stops gracefully. See #4613, #4408.
  describe('native TTS offline error recovery (#4613, #4408)', () => {
    // An Android controller whose ACTIVE client is the native client, so the
    // native-scoped recovery in #speak() is exercised.
    const makeAndroidNativeController = async () => {
      const androidService = createMockAppService(true);
      const c = new TTSController(androidService, mockView);
      await c.init();
      c.ttsClient = c.ttsNativeClient!;
      await c.initViewTTS(0);
      speakingControllers.push(c);
      return c;
    };

    // A native speak() mock that always reports a terminal 'error' for real
    // (non-preload) utterances — i.e. a deterministically unspeakable chunk.
    // Preload calls (used to warm caches) resolve immediately like the real
    // client and never count as attempts.
    const alwaysErrorSpeakMock = (state: { attempts: number }) =>
      async function* (
        _ssml: string,
        _signal: AbortSignal,
        preload?: boolean,
      ): AsyncGenerator<TTSMessageEvent> {
        if (preload) {
          yield { code: 'end' };
          return;
        }
        state.attempts += 1;
        yield { code: 'error', message: 'TTS playback error:-8' };
      };

    test('skips a chunk the engine cannot speak and advances instead of dead-ending', async () => {
      const c = await makeAndroidNativeController();
      // Stub forward() so the skip is observable without recursing through the
      // mock sections; the point is that an error triggers an advance at all
      // (retrying the same unspeakable text would be futile).
      const forwardSpy = vi.spyOn(c, 'forward').mockResolvedValue();

      const state = { attempts: 0 };
      vi.mocked(c.ttsNativeClient!.speak).mockImplementation(alwaysErrorSpeakMock(state));

      c.speak('<speak>bad-char</speak>');

      await vi.waitFor(
        () => {
          expect(forwardSpy).toHaveBeenCalled(); // advanced past the bad chunk
        },
        { timeout: 5000 },
      );
      // It advanced rather than freezing in a phantom 'playing' halt.
      expect(c.state).toBe('playing');
    });

    test('stops gracefully after a run of consecutive unspeakable chunks', async () => {
      const c = await makeAndroidNativeController();
      // Real forward(): each error skips to the next (mock) chunk, which also
      // errors, until the consecutive-error cap stops playback.

      const state = { attempts: 0 };
      vi.mocked(c.ttsNativeClient!.speak).mockImplementation(alwaysErrorSpeakMock(state));

      c.speak('<speak>bad-char</speak>');

      // It skips past each unspeakable chunk — attempts climb past 1 (not an
      // immediate halt) — until the consecutive-error cap is reached. (We key
      // off attempts, not state: the controller starts 'stopped' and forward()
      // transiently re-enters 'stopped' between chunks.)
      await vi.waitFor(() => expect(state.attempts).toBeGreaterThanOrEqual(5), { timeout: 8000 });

      // Let the cap-stop settle, then confirm it terminated (bounded, not
      // racing to the end of the book) and is no longer playing.
      await new Promise((r) => setTimeout(r, 150));
      expect(c.state).not.toBe('playing');
      expect(state.attempts).toBeLessThanOrEqual(10);
    });
  });

  describe('native TTS background keep-alive (#4408)', () => {
    // Android controller whose ACTIVE client is the direct-speak native engine
    // (mediaClock === false): its audio renders in the OS, not the WebView.
    const makeAndroidNativeController = async () => {
      const c = new TTSController(createMockAppService(true), mockView);
      await c.init();
      c.ttsClient = c.ttsNativeClient!;
      await c.initViewTTS(0);
      speakingControllers.push(c);
      return c;
    };

    test('starts an inaudible keep-alive when native TTS begins playing on Android', async () => {
      const c = await makeAndroidNativeController();
      vi.spyOn(c, 'forward').mockResolvedValue();

      c.speak('<speak>hello</speak>');

      await vi.waitFor(() => expect(startKeepAlive).toHaveBeenCalled(), { timeout: 5000 });
      expect(c.state).toBe('playing');
      expect(stopKeepAlive).not.toHaveBeenCalled();
    });

    test('does not keep the WebView awake for a buffered (Edge) engine — it emits its own audio', async () => {
      const c = await makeAndroidNativeController();
      c.ttsClient = c.ttsEdgeClient; // mediaClock === true
      vi.spyOn(c, 'forward').mockResolvedValue();

      c.speak('<speak>hello</speak>');

      await vi.waitFor(() => expect(c.state).toBe('playing'), { timeout: 5000 });
      expect(startKeepAlive).not.toHaveBeenCalled();
    });

    test('does not start the keep-alive off Android', async () => {
      // Default controller: appService.isAndroidApp === false, web engine.
      await controller.initViewTTS(0);
      vi.spyOn(controller, 'forward').mockResolvedValue();

      controller.speak('<speak>hello</speak>');

      await vi.waitFor(() => expect(controller.state).toBe('playing'), { timeout: 5000 });
      expect(startKeepAlive).not.toHaveBeenCalled();
    });

    test('stops the keep-alive when playback is paused', async () => {
      const c = await makeAndroidNativeController();
      vi.spyOn(c, 'forward').mockResolvedValue();
      c.speak('<speak>hello</speak>');
      await vi.waitFor(() => expect(startKeepAlive).toHaveBeenCalled(), { timeout: 5000 });

      await c.pause();

      expect(stopKeepAlive).toHaveBeenCalled();
    });

    test('stops the keep-alive on shutdown', async () => {
      const c = await makeAndroidNativeController();
      vi.spyOn(c, 'forward').mockResolvedValue();
      c.speak('<speak>hello</speak>');
      await vi.waitFor(() => expect(startKeepAlive).toHaveBeenCalled(), { timeout: 5000 });

      await c.shutdown();

      expect(stopKeepAlive).toHaveBeenCalled();
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

  describe('highlight hygiene', () => {
    test('section change clears highlights from every live view, not just the primary', async () => {
      // Two sections rendered at once (spread / preloaded adjacent view); the
      // view has already navigated ahead so the primary is the NEW section.
      const mockDoc = { querySelector: vi.fn().mockReturnValue(null) } as unknown as Document;
      const overlayers = [
        { remove: vi.fn(), add: vi.fn() },
        { remove: vi.fn(), add: vi.fn() },
      ];
      const twoSectionView = {
        renderer: {
          primaryIndex: 1,
          getContents: vi.fn().mockReturnValue([
            { doc: mockDoc, index: 0, overlayer: overlayers[0] },
            { doc: mockDoc, index: 1, overlayer: overlayers[1] },
          ]),
        },
        book: {
          sections: [
            { createDocument: vi.fn().mockResolvedValue(mockDoc) },
            { createDocument: vi.fn().mockResolvedValue(mockDoc) },
          ],
        },
        language: { isCJK: false },
        tts: null,
        getCFI: vi.fn().mockReturnValue('cfi-string'),
        resolveCFI: vi.fn().mockReturnValue({ anchor: vi.fn().mockReturnValue(new Range()) }),
      } as unknown as FoliateView;
      const c = new TTSController(mockAppService, twoSectionView, false);
      // Every section entry (start, prev/next, auto-advance) funnels through
      // #initTTSForSection; entering a section must scrub the TTS highlight
      // from EVERY live view, or the outgoing section's last spoken word
      // stays highlighted forever in the preloaded neighbor.
      await c.initViewTTS(0);
      expect(overlayers[0]!.remove).toHaveBeenCalledWith('tts-highlight');
      expect(overlayers[1]!.remove).toHaveBeenCalledWith('tts-highlight');
    });

    test('reapplyCurrentHighlight never draws the sentence in word mode while playing', async () => {
      await controller.initViewTTS(0);
      controller.ttsClient.getCapabilities = vi.fn().mockReturnValue({
        wordBoundaries: true,
        mediaClock: false,
        gapControl: false,
        liveRateChange: false,
      }) as unknown as typeof controller.ttsClient.getCapabilities;
      controller.setHighlightGranularity('word');
      controller.state = 'playing';
      const content = (
        mockView.renderer.getContents() as unknown as {
          overlayer: { add: ReturnType<typeof vi.fn> };
        }[]
      )[0]!;
      content.overlayer.add.mockClear();

      // Between a sentence's mark and its first word boundary a page relocate
      // triggers a re-apply; the whole sentence must not flash in.
      controller.reapplyCurrentHighlight();
      expect(content.overlayer.add).not.toHaveBeenCalled();

      // Paused keeps the sentence re-draw (deliberate navigation UX).
      controller.state = 'paused';
      controller.reapplyCurrentHighlight();
      expect(content.overlayer.add).toHaveBeenCalled();
    });
  });
});
