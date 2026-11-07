import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn().mockResolvedValue({ unregister: vi.fn() }),
}));

// Avoid pulling in the heavy TTSController module graph (foliate-js, etc.) — the
// native client only references it as a type.
vi.mock('@/services/tts/TTSController', () => ({ TTSController: class {} }));

import { NativeTTSClient } from '@/services/tts/NativeTTSClient';
import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import type { TTSMessageEvent } from '@/services/tts/TTSClient';
import type { TTSController } from '@/services/tts/TTSController';

describe('NativeTTSClient Linux rate', () => {
  test('passes the requested rate to speech-dispatcher without the mobile exponent', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const controller = { appService: { isLinuxApp: true } } as unknown as TTSController;
    const client = new NativeTTSClient(controller);
    await client.setRate(1.5);
    expect(invoke).toHaveBeenLastCalledWith('plugin:native-tts|set_rate', {
      payload: { rate: 1.5 },
    });
  });
});

describe('NativeTTSClient event delivery', () => {
  const listener = {
    plugin: 'native-tts',
    event: 'tts_events',
    channelId: 1,
    unregister: async () => {},
  } satisfies PluginListener;
  afterEach(() => {
    vi.useRealTimers();
  });

  test('waits for event registration before initialization completes', async () => {
    let register!: (listener: PluginListener) => void;
    vi.mocked(invoke).mockResolvedValue({ success: true });
    vi.mocked(addPluginListener).mockReturnValueOnce(
      new Promise((resolve) => (register = resolve)),
    );
    const client = new NativeTTSClient();
    let ready = false;
    const init = client.init().then(() => (ready = true));
    await vi.waitFor(() => expect(addPluginListener).toHaveBeenCalled());
    expect(ready).toBe(false);
    register(listener);
    await init;
    expect(ready).toBe(true);
  });

  test('cancels a Linux utterance aborted while its speak reply is pending', async () => {
    let reply!: (reply: { utteranceId: string }) => void;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'plugin:native-tts|speak') {
        return new Promise((resolve) => (reply = resolve));
      }
      return Promise.resolve(undefined);
    });
    const controller = { appService: { isLinuxApp: true } } as unknown as TTSController;
    const client = new NativeTTSClient(controller);
    vi.spyOn(client, 'getVoiceIdFromLang').mockResolvedValue('voice');
    const abort = new AbortController();
    const speaking = client
      .speakMark(
        { name: 'sentence', text: 'Hello.', language: 'en', offset: 0 },
        false,
        abort.signal,
      )
      .next();
    await vi.waitFor(() => expect(reply).toBeDefined());
    abort.abort();
    reply({ utteranceId: 'canceled' });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('plugin:native-tts|stop', {
        payload: { utteranceId: 'canceled' },
      }),
    );
    await speaking;
  });

  test('keeps early events separate when speak replies overlap', async () => {
    let onEvent!: (event: TTSMessageEvent & { utteranceId: string }) => void;
    const replies: ((reply: { utteranceId: string }) => void)[] = [];
    vi.mocked(addPluginListener).mockImplementationOnce(async (_plugin, _event, callback) => {
      onEvent = callback;
      return listener;
    });
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'plugin:native-tts|init') return Promise.resolve({ success: true });
      if (command === 'plugin:native-tts|speak') {
        return new Promise((resolve) => replies.push(resolve));
      }
      return Promise.resolve(undefined);
    });
    const client = new NativeTTSClient();
    vi.spyOn(client, 'getVoiceIdFromLang').mockResolvedValue('voice');
    await client.init();
    const mark = { name: 'sentence', text: 'Hello.', language: 'en', offset: 0 };
    const first = client.speakMark(mark, false, new AbortController().signal);
    const second = client.speakMark(mark, false, new AbortController().signal);
    const a = first.next();
    const b = second.next();
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    onEvent({ utteranceId: 'a', code: 'end' });
    onEvent({ utteranceId: 'b', code: 'end' });
    replies[0]!({ utteranceId: 'a' });
    expect((await a).value?.code).toBe('end');
    await first.return();
    replies[1]!({ utteranceId: 'b' });
    expect((await b).value?.code).toBe('end');
    await second.return();
  });

  test.each([
    'end',
    'error',
  ] as const)('delivers %s even when speech-dispatcher finishes before the speak reply', async (terminal) => {
    vi.useFakeTimers();
    let onEvent!: (event: TTSMessageEvent & { utteranceId: string }) => void;
    vi.mocked(addPluginListener).mockImplementationOnce(async (_plugin, _event, callback) => {
      onEvent = callback;
      return listener;
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'plugin:native-tts|init') return { success: true };
      if (command === 'plugin:native-tts|get_all_voices') {
        return { voices: [{ id: 'speechd:espeak-ng:English', name: 'English', lang: 'en' }] };
      }
      if (command === 'plugin:native-tts|speak') {
        onEvent({ utteranceId: '1', code: 'boundary' });
        onEvent({ utteranceId: '1', code: terminal });
        return { utteranceId: '1' };
      }
      return undefined;
    });
    const client = new NativeTTSClient();
    await client.init();
    const events: TTSMessageEvent[] = [];
    const abort = new AbortController();
    const speaking = (async () => {
      for await (const event of client.speakMark(
        { name: 'sentence-1', text: 'Hello.', language: 'en', offset: 0 },
        false,
        abort.signal,
      )) {
        events.push(event);
      }
    })();
    await vi.advanceTimersByTimeAsync(200);
    try {
      expect(events.map((event) => event.code)).toEqual(['boundary', terminal]);
      expect(events.every((event) => event.mark === 'sentence-1')).toBe(true);
    } finally {
      abort.abort();
      await vi.advanceTimersByTimeAsync(1500);
      await speaking;
    }
  });
});

describe('NativeTTSClient.stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('resolves promptly when the native stop resolves', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const client = new NativeTTSClient();

    await client.stop();

    expect(invoke).toHaveBeenCalledWith('plugin:native-tts|stop');
  });

  test('still resolves (bounded) when the native stop never resolves', async () => {
    // Regression for #4676: a hung native stop must not hang teardown
    // (controller.stop / shutdown), which would leave the TTS icon stuck.
    vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
    const client = new NativeTTSClient();

    let settled = false;
    const p = client.stop().then(() => {
      settled = true;
    });

    // Pending until the timeout fires.
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(settled).toBe(true);
  });
});

describe('NativeTTSClient voice filtering', () => {
  test('excludes Apple novelty and Eloquence voices, retaining normal and non-Apple voices', async () => {
    const voices = [
      { id: 'com.apple.speech.synthesis.voice.BadNews', name: 'Bad News', lang: 'en-US' },
      { id: 'com.apple.eloquence.en-US.Eddy', name: 'Eddy (United States)', lang: 'en-US' },
      { id: 'com.apple.voice.super-compact.en-US.Samantha', name: 'Samantha', lang: 'en-US' },
      { id: 'com.apple.voice.enhanced.en-US.Samantha', name: 'Samantha (Enhanced)', lang: 'en-US' },
      { id: 'com.apple.ttsbundle.siri_Aaron_en-US_compact', name: 'Aaron', lang: 'en-US' },
      { id: 'android-voice-1', name: 'Eddy', lang: 'en-US' },
    ];
    vi.mocked(invoke).mockResolvedValue({ voices });
    const client = new NativeTTSClient();
    expect((await client.getAllVoices()).map((voice) => voice.id)).toEqual(
      voices.slice(2).map((voice) => voice.id),
    );
    const groups = await client.getVoices('en');
    expect(groups.flatMap((group) => group.voices)).toHaveLength(4);
  });
});
