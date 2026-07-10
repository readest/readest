import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { TTSMessageEvent } from '@/services/tts/TTSClient';
import type { TTSController } from '@/services/tts/TTSController';
import { FakeAudioContext } from './tts-fake-audio';

// Mock control shared with the hoisted module mock.
type MockAudioData = {
  data: ArrayBuffer;
  boundaries: Array<{ offset: number; duration: number; text: string }>;
};
let createAudioDataBehavior: (payloadText: string) => Promise<MockAudioData>;
let parsedMarks: Array<{ name: string; text: string; language: string }> = [];

vi.mock('@/libs/edgeTTS', () => {
  const voices = [{ id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US' }];
  return {
    EdgeSpeechTTS: class MockEdgeSpeechTTS {
      static voices = voices;
      create = vi.fn().mockResolvedValue(undefined);
      createAudioData = vi
        .fn()
        .mockImplementation((payload: { text: string }) => createAudioDataBehavior(payload.text));
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

vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredVoice: vi.fn(() => null),
    sortVoicesPreferLocaleFunc: () => () => 0,
  },
}));

const consoleSpy = {
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
};
void consoleSpy;

// One second of fake audio bytes: the fake decoder maps 1 byte -> 1 sample at
// 24kHz, and all-zero samples make findSpeechBounds keep the full range.
const audioOf = (seconds: number): MockAudioData => ({
  data: new ArrayBuffer(Math.round(seconds * 24000)),
  boundaries: [],
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let rafCallbacks: Map<number, FrameRequestCallback>;
let rafId = 0;
const runRaf = () => {
  const cbs = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const cb of cbs) cb(0);
};

interface MockController {
  dispatchSpeakMark: ReturnType<typeof vi.fn>;
  prepareSpeakWords: ReturnType<typeof vi.fn>;
  dispatchSpeakWord: ReturnType<typeof vi.fn>;
}

type EdgeClientClass = typeof import('@/services/tts/EdgeTTSClient').EdgeTTSClient;

describe('EdgeTTSClient Web Audio playback', () => {
  let EdgeTTSClient: EdgeClientClass;
  let controller: MockController;

  beforeEach(async () => {
    vi.resetModules();
    FakeAudioContext.instances = [];
    rafCallbacks = new Map();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.set(++rafId, cb);
      return rafId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id);
    });
    createAudioDataBehavior = async () => audioOf(1);
    parsedMarks = [
      { name: '0', text: 'First sentence.', language: 'en' },
      { name: '1', text: 'Second sentence.', language: 'en' },
    ];
    controller = {
      dispatchSpeakMark: vi.fn(),
      prepareSpeakWords: vi.fn(),
      dispatchSpeakWord: vi.fn(),
    };
    ({ EdgeTTSClient } = await import('@/services/tts/EdgeTTSClient'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const startClient = async () => {
    const client = new EdgeTTSClient(controller as unknown as TTSController);
    await client.init();
    return client;
  };

  const collectSpeak = (client: InstanceType<EdgeClientClass>, signal: AbortSignal) => {
    const events: TTSMessageEvent[] = [];
    const done = (async () => {
      for await (const event of client.speak('<ssml/>', signal)) {
        events.push(event);
      }
    })();
    return { events, done };
  };

  const ctx = () => FakeAudioContext.instances[0]!;

  test('plays marks gaplessly: boundary per audible chunk, one final end', async () => {
    const client = await startClient();
    const { events, done } = collectSpeak(client, new AbortController().signal);
    await flush();
    await flush();

    // Both chunks scheduled ahead, but only chunk 0 is audible: exactly one
    // mark dispatched so foliate's cursor tracks the voice, not the fetcher.
    expect(ctx().sources.length).toBe(2);
    expect(controller.dispatchSpeakMark).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.code === 'boundary')).toHaveLength(1);

    await ctx().advanceTo(1.1); // chunk 0 ends (starts at 0.03, 1s long)
    await flush();
    expect(controller.dispatchSpeakMark).toHaveBeenCalledTimes(2);

    await ctx().advanceTo(3); // chunk 1 ends
    await done;
    expect(events.map((e) => e.code)).toEqual(['boundary', 'boundary', 'end']);
    expect(events[0]!.mark).toBe('0');
    expect(events[1]!.mark).toBe('1');
  });

  test('chunks are scheduled with a rate-scaled gap and no element restarts', async () => {
    const client = await startClient();
    await client.setRate(1); // gap = 0.15 / 1
    const { done } = collectSpeak(client, new AbortController().signal);
    await flush();
    await flush();
    const [first, second] = ctx().sources;
    expect(second!.startedAt! - first!.endTime).toBeCloseTo(0.15, 5);
    await ctx().advanceTo(5);
    await done;
  });

  test('setSentenceGap before speaking changes the observed gap', async () => {
    const client = await startClient();
    await client.setRate(1);
    client.setSentenceGap(0.4); // gap = 0.4 / 1
    const { done } = collectSpeak(client, new AbortController().signal);
    await flush();
    await flush();
    const [first, second] = ctx().sources;
    expect(second!.startedAt! - first!.endTime).toBeCloseTo(0.4, 5);
    await ctx().advanceTo(5);
    await done;
  });

  test('setSentenceGap mid-session affects the next scheduled gap', async () => {
    parsedMarks = [
      { name: '0', text: 'First sentence.', language: 'en' },
      { name: '1', text: 'Second sentence.', language: 'en' },
      { name: '2', text: 'Third sentence.', language: 'en' },
      { name: '3', text: 'Fourth sentence.', language: 'en' },
    ];
    const client = await startClient();
    await client.setRate(1);
    const { done } = collectSpeak(client, new AbortController().signal);
    // Initial scheduling of chunks
    await flush();
    await flush();
    let sources = ctx().sources;
    const [first, second] = sources;
    expect(second!.startedAt! - first!.endTime).toBeCloseTo(0.15, 5);

    // Change gap mid-session
    client.setSentenceGap(0.3);

    // Advance playback to trigger chunk 0's onended and free scheduling capacity
    // for chunk 2 to be scheduled. Then advance more to free chunk 1 so chunk 3 is scheduled.
    await ctx().advanceTo(1.1);
    await flush();

    // Chunk 2 should now be scheduled with the old gap (from chunk 1's timing)
    sources = ctx().sources;
    expect(sources.length).toBeGreaterThanOrEqual(3);

    // Advance further to free chunk 2, allowing chunk 3 to be scheduled with the new gap
    await ctx().advanceTo(3.4);
    await flush();

    sources = ctx().sources;
    expect(sources.length).toBeGreaterThanOrEqual(4);

    // Chunk 2 is the first chunk scheduled after setSentenceGap, so the gap
    // preceding chunk 3 (chunk 2's schedule-time gap) reflects the new value.
    const [, , thirdChunk, fourthChunk] = sources;
    expect(fourthChunk!.startedAt! - thirdChunk!.endTime).toBeCloseTo(0.3, 5);

    await ctx().advanceTo(5);
    await done;
  });

  test('word tracking follows the audio clock and survives pause/resume', async () => {
    createAudioDataBehavior = async () => ({
      data: new ArrayBuffer(48000), // 2s
      boundaries: [
        { offset: 1_000_000, duration: 4_000_000, text: 'Hello' }, // 0.1s
        { offset: 6_000_000, duration: 4_000_000, text: 'brave' }, // 0.6s
        { offset: 11_000_000, duration: 4_000_000, text: 'world' }, // 1.1s
      ],
    });
    parsedMarks = [{ name: '0', text: 'Hello brave world', language: 'en' }];
    const client = await startClient();
    const { done } = collectSpeak(client, new AbortController().signal);
    await flush();
    await flush();

    expect(controller.prepareSpeakWords).toHaveBeenCalledWith(['Hello', 'brave', 'world']);
    ctx().currentTime = 0.03 + 0.15;
    runRaf();
    expect(controller.dispatchSpeakWord).toHaveBeenLastCalledWith(0);

    await client.pause();
    expect(ctx().state).toBe('suspended');
    await client.resume();
    expect(ctx().state).toBe('running');

    ctx().currentTime = 0.03 + 0.7;
    runRaf();
    expect(controller.dispatchSpeakWord).toHaveBeenLastCalledWith(1);

    // Same index is not re-dispatched.
    const calls = controller.dispatchSpeakWord.mock.calls.length;
    runRaf();
    expect(controller.dispatchSpeakWord.mock.calls.length).toBe(calls);

    await ctx().advanceTo(5);
    await done;
  });

  test('abort mid-stream yields Aborted and stops all sources', async () => {
    const client = await startClient();
    const abortController = new AbortController();
    const { events, done } = collectSpeak(client, abortController.signal);
    await flush();
    await flush();
    abortController.abort();
    await done;
    expect(events.at(-1)).toMatchObject({ code: 'error', message: 'Aborted' });
    expect(ctx().sources.every((s) => s.stopped)).toBe(true);
  });

  test('a no-audio mark is skipped and the session continues', async () => {
    createAudioDataBehavior = async (text: string) => {
      if (text === 'First sentence.') throw new Error('No audio data received.');
      return audioOf(1);
    };
    const client = await startClient();
    const { events, done } = collectSpeak(client, new AbortController().signal);
    await flush();
    await flush();
    await ctx().advanceTo(5);
    await done;
    const codes = events.map((e) => e.code);
    expect(codes.filter((c) => c === 'boundary')).toHaveLength(1);
    expect(codes.at(-1)).toBe('end');
  });

  test('a decode failure is treated like no-audio: warn, skip, continue', async () => {
    // The context exists once the scheduler's first fetch runs (ensureContext
    // precedes it), so the first fetch installs a decoder that fails exactly
    // once — the first mark's decode dies, the second succeeds.
    let installed = false;
    createAudioDataBehavior = async () => {
      if (!installed) {
        installed = true;
        const context = FakeAudioContext.instances[0]!;
        const original = context.decodeImpl;
        let failed = false;
        context.decodeImpl = async (data) => {
          if (!failed) {
            failed = true;
            throw new Error('bad mp3');
          }
          return original(data);
        };
      }
      return audioOf(1);
    };
    const client = await startClient();
    const { events, done } = collectSpeak(client, new AbortController().signal);
    await flush();
    await flush();
    await ctx().advanceTo(10);
    await done;
    const codes = events.map((e) => e.code);
    expect(codes.filter((c) => c === 'boundary')).toHaveLength(1); // only mark 1 played
    expect(codes.at(-1)).toBe('end');
  });

  test('all marks failing still ends the session with end (no wedge)', async () => {
    createAudioDataBehavior = async () => {
      throw new Error('No audio data received.');
    };
    const client = await startClient();
    const { events, done } = collectSpeak(client, new AbortController().signal);
    await done; // zero chunks scheduled; session-end fires synchronously
    const codes = events.map((e) => e.code);
    expect(codes.at(-1)).toBe('end');
    expect(codes).not.toContain('boundary');
  });

  test('a hard fetch error yields error and terminates', async () => {
    createAudioDataBehavior = async () => {
      throw new Error('network exploded');
    };
    const client = await startClient();
    const { events, done } = collectSpeak(client, new AbortController().signal);
    await done;
    expect(events.at(-1)).toMatchObject({ code: 'error', message: 'network exploded' });
  }, 10000);

  test('pause without a session is a no-op returning true', async () => {
    const client = await startClient();
    expect(await client.pause()).toBe(true);
    expect(await client.resume()).toBe(true);
  });

  test('getChunkPosition reports trim-relative clamped seconds', async () => {
    const client = await startClient();
    parsedMarks = [{ name: '0', text: 'Only sentence.', language: 'en' }];
    const { done } = collectSpeak(client, new AbortController().signal);
    await flush();
    await flush();
    ctx().currentTime = 0.03 + 0.4;
    const pos = client.getChunkPosition();
    expect(pos).not.toBeNull();
    expect(pos!).toBeGreaterThan(0.3);
    expect(pos!).toBeLessThanOrEqual(1);
    await ctx().advanceTo(5);
    await done;
    expect(client.getChunkPosition()).toBeNull();
  });
});
