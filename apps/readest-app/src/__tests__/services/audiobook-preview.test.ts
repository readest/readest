import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => ({
  addPluginListener: vi.fn(),
  invoke: vi.fn(),
  unregister: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: tauriMocks.addPluginListener,
  convertFileSrc: vi.fn((path: string) => path),
  invoke: tauriMocks.invoke,
}));

import { AudiobookPreviewPlayer } from '@/services/audiobook/preview';
import type { AppService } from '@/types/system';

class FakeAudio {
  static instances: FakeAudio[] = [];
  static playImplementations: Array<() => Promise<void>> = [];
  src = '';
  currentTime = 0;
  play = vi.fn(() => FakeAudio.playImplementations.shift()?.() ?? Promise.resolve());
  pause = vi.fn();
  listeners = new Map<string, Set<() => void>>();

  constructor() {
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
}

const createObjectURL = vi.fn(() => 'blob:audiobook-preview');
const revokeObjectURL = vi.fn();

const makeAppService = (overrides: Partial<AppService> = {}) =>
  ({
    appPlatform: 'web',
    isMobileApp: false,
    openFile: vi.fn(),
    resolveFilePath: vi.fn(),
    ...overrides,
  }) as AppService;

beforeEach(() => {
  vi.useFakeTimers();
  FakeAudio.instances = [];
  FakeAudio.playImplementations = [];
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  tauriMocks.unregister.mockReset();
  tauriMocks.addPluginListener.mockResolvedValue({ unregister: tauriMocks.unregister });
  tauriMocks.invoke.mockImplementation(async (command: string) =>
    command === 'plugin:native-tts|playout_control' ? { session: 1 } : undefined,
  );
  vi.stubGlobal('Audio', FakeAudio);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AudiobookPreviewPlayer', () => {
  it('previews the selected clip and toggles it off without retaining a blob URL', async () => {
    const onStopped = vi.fn();
    const player = new AudiobookPreviewPlayer(makeAppService(), onStopped);
    const file = new File(['audio'], 'book.m4b', { type: 'audio/mp4' });

    expect(await player.toggle({ id: 'audio-0:1', file, start: 12, end: 42 })).toBe(true);
    const audio = FakeAudio.instances[0]!;
    expect(audio.src).toBe('blob:audiobook-preview');
    expect(audio.currentTime).toBe(12);
    expect(audio.play).toHaveBeenCalledOnce();

    expect(await player.toggle({ id: 'audio-0:1', file, start: 12, end: 42 })).toBe(false);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:audiobook-preview');
    expect(onStopped).toHaveBeenCalledWith('audio-0:1');
  });

  it('stops at the end of a short chapter preview and closes files it opened', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const opened = Object.assign(new File(['audio'], 'stored.m4b'), { close });
    const appService = makeAppService({
      openFile: vi.fn().mockResolvedValue(opened),
    });
    const onStopped = vi.fn();
    const player = new AudiobookPreviewPlayer(appService, onStopped);

    await player.toggle({
      id: 'audio-0:0',
      path: 'hash/audiobook/stored.m4b',
      base: 'Books',
      start: 5,
      end: 7,
    });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(FakeAudio.instances[0]!.pause).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(onStopped).toHaveBeenCalledWith('audio-0:0');
  });

  it('serializes rapid preview switches so a stale request cannot stop the latest clip', async () => {
    let resolveFirstPlay!: () => void;
    FakeAudio.playImplementations = [
      () =>
        new Promise<void>((resolve) => {
          resolveFirstPlay = resolve;
        }),
      () => Promise.resolve(),
    ];
    const onStopped = vi.fn();
    const player = new AudiobookPreviewPlayer(makeAppService(), onStopped);
    const file = new File(['audio'], 'book.m4b', { type: 'audio/mp4' });

    const first = player.toggle({ id: 'first', file, start: 0, end: 1 });
    for (let index = 0; index < 10 && !resolveFirstPlay; index += 1) await Promise.resolve();
    const second = player.toggle({ id: 'second', file, start: 10, end: 25 });
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    const instancesBeforeFirstResolved = FakeAudio.instances.length;

    resolveFirstPlay();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(instancesBeforeFirstResolved).toBe(1);
    expect(FakeAudio.instances).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeAudio.instances[1]!.pause).not.toHaveBeenCalled();
    expect(onStopped).not.toHaveBeenCalledWith('second');
  });

  it('streams a remote clip URL straight into the element', async () => {
    const appService = makeAppService();
    const player = new AudiobookPreviewPlayer(appService, vi.fn());

    await player.toggle({ id: 'abs:0', url: 'http://abs/track?token=t', start: 7, end: 40 });

    const audio = FakeAudio.instances[0]!;
    expect(audio.src).toBe('http://abs/track?token=t');
    expect(audio.currentTime).toBe(7);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(appService.openFile).not.toHaveBeenCalled();
    expect(appService.resolveFilePath).not.toHaveBeenCalled();
  });

  it('hands a remote clip URL to the native player on mobile', async () => {
    const appService = makeAppService({ appPlatform: 'tauri', isMobileApp: true });
    const player = new AudiobookPreviewPlayer(appService, vi.fn());

    await player.toggle({ id: 'abs:0', url: 'http://abs/track?token=t', start: 7, end: 40 });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('plugin:native-tts|playout_control', {
      payload: { action: 'load', path: 'http://abs/track?token=t', positionMs: 7000 },
    });
    expect(appService.resolveFilePath).not.toHaveBeenCalled();
  });

  it('unregisters the native playback listener when a mobile preview stops', async () => {
    const appService = makeAppService({
      appPlatform: 'tauri',
      isMobileApp: true,
      resolveFilePath: vi.fn().mockResolvedValue('/books/book.m4b'),
    });
    const player = new AudiobookPreviewPlayer(appService, vi.fn());

    await player.toggle({ id: 'chapter-1', path: 'book.m4b', start: 0, end: 30 });
    await player.stop();

    expect(tauriMocks.unregister).toHaveBeenCalledOnce();
  });
});
