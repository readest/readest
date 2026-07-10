import { afterEach, describe, expect, test } from 'vitest';

import { WebAudioPlayer, type WebAudioPlayerEvent } from '@/services/tts/WebAudioPlayer';
import { FakeAudioContext, makeBuffer } from './tts-fake-audio';

const SAFETY = 0.03;

const setVisibility = (value: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  });
};

afterEach(() => {
  setVisibility('visible');
});

const setup = () => {
  const ctx = new FakeAudioContext();
  const player = new WebAudioPlayer(() => ctx);
  const events: WebAudioPlayerEvent[] = [];
  return { ctx, player, events, onEvent: (e: WebAudioPlayerEvent) => events.push(e) };
};

describe('WebAudioPlayer scheduling', () => {
  test('chunks are scheduled contiguously with the requested gap', async () => {
    const { ctx, player, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.scheduleChunk(gen, makeBuffer(2), { trimStartSec: 0, mediaScale: 1, gapSec: 0.5 });
    player.scheduleChunk(gen, makeBuffer(3), { trimStartSec: 0, mediaScale: 1, gapSec: 0.5 });
    expect(ctx.sources[0]!.startedAt).toBeCloseTo(SAFETY, 5);
    expect(ctx.sources[1]!.startedAt).toBeCloseTo(SAFETY + 2 + 0.5, 5);
  });

  test('chunk-start fires at schedule for index 0 and on prior onended after', async () => {
    const { ctx, player, events, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.scheduleChunk(gen, makeBuffer(2), { trimStartSec: 0, mediaScale: 1, gapSec: 0.2 });
    expect(events).toEqual([{ type: 'chunk-start', chunkIndex: 0 }]);
    player.scheduleChunk(gen, makeBuffer(1), { trimStartSec: 0, mediaScale: 1, gapSec: 0.2 });
    expect(events).toHaveLength(1);
    await ctx.advanceTo(SAFETY + 2);
    expect(events).toEqual([
      { type: 'chunk-start', chunkIndex: 0 },
      { type: 'chunk-start', chunkIndex: 1 },
    ]);
  });

  test('stale-generation scheduleChunk is a no-op', async () => {
    const { ctx, player, events, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.startSession(() => {});
    player.scheduleChunk(gen, makeBuffer(1), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    expect(ctx.sources).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

describe('WebAudioPlayer backpressure', () => {
  test('third chunk waits until the first finishes while visible', async () => {
    const { ctx, player, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.scheduleChunk(gen, makeBuffer(2), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    player.scheduleChunk(gen, makeBuffer(2), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    let resolved: boolean | null = null;
    const wait = player.waitUntilReady(gen).then((r) => {
      resolved = r;
      return r;
    });
    await Promise.resolve();
    expect(resolved).toBeNull();
    await ctx.advanceTo(SAFETY + 2);
    expect(await wait).toBe(true);
  });

  test('hidden visibility deepens the pending-chunk budget to 5', async () => {
    setVisibility('hidden');
    const { player, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    for (let i = 0; i < 4; i++) {
      player.scheduleChunk(gen, makeBuffer(1), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    }
    expect(await player.waitUntilReady(gen)).toBe(true);
  });

  test('seconds cap blocks scheduling far ahead even under the chunk budget', async () => {
    setVisibility('hidden');
    const { ctx, player, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.scheduleChunk(gen, makeBuffer(30), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    player.scheduleChunk(gen, makeBuffer(31), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    let resolved: boolean | null = null;
    const wait = player.waitUntilReady(gen).then((r) => {
      resolved = r;
      return r;
    });
    await Promise.resolve();
    expect(resolved).toBeNull(); // 61s ahead > 60s cap, though only 2 < 5 chunks
    await ctx.advanceTo(SAFETY + 30);
    expect(await wait).toBe(true);
  });

  test('waitUntilReady returns false for a stale generation', async () => {
    const { player, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.startSession(() => {});
    expect(await player.waitUntilReady(gen)).toBe(false);
  });
});

describe('WebAudioPlayer session end', () => {
  test('session-end fires after endSession + last onended', async () => {
    const { ctx, player, events, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.scheduleChunk(gen, makeBuffer(1), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    player.endSession(gen);
    expect(events.filter((e) => e.type === 'session-end')).toHaveLength(0);
    await ctx.advanceTo(SAFETY + 1);
    expect(events.filter((e) => e.type === 'session-end')).toHaveLength(1);
  });

  test('endSession with zero scheduled chunks fires session-end synchronously', async () => {
    const { player, events, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.endSession(gen);
    expect(events).toEqual([{ type: 'session-end' }]);
  });

  test('endSession after the last onended already fired still ends the session', async () => {
    const { ctx, player, events, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.scheduleChunk(gen, makeBuffer(1), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    await ctx.advanceTo(SAFETY + 1);
    expect(events.filter((e) => e.type === 'session-end')).toHaveLength(0);
    player.endSession(gen);
    expect(events.filter((e) => e.type === 'session-end')).toHaveLength(1);
  });

  test('session-end is emitted exactly once', async () => {
    const { ctx, player, events, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.scheduleChunk(gen, makeBuffer(1), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    player.endSession(gen);
    player.endSession(gen);
    await ctx.advanceTo(SAFETY + 1);
    await ctx.advanceTo(SAFETY + 2);
    expect(events.filter((e) => e.type === 'session-end')).toHaveLength(1);
  });
});

describe('WebAudioPlayer abort', () => {
  test('abort stops pending sources, resolves waiters false, silences events', async () => {
    const { ctx, player, events, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    for (let i = 0; i < 3; i++) {
      player.scheduleChunk(gen, makeBuffer(2), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    }
    const wait = player.waitUntilReady(gen);
    player.abortSession();
    expect(await wait).toBe(false);
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
    const countBefore = events.length;
    await ctx.advanceTo(100);
    expect(events).toHaveLength(countBefore);
  });

  test('double abortSession is idempotent', async () => {
    const { player, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.scheduleChunk(gen, makeBuffer(1), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    player.abortSession();
    expect(() => player.abortSession()).not.toThrow();
  });

  test('abort storm: 10 rapid startSession calls leave one live session, no stale events', async () => {
    const { ctx, player, onEvent } = setup();
    await player.ensureContext();
    const gens: number[] = [];
    const staleEvents: WebAudioPlayerEvent[] = [];
    for (let i = 0; i < 10; i++) {
      const gen = player.startSession(i === 9 ? onEvent : (e) => staleEvents.push(e));
      player.scheduleChunk(gen, makeBuffer(1), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
      gens.push(gen);
    }
    for (const gen of gens.slice(0, 9)) {
      player.scheduleChunk(gen, makeBuffer(1), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
      expect(await player.waitUntilReady(gen)).toBe(false);
    }
    // Stale sessions emitted only their own synchronous chunk-start 0 before
    // being aborted; nothing new after the storm.
    const staleCount = staleEvents.length;
    await ctx.advanceTo(50);
    expect(staleEvents).toHaveLength(staleCount);
    expect(await player.waitUntilReady(gens[9]!)).toBe(true);
  });
});

describe('WebAudioPlayer pause/resume and interruption', () => {
  test('pauseContext suspends; resumeContext resumes', async () => {
    const { ctx, player } = setup();
    await player.ensureContext();
    player.startSession(() => {});
    await player.pauseContext();
    expect(ctx.state).toBe('suspended');
    await player.resumeContext();
    expect(ctx.state).toBe('running');
  });

  test('auto-resumes on unexpected suspension while a session is live', async () => {
    const { ctx, player, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.scheduleChunk(gen, makeBuffer(2), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    const before = ctx.resumeCalls;
    ctx.setState('interrupted');
    await Promise.resolve();
    expect(ctx.resumeCalls).toBeGreaterThan(before);
  });

  test('user pause suppresses auto-resume', async () => {
    const { ctx, player, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.scheduleChunk(gen, makeBuffer(2), { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
    await player.pauseContext();
    const before = ctx.resumeCalls;
    ctx.setState('interrupted');
    await Promise.resolve();
    expect(ctx.resumeCalls).toBe(before);
  });

  test('resumeContext throws when the context refuses to run again', async () => {
    const { ctx, player } = setup();
    await player.ensureContext();
    await player.pauseContext();
    ctx.resumeImpl = () => {
      ctx.state = 'interrupted';
    };
    await expect(player.resumeContext()).rejects.toThrow();
  });
});

describe('WebAudioPlayer playback position', () => {
  test('maps playback time through trim offset and media scale', async () => {
    const { ctx, player, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    // 2s output chunk covering original media [0.3, 3.3) stretched 1.5x.
    player.scheduleChunk(gen, makeBuffer(2), { trimStartSec: 0.3, mediaScale: 1.5, gapSec: 0.2 });
    await ctx.advanceTo(SAFETY + 1);
    const pos = player.getPlaybackPosition(gen);
    expect(pos?.chunkIndex).toBe(0);
    expect(pos?.mediaTimeSec).toBeCloseTo(0.3 + 1 * 1.5, 3);
  });

  test('clamps before the first chunk and in the inter-chunk gap', async () => {
    const { ctx, player, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    player.scheduleChunk(gen, makeBuffer(1), { trimStartSec: 0.2, mediaScale: 1, gapSec: 1 });
    player.scheduleChunk(gen, makeBuffer(1), { trimStartSec: 0.1, mediaScale: 1, gapSec: 1 });
    // Before the first chunk starts.
    expect(player.getPlaybackPosition(gen)?.mediaTimeSec).toBeCloseTo(0.2, 5);
    // Inside the gap after chunk 0 (ends at SAFETY+1; next starts SAFETY+2).
    ctx.currentTime = SAFETY + 1.5;
    const pos = player.getPlaybackPosition(gen);
    expect(pos?.chunkIndex).toBe(0);
    expect(pos?.mediaTimeSec).toBeCloseTo(0.2 + 1, 5);
  });

  test('returns null for a stale generation or empty session', async () => {
    const { player, onEvent } = setup();
    await player.ensureContext();
    const gen = player.startSession(onEvent);
    expect(player.getPlaybackPosition(gen)).toBeNull();
    player.startSession(() => {});
    expect(player.getPlaybackPosition(gen)).toBeNull();
  });
});

describe('WebAudioPlayer buffers', () => {
  test('createMonoBuffer preserves samples and sample rate', async () => {
    const { player } = setup();
    const samples = new Float32Array([0.1, -0.2, 0.3, -0.4]);
    const buffer = await player.createMonoBuffer(samples, 48000);
    expect(buffer.sampleRate).toBe(48000);
    expect(buffer.length).toBe(4);
    expect(Array.from(buffer.getChannelData(0))).toEqual(Array.from(samples));
  });

  test('decode resolves through the context decoder at its sample rate', async () => {
    const ctx = new FakeAudioContext(48000);
    const player = new WebAudioPlayer(() => ctx);
    const buffer = await player.decode(new ArrayBuffer(96000));
    expect(buffer.sampleRate).toBe(48000);
    expect(buffer.duration).toBeCloseTo(2, 5);
  });
});
