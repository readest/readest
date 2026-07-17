/**
 * wordPronouncer — pronounces a single dictionary word.
 *
 * The pronouncer is deliberately independent of the reader's TTSController: it
 * synthesizes via EdgeSpeechTTS directly (no throwaway init synth), plays on a
 * dedicated Web Audio context, and drops to the platform speech client
 * (Web Speech on desktop/web, native on the mobile app) when Edge is
 * unavailable. These tests pin that Edge-first / fallback-on-failure contract
 * and the language -> Edge voice selection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TTSUtils } from '@/services/tts/TTSUtils';

const h = vi.hoisted(() => {
  const createAudioData = vi.fn();
  let sessionOnEvent: ((e: { type: string; message?: string }) => void) | null = null;
  const player = {
    ensureContext: vi.fn().mockResolvedValue({}),
    decode: vi.fn().mockResolvedValue({ duration: 0.5 }),
    startSession: vi.fn((onEvent: (e: { type: string; message?: string }) => void) => {
      sessionOnEvent = onEvent;
      return 1;
    }),
    scheduleChunk: vi.fn(),
    endSession: vi.fn(),
    abortSession: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    fireSessionEnd: () => sessionOnEvent?.({ type: 'session-end' }),
    fireContextError: () => sessionOnEvent?.({ type: 'context-error', message: 'boom' }),
  };
  const makeClient = (speak: unknown) => ({
    init: vi.fn().mockResolvedValue(true),
    setPrimaryLang: vi.fn(),
    speak,
    shutdown: vi.fn().mockResolvedValue(undefined),
  });
  // eslint-disable-next-line require-yield
  const webSpeak = vi.fn(async function* (_ssml: string, _signal: AbortSignal) {});
  // eslint-disable-next-line require-yield
  const nativeSpeak = vi.fn(async function* (_ssml: string, _signal: AbortSignal) {});
  return {
    createAudioData,
    player,
    webClient: makeClient(webSpeak),
    nativeClient: makeClient(nativeSpeak),
    webSpeak,
    nativeSpeak,
  };
});

let tauriPlatform = false;
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => tauriPlatform,
}));

vi.mock('@/libs/edgeTTS', () => {
  class EdgeSpeechTTS {
    static voices = [
      { name: 'Aria', id: 'en-US-AriaNeural', lang: 'en-US' },
      { name: 'Ryan', id: 'en-GB-RyanNeural', lang: 'en-GB' },
      { name: 'Denise', id: 'fr-FR-DeniseNeural', lang: 'fr-FR' },
    ];
    createAudioData = h.createAudioData;
  }
  return { EdgeSpeechTTS };
});

vi.mock('@/services/tts/WebAudioPlayer', () => ({
  WebAudioPlayer: class {
    constructor() {
      Object.assign(this, h.player);
    }
  },
}));

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: class {
    constructor() {
      Object.assign(this, h.webClient);
    }
  },
}));

vi.mock('@/services/tts/NativeTTSClient', () => ({
  NativeTTSClient: class {
    constructor() {
      Object.assign(this, h.nativeClient);
    }
  },
}));

import { pronounceWord, pickEdgeVoiceId, cancelWordPronounce } from '@/services/tts/wordPronouncer';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  tauriPlatform = false;
  vi.clearAllMocks();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = vi.fn();
  h.createAudioData.mockReset();
});

describe('pickEdgeVoiceId', () => {
  it('returns the first Edge voice whose locale matches the language', () => {
    expect(pickEdgeVoiceId('en')).toBe('en-US-AriaNeural');
    expect(pickEdgeVoiceId('fr')).toBe('fr-FR-DeniseNeural');
  });

  it('falls back to the default English voice for an unknown language', () => {
    expect(pickEdgeVoiceId('xx')).toBe('en-US-AriaNeural');
  });

  it("respects the user's preferred Edge voice for the language when valid", () => {
    const spy = vi.spyOn(TTSUtils, 'getPreferredVoice').mockReturnValue('en-GB-RyanNeural');
    expect(pickEdgeVoiceId('en')).toBe('en-GB-RyanNeural');
    spy.mockRestore();
  });
});

describe('pronounceWord — Edge path', () => {
  it('synthesizes with Edge and schedules playback without touching the fallback', async () => {
    h.createAudioData.mockResolvedValue({ data: new ArrayBuffer(8), boundaries: [] });
    const onStatus = vi.fn();

    await pronounceWord('hello', 'en', {}, onStatus);

    expect(h.createAudioData).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hello', lang: 'en', voice: 'en-US-AriaNeural' }),
    );
    expect(h.player.scheduleChunk).toHaveBeenCalledTimes(1);
    expect(h.webSpeak).not.toHaveBeenCalled();
    expect(h.nativeSpeak).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith('playing');

    h.player.fireSessionEnd();
    expect(onStatus).toHaveBeenLastCalledWith('ended');
  });

  it('reports an error when the audio context surfaces one mid-playback', async () => {
    h.createAudioData.mockResolvedValue({ data: new ArrayBuffer(8), boundaries: [] });
    const onStatus = vi.fn();

    await pronounceWord('hello', 'en', {}, onStatus);
    h.player.fireContextError();

    expect(onStatus).toHaveBeenLastCalledWith('error');
  });
});

describe('pronounceWord — fallback path', () => {
  it('drops to Web Speech on desktop/web when Edge fails', async () => {
    h.createAudioData.mockRejectedValue(new Error('wss blocked'));
    const onStatus = vi.fn();

    await pronounceWord('hello', 'en', {}, onStatus);
    await flush();

    expect(h.webSpeak).toHaveBeenCalledTimes(1);
    const ssml = h.webSpeak.mock.calls[0]![0];
    expect(ssml).toContain('hello');
    expect(h.nativeSpeak).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith('ended');
  });

  it('uses the native client on the mobile app when Edge fails', async () => {
    h.createAudioData.mockRejectedValue(new Error('wss blocked'));
    const onStatus = vi.fn();

    await pronounceWord('hello', 'en', { appService: { isMobile: true } as never }, onStatus);
    await flush();

    expect(h.nativeSpeak).toHaveBeenCalledTimes(1);
    expect(h.webSpeak).not.toHaveBeenCalled();
  });

  it('retries via the authenticated https proxy on the web when wss fails', async () => {
    h.createAudioData.mockRejectedValue(new Error('wss blocked'));

    await pronounceWord('hello', 'en', {}, vi.fn());
    await flush();

    // wss attempt + https proxy retry
    expect(h.createAudioData).toHaveBeenCalledTimes(2);
  });

  it('does not retry via the https proxy on Tauri when wss fails', async () => {
    tauriPlatform = true;
    h.createAudioData.mockRejectedValue(new Error('offline'));

    await pronounceWord('hello', 'en', { appService: { isMobile: true } as never }, vi.fn());
    await flush();

    // Only the native wss attempt: the /api/tts/edge proxy must not be
    // requested from the Tauri app; the word drops to the platform speech.
    expect(h.createAudioData).toHaveBeenCalledTimes(1);
    expect(h.nativeSpeak).toHaveBeenCalledTimes(1);
  });
});

describe('pronounceWord — guards', () => {
  it('does nothing for a blank word', async () => {
    const onStatus = vi.fn();
    await pronounceWord('   ', 'en', {}, onStatus);
    expect(h.createAudioData).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith('ended');
  });

  it('aborts the active session on cancel', async () => {
    cancelWordPronounce();
    expect(h.player.abortSession).toHaveBeenCalled();
  });
});
