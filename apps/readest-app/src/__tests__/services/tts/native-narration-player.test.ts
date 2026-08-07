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

  beforeEach(() => {
    vi.clearAllMocks();
    playoutEvents = null;
    controlCalls = [];
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
        return { session: 3, index: 0, positionMs: 1500, playing: true } as unknown;
      }
      return undefined as unknown;
    });
  });

  test('stages the blob once and loads via playout control', async () => {
    const player = new NativeNarrationPlayer();
    await player.load('Audio/ch1.mp4', new Blob([new Uint8Array(4)]), 12.5);

    expect(writeFile).toHaveBeenCalledOnce();
    expect(controlCalls.some((c) => c.action === 'start-session')).toBe(true);
    const load = controlCalls.find((c) => c.action === 'load');
    expect(load?.path).toMatch(/mo-narration-.*\.mp4$/);
    expect(load?.positionMs).toBe(12500);

    await player.play();
    expect(controlCalls.some((c) => c.action === 'resume')).toBe(true);

    player.pause();
    expect(controlCalls.some((c) => c.action === 'pause')).toBe(true);

    await player.seek(30);
    expect(controlCalls.some((c) => c.action === 'seek' && c.positionMs === 30000)).toBe(true);

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

  test('invalidateSession forces a fresh native session on next load', async () => {
    const player = new NativeNarrationPlayer();
    await player.load('ch1.mp3', new Blob([new Uint8Array(4)]), 0);
    const sessionsBefore = controlCalls.filter((c) => c.action === 'start-session').length;
    expect(sessionsBefore).toBe(1);

    player.invalidateSession();
    await player.load('ch1.mp3', new Blob([new Uint8Array(4)]), 0);
    expect(controlCalls.filter((c) => c.action === 'start-session').length).toBe(2);
    await player.shutdown();
  });
});
