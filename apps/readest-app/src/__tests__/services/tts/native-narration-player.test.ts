import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appCacheDir: vi.fn(async () => '/data/user/0/com.bilingify.readest/cache'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { Temp: 1, AppCache: 2 },
  writeFile: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));

import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import { BaseDirectory, remove, writeFile } from '@tauri-apps/plugin-fs';
import { NativeNarrationPlayer } from '@/services/tts/mediaOverlay/NativeNarrationPlayer';

describe('NativeNarrationPlayer', () => {
  let playoutEvents: ((payload: unknown) => void) | null;
  let controlCalls: Array<Record<string, unknown>>;
  let position: { session: number; index: number; positionMs: number; playing: boolean };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeFile).mockResolvedValue(undefined);
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

  test('stages the next file without changing the live session, then adopts it without writing again', async () => {
    const player = new NativeNarrationPlayer();
    const blob = new Blob([new Uint8Array(4)]);
    await player.load('ch1.mp4', blob);
    await player.play();
    const controls = controlCalls.length;
    const loadBlob = vi.fn(async () => blob);
    await player.preload('ch2.mp4', loadBlob);
    await player.preload('ch3.mp4', loadBlob);
    expect(controlCalls).toHaveLength(controls);
    expect(player.href).toBe('ch1.mp4');
    expect(player.paused).toBe(false);
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(loadBlob).toHaveBeenCalledOnce();

    expect(await player.loadPrepared('ch2.mp4', 4)).toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(controlCalls.at(-1)).toMatchObject({ action: 'load', positionMs: 4000 });
    expect(remove).toHaveBeenCalledTimes(1);
    await player.shutdown();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  test('queues an extracted native file without copying it through the WebView', async () => {
    const player = new NativeNarrationPlayer();
    await player.loadPath('current.mp4', '/cache/current.mp4');
    await player.preload('next.mp4', async () => '/cache/extracted-next.mp4');
    await player.queuePrepared(21, 0, 60);
    expect(controlCalls.at(-1)).toMatchObject({
      action: 'queue-next',
      path: '/cache/extracted-next.mp4',
    });
    expect(await player.loadPrepared('next.mp4')).toBe(true);
    await player.shutdown();
    expect(writeFile).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  test('shutdown removes a preparation that finishes after release', async () => {
    const player = new NativeNarrationPlayer();
    let complete!: (blob: Blob) => void;
    const preparation = player.preload(
      'next.mp4',
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await player.shutdown();
    complete(new Blob([new Uint8Array(4)]));
    await preparation;
    expect(remove).toHaveBeenCalledOnce();
    expect(await player.loadPrepared('next.mp4')).toBe(false);
    expect(controlCalls.some((call) => call['action'] === 'load')).toBe(false);
  });

  test('a failed speculative extraction can be retried', async () => {
    const player = new NativeNarrationPlayer();
    await player.preload('next.mp4', async () => {
      throw new Error('read failed');
    });
    await player.preload('next.mp4', async () => new Blob([new Uint8Array(4)]));
    expect(await player.loadPrepared('next.mp4')).toBe(true);
    await player.shutdown();
  });

  test('stages current and upcoming recordings with bounded bridge writes', async () => {
    const bytes = Uint8Array.from({ length: 1024 * 1024 + 17 }, (_, i) => i % 251);
    const blob = new Blob([bytes]);
    // Reading the entire recording creates another large allocation before IPC.
    vi.spyOn(blob, 'arrayBuffer').mockRejectedValue(new Error('whole-file allocation'));
    const written: Uint8Array[] = [];
    vi.mocked(writeFile).mockImplementation(async (_path, data) => {
      expect(data).toBeInstanceOf(ReadableStream);
      const reader = (data as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        expect(value.byteLength).toBeLessThanOrEqual(256 * 1024);
        chunks.push(value);
      }
      const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      written.push(result);
    });
    const player = new NativeNarrationPlayer();
    try {
      await player.load('current.mp4', blob);
      await player.preload('next.mp4', async () => blob);
      expect(written).toHaveLength(2);
      for (const result of written) {
        expect(result.byteLength).toBe(bytes.byteLength);
        expect(result.every((byte, index) => byte === bytes[index])).toBe(true);
      }
    } finally {
      await player.shutdown();
    }
  });

  test('stages embedded narration in the app cache', async () => {
    // Android 10 resolves Temp to /data/local/tmp, which ordinary apps cannot write.
    vi.mocked(writeFile).mockImplementation(async (_path, _bytes, options) => {
      if (options?.baseDir === BaseDirectory.Temp) {
        throw new Error('Permission denied (os error 13)');
      }
    });
    const player = new NativeNarrationPlayer();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const blob = new Blob([bytes]);
    const directory = '/data/user/0/com.bilingify.readest/cache';
    try {
      await player.load('Audio/ch1.mp4', blob);
      const name = vi.mocked(writeFile).mock.calls[0]![0];
      expect(writeFile).toHaveBeenCalledWith(name, expect.any(ReadableStream), {
        baseDir: BaseDirectory.AppCache,
      });
      expect(controlCalls.find((call) => call['action'] === 'load')?.['path']).toBe(
        `${directory}/${name}`,
      );

      await player.load('Audio/ch1.mp4', blob, 10);
      expect(writeFile).toHaveBeenCalledOnce();
    } finally {
      await player.shutdown();
    }
    expect(remove).toHaveBeenCalledWith(`${directory}/${vi.mocked(writeFile).mock.calls[0]![0]}`);
  });

  test('loads an existing local audiobook path without copying or deleting it', async () => {
    const player = new NativeNarrationPlayer();
    await player.loadPath('hash/audiobook/book.m4b', '/books/hash/audiobook/book.m4b', 20);

    expect(writeFile).not.toHaveBeenCalled();
    expect(controlCalls.find((call) => call['action'] === 'load')).toMatchObject({
      path: '/books/hash/audiobook/book.m4b',
      positionMs: 20_000,
    });

    await player.shutdown();
    expect(remove).not.toHaveBeenCalledWith('/books/hash/audiobook/book.m4b');
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

  test('polls the native clock only while playback is active', async () => {
    vi.useFakeTimers();
    try {
      const player = new NativeNarrationPlayer();
      await player.loadPath('hash/audiobook/book.m4b', '/books/hash/audiobook/book.m4b', 0);

      await vi.advanceTimersByTimeAsync(1_000);
      const positionCalls = () =>
        vi
          .mocked(invoke)
          .mock.calls.filter(([command]) => command === 'plugin:native-tts|playout_position')
          .length;
      expect(positionCalls()).toBe(0);

      await player.play();
      await vi.advanceTimersByTimeAsync(250);
      expect(positionCalls()).toBe(1);

      player.pause();
      const pausedCalls = positionCalls();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(positionCalls()).toBe(pausedCalls);
      await player.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });
});
