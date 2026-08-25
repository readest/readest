import { describe, expect, test, vi } from 'vitest';

import {
  MultiTrackNarrationClock,
  type NarrationTrack,
  type NarrationTrackPlayer,
} from '@/services/tts/mediaOverlay/MultiTrackNarrationClock';

// A per-track player the composite drives: records loads/seeks/rates and lets
// the test fire the events a real element or native player would.
class FakeTrackPlayer implements NarrationTrackPlayer {
  loads: Array<{ url: string; startAt: number }> = [];
  seeks: number[] = [];
  rates: number[] = [];
  playCalls = 0;
  paused = true;
  currentTime = 0;
  playbackRate = 1;
  destroyed = false;
  // Resolved by the test when set, so a load can be held open.
  loadGate: Promise<void> | null = null;
  #listeners = new Map<string, Set<() => void>>();

  async load(url: string, startAt: number): Promise<void> {
    if (this.loadGate) await this.loadGate;
    this.loads.push({ url, startAt });
    this.currentTime = startAt;
    this.paused = true;
  }
  async play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
  async seek(seconds: number): Promise<void> {
    this.seeks.push(seconds);
    this.currentTime = seconds;
  }
  async setRate(rate: number): Promise<void> {
    this.rates.push(rate);
    this.playbackRate = rate;
  }
  addEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type)!.add(fn);
  }
  removeEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void {
    this.#listeners.get(type)?.delete(fn);
  }
  destroy(): void {
    this.destroyed = true;
  }
  emit(type: 'ended' | 'error' | 'timeupdate'): void {
    for (const fn of [...(this.#listeners.get(type) ?? [])]) fn();
  }
}

const TRACKS: NarrationTrack[] = [
  { url: 'http://abs/t2', startOffset: 100, duration: 50 },
  { url: 'http://abs/t1', startOffset: 0, duration: 100 },
];

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const setup = () => {
  const player = new FakeTrackPlayer();
  const clock = new MultiTrackNarrationClock(TRACKS, player);
  return { player, clock };
};

describe('MultiTrackNarrationClock', () => {
  test('seeking loads the track holding the global position at its in-track offset', async () => {
    const { player, clock } = setup();

    await clock.seek(120);

    expect(player.loads).toEqual([{ url: 'http://abs/t2', startAt: 20 }]);
    player.currentTime = 25;
    expect(clock.currentTime).toBe(125);
    expect(clock.duration).toBe(150);
  });

  test('seeks within the loaded track without reloading it', async () => {
    const { player, clock } = setup();
    await clock.seek(120);

    await clock.seek(130);

    expect(player.loads).toHaveLength(1);
    expect(player.seeks).toEqual([30]);
    expect(clock.currentTime).toBe(130);
  });

  test('assigning currentTime seeks like a media element', async () => {
    const { player, clock } = setup();

    clock.currentTime = 42;
    await flush();

    expect(player.loads).toEqual([{ url: 'http://abs/t1', startAt: 42 }]);
  });

  test('playing with nothing loaded starts from the first track', async () => {
    const { player, clock } = setup();

    await clock.play();

    expect(player.loads).toEqual([{ url: 'http://abs/t1', startAt: 0 }]);
    expect(player.playCalls).toBe(1);
    expect(clock.paused).toBe(false);
  });

  test('rolls into the next track when one ends, without reporting ended', async () => {
    const { player, clock } = setup();
    const ended = vi.fn();
    clock.addEventListener('ended', ended);
    await clock.seek(90);
    await clock.play();

    player.emit('ended');
    await flush();

    expect(player.loads.at(-1)).toEqual({ url: 'http://abs/t2', startAt: 0 });
    expect(player.playCalls).toBe(2);
    expect(ended).not.toHaveBeenCalled();
    expect(clock.paused).toBe(false);
    expect(clock.currentTime).toBe(100);
  });

  test('reports ended only when the last track runs out', async () => {
    const { player, clock } = setup();
    const ended = vi.fn();
    clock.addEventListener('ended', ended);
    await clock.seek(120);
    await clock.play();

    player.emit('ended');
    await flush();

    expect(ended).toHaveBeenCalledTimes(1);
    expect(player.loads).toHaveLength(1);
    expect(clock.paused).toBe(true);
  });

  test('relays errors and time updates from the track player', async () => {
    const { player, clock } = setup();
    const error = vi.fn();
    const timeupdate = vi.fn();
    clock.addEventListener('error', error);
    clock.addEventListener('timeupdate', timeupdate);

    player.emit('error');
    player.emit('timeupdate');
    clock.removeEventListener('timeupdate', timeupdate);
    player.emit('timeupdate');

    expect(error).toHaveBeenCalledTimes(1);
    expect(timeupdate).toHaveBeenCalledTimes(1);
  });

  test('applies the rate set before any load to each track it loads', async () => {
    const { player, clock } = setup();

    await clock.setRate(1.5);
    await clock.seek(10);
    await clock.seek(120);

    expect(clock.playbackRate).toBe(1.5);
    expect(player.rates.filter((rate) => rate === 1.5).length).toBeGreaterThanOrEqual(2);
    expect(player.playbackRate).toBe(1.5);
  });

  test('reports the requested position while its track is still loading', async () => {
    const { player, clock } = setup();
    let open!: () => void;
    player.loadGate = new Promise<void>((resolve) => {
      open = resolve;
    });

    const seeking = clock.seek(120);
    expect(clock.currentTime).toBe(120);

    open();
    await seeking;
    expect(clock.currentTime).toBe(120);
  });

  test('a pause during a pending load leaves the new track paused', async () => {
    const { player, clock } = setup();
    await clock.play();
    let open!: () => void;
    player.loadGate = new Promise<void>((resolve) => {
      open = resolve;
    });

    const seeking = clock.seek(120);
    clock.pause();
    open();
    await seeking;

    expect(player.playCalls).toBe(1);
    expect(clock.paused).toBe(true);
  });

  test('a same-track seek during a pending load lands after the load settles', async () => {
    const { player, clock } = setup();
    // Start a cross-track load and hold it open.
    let open!: () => void;
    player.loadGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const loading = clock.seek(120); // -> t2, in-track offset 20

    // Scrub again within the SAME track while the load is still in flight.
    const reseek = clock.seek(140); // -> t2, in-track offset 40
    open();
    await Promise.all([loading, reseek]);

    // The load set the playhead to 20; the seek must win, not be overwritten.
    expect(player.currentTime).toBe(40);
    expect(clock.currentTime).toBe(140);
  });

  test('a load superseded by a later seek never starts playing', async () => {
    const { player, clock } = setup();
    await clock.play();
    let open!: () => void;
    player.loadGate = new Promise<void>((resolve) => {
      open = resolve;
    });

    const stale = clock.seek(120);
    const fresh = clock.seek(10);
    open();
    await Promise.all([stale, fresh]);

    expect(player.loads.at(-1)).toEqual({ url: 'http://abs/t1', startAt: 10 });
    expect(player.playCalls).toBe(2);
  });

  test('clamps positions past the end to the final track', async () => {
    const { player, clock } = setup();

    await clock.seek(10_000);

    expect(player.loads).toEqual([{ url: 'http://abs/t2', startAt: 50 }]);
  });

  test('destroy silences and releases the track player', async () => {
    const { player, clock } = setup();
    await clock.play();

    clock.destroy();

    expect(player.paused).toBe(true);
    expect(player.destroyed).toBe(true);
    expect(clock.paused).toBe(true);
  });
});
