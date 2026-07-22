import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn(),
}));

import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import { NativeAudioPlayer } from '@/services/tts/NativeAudioPlayer';
import type { WebAudioPlayerEvent } from '@/services/tts/WebAudioPlayer';

describe('NativeAudioPlayer', () => {
  let playoutEvents: ((payload: unknown) => void) | null;
  let controlCalls: Array<{ action: string; rate?: number }>;
  let enqueueCalls: Array<{ session: number; index: number; gapMs: number }>;

  beforeEach(() => {
    vi.clearAllMocks();
    playoutEvents = null;
    controlCalls = [];
    enqueueCalls = [];
    vi.mocked(addPluginListener).mockImplementation((async (
      _plugin: string,
      event: string,
      cb: (payload: unknown) => void,
    ) => {
      if (event === 'playout_events') playoutEvents = cb;
      return { unregister: vi.fn() } as unknown as PluginListener;
    }) as unknown as typeof addPluginListener);
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      const payload = (args as { payload?: Record<string, unknown> })?.payload ?? {};
      if (cmd === 'plugin:native-tts|playout_control') {
        controlCalls.push(payload as { action: string; rate?: number });
        if (payload['action'] === 'start-session') return { session: 7 } as unknown;
        return { session: null } as unknown;
      }
      if (cmd === 'plugin:native-tts|playout_enqueue') {
        enqueueCalls.push(payload as { session: number; index: number; gapMs: number });
        return { durationMs: 2500 } as unknown;
      }
      if (cmd === 'plugin:native-tts|playout_position') {
        return { session: 7, index: 0, positionMs: 1000, playing: true } as unknown;
      }
      return undefined as unknown;
    });
  });

  const startedPlayer = async (events: WebAudioPlayerEvent[]) => {
    const player = new NativeAudioPlayer();
    await player.ensureContext();
    const generation = player.startSession((event) => events.push(event));
    // Let the start-session invoke resolve so the native session id maps.
    await Promise.resolve();
    await Promise.resolve();
    return { player, generation };
  };

  test('session start, enqueue, and chunk-start event round trip', async () => {
    const events: WebAudioPlayerEvent[] = [];
    const { player, generation } = await startedPlayer(events);
    expect(controlCalls[0]).toEqual({ action: 'start-session' });

    const durationSec = await player.scheduleRawChunk(generation, 0, new ArrayBuffer(8), {
      gapSec: 0.15,
    });
    expect(durationSec).toBe(2.5);
    expect(enqueueCalls[0]!.session).toBe(7);
    expect(enqueueCalls[0]!.index).toBe(0);
    expect(enqueueCalls[0]!.gapMs).toBeCloseTo(150);

    playoutEvents!({ type: 'chunk-start', session: 7, index: 0 });
    expect(events).toEqual([{ type: 'chunk-start', chunkIndex: 0 }]);
    // The media clock now reports the playing chunk.
    expect(player.getPlaybackPosition(generation)?.chunkIndex).toBe(0);
    await player.shutdown();
  });

  test('events from a stale native session are ignored', async () => {
    const events: WebAudioPlayerEvent[] = [];
    const { player, generation } = await startedPlayer(events);
    playoutEvents!({ type: 'chunk-start', session: 6, index: 3 });
    expect(events).toEqual([]);
    expect(player.getPlaybackPosition(generation)).toBeNull();
    await player.shutdown();
  });

  test('session-end maps to the WebAudioPlayer event shape', async () => {
    const events: WebAudioPlayerEvent[] = [];
    const { player } = await startedPlayer(events);
    playoutEvents!({ type: 'session-end', session: 7 });
    expect(events).toEqual([{ type: 'session-end' }]);
    await player.shutdown();
  });

  test('backpressure blocks past the pending budget and releases on chunk-start', async () => {
    const events: WebAudioPlayerEvent[] = [];
    const { player, generation } = await startedPlayer(events);
    for (let i = 0; i < 3; i++) {
      await player.scheduleRawChunk(generation, i, new ArrayBuffer(4), { gapSec: 0 });
    }
    // 3 scheduled, none started: the budget (3) is exhausted.
    let ready: boolean | null = null;
    void player.waitUntilReady(generation).then((r) => {
      ready = r;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(ready).toBeNull();
    playoutEvents!({ type: 'chunk-start', session: 7, index: 0 });
    await new Promise((r) => setTimeout(r, 0));
    expect(ready).toBe(true);
    await player.shutdown();
  });

  test('abort resolves pending waiters false and aborts natively', async () => {
    const events: WebAudioPlayerEvent[] = [];
    const { player, generation } = await startedPlayer(events);
    for (let i = 0; i < 3; i++) {
      await player.scheduleRawChunk(generation, i, new ArrayBuffer(4), { gapSec: 0 });
    }
    const pending = player.waitUntilReady(generation);
    player.abortSession();
    await expect(pending).resolves.toBe(false);
    await Promise.resolve();
    expect(controlCalls.some((c) => c.action === 'abort')).toBe(true);
    // A dead generation never schedules.
    const durationSec = await player.scheduleRawChunk(generation, 3, new ArrayBuffer(4), {
      gapSec: 0,
    });
    expect(durationSec).toBe(0);
    await player.shutdown();
  });

  test('pause and resume flow through playout control and the user-pause flag', async () => {
    const events: WebAudioPlayerEvent[] = [];
    const { player } = await startedPlayer(events);
    await player.pauseContext();
    expect(player.isUserPaused()).toBe(true);
    expect(controlCalls.some((c) => c.action === 'pause')).toBe(true);
    await player.resumeContext();
    expect(player.isUserPaused()).toBe(false);
    expect(controlCalls.some((c) => c.action === 'resume')).toBe(true);
    await player.shutdown();
  });

  test('rate changes are applied live', async () => {
    const events: WebAudioPlayerEvent[] = [];
    const { player } = await startedPlayer(events);
    await player.setRate(1.5);
    expect(controlCalls.some((c) => c.action === 'set-rate' && c.rate === 1.5)).toBe(true);
    await player.shutdown();
  });
});
