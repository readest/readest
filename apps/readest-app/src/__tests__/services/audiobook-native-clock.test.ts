import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn(),
}));

import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import { NativeAudiobookClock } from '@/services/audiobook/NativeAudiobookClock';

describe('NativeAudiobookClock', () => {
  let playoutEvents: ((payload: unknown) => void) | null;
  let controlCalls: Array<Record<string, unknown>>;
  let position: { session: number; index: number; positionMs: number; playing: boolean };
  let unregister: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    playoutEvents = null;
    controlCalls = [];
    unregister = vi.fn();
    position = { session: 5, index: 0, positionMs: 0, playing: true };
    vi.mocked(addPluginListener).mockImplementation((async (
      _plugin: string,
      event: string,
      cb: (payload: unknown) => void,
    ) => {
      if (event === 'playout_events') playoutEvents = cb;
      return { unregister } as unknown as PluginListener;
    }) as unknown as typeof addPluginListener);
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      const payload = (args as { payload?: Record<string, unknown> })?.payload ?? {};
      if (cmd === 'plugin:native-tts|playout_control') {
        controlCalls.push(payload);
        if (payload['action'] === 'start-session') return { session: 5 } as unknown;
        return { session: null } as unknown;
      }
      if (cmd === 'plugin:native-tts|playout_position') {
        return position as unknown;
      }
      return undefined as unknown;
    });
  });

  test('load() passes the remote URL straight through as the path, no staging', async () => {
    const clock = new NativeAudiobookClock();
    await clock.load('https://abs.example/api/items/1/file/1?token=t', 12.5);

    expect(controlCalls.some((c) => c['action'] === 'start-session')).toBe(true);
    const load = controlCalls.find((c) => c['action'] === 'load');
    expect(load?.['path']).toBe('https://abs.example/api/items/1/file/1?token=t');
    expect(load?.['positionMs']).toBe(12500);
    expect(clock.currentTime).toBe(12.5);
  });

  test('load() resolves once the plugin accepts it, not once it starts buffering', async () => {
    const clock = new NativeAudiobookClock();
    // The mocked invoke resolves synchronously (no separate "ready" event is
    // awaited), which is exactly the "seekable on load-resolve" contract
    // AudiobookController relies on.
    await expect(clock.load('https://abs.example/f/1', 0)).resolves.toBeUndefined();
  });

  test('play/pause/seek/setRate issue the matching playout_control actions', async () => {
    const clock = new NativeAudiobookClock();
    await clock.load('https://abs.example/f/1', 0);

    await clock.play();
    expect(controlCalls.some((c) => c['action'] === 'resume')).toBe(true);
    expect(clock.paused).toBe(false);

    await clock.seek(30);
    expect(controlCalls.some((c) => c['action'] === 'seek' && c['positionMs'] === 30000)).toBe(
      true,
    );
    // Extrapolated against wall-clock while playing (mirrors
    // NativeNarrationPlayer), so a few microseconds may have ticked by.
    expect(clock.currentTime).toBeCloseTo(30, 2);

    clock.playbackRate = 1.5;
    await vi.waitFor(() =>
      expect(controlCalls.some((c) => c['action'] === 'set-rate' && c['rate'] === 1.5)).toBe(true),
    );

    clock.pause();
    expect(controlCalls.some((c) => c['action'] === 'pause')).toBe(true);
    expect(clock.paused).toBe(true);
  });

  // Regression: page.tsx's handleSelectEpisode carries a previous episode's
  // rate onto a freshly claimed, not-yet-started controller via
  // controller.setRate() - before AudiobookController#start() ever calls
  // load(). At that point #nativeSession is still null, so setRate() could
  // only update the local #rate mirror and skipped the native invoke
  // entirely (its early return), silently leaving the AVPlayer at 1x while
  // #rate and the UI both reported the carried rate.
  test('setRate before load() replays the rate once the native session is established', async () => {
    const clock = new NativeAudiobookClock();

    await clock.setRate(1.5);
    expect(controlCalls.some((c) => c['action'] === 'set-rate')).toBe(false);

    await clock.load('https://abs.example/f/1', 0);

    expect(
      controlCalls.filter((c) => c['action'] === 'set-rate' && c['rate'] === 1.5),
    ).toHaveLength(1);
  });

  test('currentTime setter issues a native seek', async () => {
    const clock = new NativeAudiobookClock();
    await clock.load('https://abs.example/f/1', 0);

    clock.currentTime = 45;
    await vi.waitFor(() =>
      expect(controlCalls.some((c) => c['action'] === 'seek' && c['positionMs'] === 45000)).toBe(
        true,
      ),
    );
  });

  test('ended and error native events surface to the matching listeners', async () => {
    const clock = new NativeAudiobookClock();
    await clock.load('https://abs.example/f/1', 0);

    const ended = vi.fn();
    const error = vi.fn();
    clock.addEventListener('ended', ended);
    clock.addEventListener('error', error);

    playoutEvents!({ type: 'ended', session: 5, index: 0 });
    expect(ended).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();

    playoutEvents!({ type: 'error', session: 5, index: 0 });
    expect(error).toHaveBeenCalledOnce();
  });

  // Single error signaling: a load() that the plugin itself rejects must only
  // reject the load() promise. It must never also drive the 'error'
  // listeners for the same failure - AudiobookController has no
  // re-entrancy guard and would otherwise both #finish (from the rejection)
  // and toast+retry (from the event) for one underlying failure.
  test('a rejected load() never also fires the error listeners', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      const payload = (args as { payload?: Record<string, unknown> })?.payload ?? {};
      if (cmd === 'plugin:native-tts|playout_control') {
        if (payload['action'] === 'start-session') return { session: 5 } as unknown;
        if (payload['action'] === 'load') throw new Error('invalid URL');
        return { session: null } as unknown;
      }
      return undefined as unknown;
    });

    const clock = new NativeAudiobookClock();
    const error = vi.fn();
    clock.addEventListener('error', error);

    await expect(clock.load('not a url', 0)).rejects.toThrow('invalid URL');
    expect(error).not.toHaveBeenCalled();
  });

  test('removeEventListener stops further delivery', async () => {
    const clock = new NativeAudiobookClock();
    await clock.load('https://abs.example/f/1', 0);

    const ended = vi.fn();
    clock.addEventListener('ended', ended);
    clock.removeEventListener('ended', ended);

    playoutEvents!({ type: 'ended', session: 5, index: 0 });
    expect(ended).not.toHaveBeenCalled();
  });

  test('extrapolates currentTime between polls using playbackRate', async () => {
    vi.useFakeTimers();
    try {
      const clock = new NativeAudiobookClock();
      await clock.load('https://abs.example/f/1', 0);
      clock.playbackRate = 2;
      await clock.play();

      position = { session: 5, index: 0, positionMs: 10_000, playing: true };
      await vi.advanceTimersByTimeAsync(250); // first poll lands: mediaSec = 10

      vi.advanceTimersByTime(500); // half a second of wall-clock elapses, no new poll
      // 10s base + 0.5s wall-clock * 2x rate = 11s
      expect(clock.currentTime).toBeCloseTo(11, 5);
    } finally {
      vi.useRealTimers();
    }
  });

  test('polls the native clock only while playback is active', async () => {
    vi.useFakeTimers();
    try {
      const clock = new NativeAudiobookClock();
      await clock.load('https://abs.example/f/1', 0);

      await vi.advanceTimersByTimeAsync(1_000);
      const positionCalls = () =>
        vi
          .mocked(invoke)
          .mock.calls.filter(([command]) => command === 'plugin:native-tts|playout_position')
          .length;
      expect(positionCalls()).toBe(0);

      await clock.play();
      await vi.advanceTimersByTimeAsync(250);
      expect(positionCalls()).toBe(1);

      clock.pause();
      const pausedCalls = positionCalls();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(positionCalls()).toBe(pausedCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  test('destroy() clears the poll interval and unregisters the native listener', async () => {
    vi.useFakeTimers();
    try {
      const clock = new NativeAudiobookClock();
      await clock.load('https://abs.example/f/1', 0);
      await clock.play();
      await vi.advanceTimersByTimeAsync(250);
      const callsBeforeDestroy = vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === 'plugin:native-tts|playout_position').length;
      expect(callsBeforeDestroy).toBeGreaterThan(0);

      clock.destroy();
      expect(controlCalls.some((c) => c['action'] === 'abort')).toBe(true);
      await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());

      await vi.advanceTimersByTimeAsync(2_000);
      const callsAfterDestroy = vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === 'plugin:native-tts|playout_position').length;
      expect(callsAfterDestroy).toBe(callsBeforeDestroy);
    } finally {
      vi.useRealTimers();
    }
  });

  test('freezes the clock when the native player reports no current item', async () => {
    const clock = new NativeAudiobookClock();
    await clock.load('https://abs.example/f/1', 0);
    await clock.play();
    expect(clock.paused).toBe(false);

    position = { session: 5, index: -1, positionMs: 0, playing: false };
    await vi.waitFor(() => expect(clock.paused).toBe(true));
  });
});
