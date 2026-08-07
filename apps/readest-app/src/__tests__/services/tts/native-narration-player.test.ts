import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  tempDir: vi.fn(async () => '/tmp'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { Temp: 1 },
  writeFile: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));

import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import { writeFile } from '@tauri-apps/plugin-fs';
import { NativeNarrationPlayer } from '@/services/tts/mediaOverlay/NativeNarrationPlayer';

describe('NativeNarrationPlayer', () => {
  let playoutEvents: ((payload: unknown) => void) | null;
  let controlCalls: Array<Record<string, unknown>>;
  let position: { session: number; index: number; positionMs: number; playing: boolean };

  beforeEach(() => {
    vi.clearAllMocks();
    playoutEvents = null;
    controlCalls = [];
    position = { session: 3, index: 0, positionMs: 1500, playing: true };
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
        controlCalls.push(payload);
        if (payload['action'] === 'start-session') return { session: 3 } as unknown;
        return { session: null } as unknown;
      }
      if (cmd === 'plugin:native-tts|playout_position') {
        return position as unknown;
      }
      return undefined as unknown;
    });
  });

  test('stages the blob once and loads via playout control', async () => {
    const player = new NativeNarrationPlayer();
    await player.load('Audio/ch1.mp4', new Blob([new Uint8Array(4)]), 12.5);

    expect(writeFile).toHaveBeenCalledOnce();
    expect(controlCalls.some((c) => c['action'] === 'start-session')).toBe(true);
    const load = controlCalls.find((c) => c['action'] === 'load');
    expect(load?.['path']).toMatch(/mo-narration-.*\.mp4$/);
    expect(load?.['positionMs']).toBe(12500);

    await player.play();
    expect(controlCalls.some((c) => c['action'] === 'resume')).toBe(true);

    player.pause();
    expect(controlCalls.some((c) => c['action'] === 'pause')).toBe(true);

    await player.seek(30);
    expect(controlCalls.some((c) => c['action'] === 'seek' && c['positionMs'] === 30000)).toBe(
      true,
    );

    await player.shutdown();
  });

  test('ended events notify listeners', async () => {
    const player = new NativeNarrationPlayer();
    await player.ensureReady();
    const ended = vi.fn();
    player.addEventListener('ended', ended);
    playoutEvents!({ type: 'ended', session: 3, index: 0 });
    expect(ended).toHaveBeenCalledOnce();
    await player.shutdown();
  });

  // Without this the JS side has no failure channel at all: a native load that
  // never produces audio would leave speak() waiting on a clock that is never
  // going to move, with no error yielded and no auto-advance.
  test('native error events surface to error listeners', async () => {
    const player = new NativeNarrationPlayer();
    await player.ensureReady();
    const onError = vi.fn();
    player.addEventListener('error', onError);
    playoutEvents!({ type: 'error', session: 3, index: 0 });
    expect(onError).toHaveBeenCalledOnce();
    expect(player.paused).toBe(true);
    await player.shutdown();
  });

  test('freezes the clock when the native player reports no current item', async () => {
    const player = new NativeNarrationPlayer();
    await player.load('ch1.mp3', new Blob([new Uint8Array(4)]), 0);
    await player.play();
    expect(player.paused).toBe(false);

    position = { session: 3, index: -1, positionMs: 0, playing: false };
    await vi.waitFor(() => expect(player.paused).toBe(true));
    await player.shutdown();
  });

  test('invalidateSession forces a fresh native session on next load', async () => {
    const player = new NativeNarrationPlayer();
    await player.load('ch1.mp3', new Blob([new Uint8Array(4)]), 0);
    const sessionsBefore = controlCalls.filter((c) => c['action'] === 'start-session').length;
    expect(sessionsBefore).toBe(1);

    player.invalidateSession();
    await player.load('ch1.mp3', new Blob([new Uint8Array(4)]), 0);
    expect(controlCalls.filter((c) => c['action'] === 'start-session').length).toBe(2);
    await player.shutdown();
  });
});
