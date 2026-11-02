import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The iOS Tauri branch of MediaOverlayClient: narration plays through the
// shared native playout AVPlayer instead of an HTMLAudioElement, because
// WebKit media elements lose the app's non-mixable .playback session.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appCacheDir: vi.fn(async () => '/cache'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { Temp: 1, AppCache: 2 },
  writeFile: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));

const platform = vi.hoisted(() => ({ os: 'ios' }));

vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getOSPlatform: () => platform.os,
}));

import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { BookDoc, BookMediaSource } from '@/libs/document';
import type { TTSController } from '@/services/tts/TTSController';
import type { AppService } from '@/types/system';
import {
  loadMediaOverlaySection,
  type MediaOverlaySection,
} from '@/services/tts/mediaOverlay/MediaOverlaySection';
import { MediaOverlayClient } from '@/services/tts/mediaOverlay/MediaOverlayClient';
import { NativeNarrationPlayer } from '@/services/tts/mediaOverlay/NativeNarrationPlayer';

const par = (id: string, begin: number, end: number) =>
  `<par><text src="ch1.xhtml#${id}"/><audio src="ch1.mp4" clipBegin="${begin}s" clipEnd="${end}s"/></par>`;

const SMIL = par('w1', 0, 1) + par('w2', 1, 2) + par('w3', 2, 3);
const HTML =
  '<p id="p1"><span id="w1">Alpha</span> <span id="w2">beta</span> <span id="w3">gamma</span></p>';

// Any HTMLAudioElement construction on this path is a bug: it is the element
// whose interruption the native player exists to avoid.
class ForbiddenAudio {
  constructor() {
    throw new Error('MediaOverlayClient built an HTMLAudioElement on the native path');
  }
}

let controlCalls: Array<Record<string, unknown>>;
let playoutEvents: ((payload: unknown) => void) | null;
let client: MediaOverlayClient;
let section: MediaOverlaySection;

const WINDOW = { path: '/books/hash/book.epub', start: 64, end: 72 };

let book: BookDoc;

const setup = async (
  media: BookMediaSource | null = WINDOW,
  app = { isIOSApp: true } as AppService,
) => {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html lang="en"><body>${HTML}</body></html>`,
    'text/html',
  );
  book = {
    sections: [{ mediaOverlay: { href: 'OEBPS/ch1.smil', id: 'smil1' } }],
    loadText: async () => `<smil xmlns="http://www.w3.org/ns/SMIL"><body>${SMIL}</body></smil>`,
    loadBlob: vi.fn(async () => new Blob([new Uint8Array(8)])),
    getMediaSource: vi.fn(async () => media),
    media: { narrator: 'Jane Reader' },
  } as unknown as BookDoc;
  section = (await loadMediaOverlaySection(book, 0, doc, 'en'))!;
  client = new MediaOverlayClient({ dispatchSpeakMark: vi.fn() } as unknown as TTSController, app);
  await client.init();
  client.attachBook(book);
  client.setSection(section);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
  vi.stubGlobal('Audio', ForbiddenAudio);
  controlCalls = [];
  playoutEvents = null;
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
      if (payload['action'] === 'start-session') return { session: 7 } as unknown;
      return { session: null } as unknown;
    }
    if (cmd === 'plugin:native-tts|playout_position') {
      return { session: 7, index: 0, positionMs: 0, playing: true } as unknown;
    }
    return undefined as unknown;
  });
});

afterEach(async () => {
  await client?.shutdown();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  platform.os = 'ios';
});

describe('NativeNarrationPlayer source selection', () => {
  test('opens a compressed local source without staging it', async () => {
    const player = new NativeNarrationPlayer({ isLinuxApp: true } as AppService);
    const loadBlob = vi.fn(async () => new Blob([new Uint8Array(8)]));
    try {
      expect(
        await player.loadSource(
          'chapter.m4a',
          {
            loadBlob,
            getMediaSource: async () => ({ path: '/books/book.epub', entry: 'audio/chapter.m4a' }),
          },
          'audio/mp4',
        ),
      ).toBe(true);
      expect(controlCalls.find((call) => call['action'] === 'load')).toMatchObject({
        path: '/books/book.epub',
        entry: 'audio/chapter.m4a',
        contentType: 'audio/mp4',
      });
      expect(loadBlob).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    } finally {
      await player.shutdown();
    }
  });

  test.each([
    'chapter.mp3',
    'chapter.opus',
    'chapter.webm',
  ])('declines %s before resolving its source', async (href) => {
    const player = new NativeNarrationPlayer({ isLinuxApp: true } as AppService);
    const loadBlob = vi.fn(async () => new Blob());
    const resolvePath = vi.fn(async () => `/books/${href}`);
    expect(await player.loadSource(href, { loadBlob, resolvePath }, 'audio/mpeg')).toBe(false);
    expect(resolvePath).not.toHaveBeenCalled();
    expect(loadBlob).not.toHaveBeenCalled();
    expect(controlCalls).toEqual([]);
  });
});

describe('MediaOverlayClient on Linux Tauri', () => {
  const linux = { isLinuxApp: true } as AppService;
  const entry = { path: '/books/hash/book.epub', entry: 'OEBPS/Chapter 1 #é.m4a' };

  test.each([
    WINDOW,
    entry,
  ])('plays local EPUB audio directly through native playout: %j', async (media) => {
    await setup(media as BookMediaSource, linux);
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);

    expect((await iter.next()).value?.code).toBe('boundary');
    expect(controlCalls.find((call) => call['action'] === 'load')).toMatchObject({
      ...media,
      contentType: 'audio/mp4',
    });
    expect(book.loadBlob).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(addPluginListener).toHaveBeenCalledWith(
      'native-tts',
      'playout_events',
      expect.any(Function),
    );
  });

  test.each([
    WINDOW,
    entry,
  ])('surfaces native load failures without extracting local audio: %j', async (media) => {
    await setup(media as BookMediaSource, linux);
    const control = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      const payload = (args as { payload?: Record<string, unknown> })?.payload;
      if (cmd === 'plugin:native-tts|playout_control' && payload?.['action'] === 'load') {
        throw new Error('Native narration codec unavailable');
      }
      return control(cmd, args as Parameters<typeof invoke>[1]);
    });
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);

    expect((await iter.next()).value).toMatchObject({
      code: 'error',
      message: 'Native narration codec unavailable',
    });
    expect(book.loadBlob).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('plays a paired local recording from its original path', async () => {
    await setup(null, linux);
    const loadBlob = vi.fn(async () => new Blob([new Uint8Array(8)]));
    const resolveUrl = vi.fn(async () => 'http://asset.localhost/audio.m4b');
    client.attachSource({
      loadBlob,
      resolveUrl,
      resolvePath: async () => '/books/hash/audio.m4b',
    });
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);

    expect((await iter.next()).value?.code).toBe('boundary');
    expect(controlCalls.find((call) => call['action'] === 'load')).toMatchObject({
      path: '/books/hash/audio.m4b',
    });
    expect(resolveUrl).not.toHaveBeenCalled();
    expect(loadBlob).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  test.each([
    ['invalidatePlayback', 'start-session'],
    ['invalidatePlayback', 'load'],
    ['shutdown', 'start-session'],
    ['shutdown', 'load'],
    ['stop', 'start-session'],
    ['stop', 'load'],
  ] as const)('does not resume after %s during Linux %s', async (stop, action) => {
    await setup(entry as BookMediaSource, linux);
    const control = vi.mocked(invoke).getMockImplementation()!;
    let finishLoad!: () => void;
    const gate = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      const payload = (args as { payload?: Record<string, unknown> })?.payload;
      const result = await control(cmd, args as Parameters<typeof invoke>[1]);
      if (cmd === 'plugin:native-tts|playout_control' && payload?.['action'] === action) {
        await gate;
      }
      return result;
    });
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    const pending = iter.next();
    await vi.waitFor(() =>
      expect(controlCalls.some((call) => call['action'] === action)).toBe(true),
    );
    await client[stop]();
    finishLoad();

    expect((await pending).value?.code).not.toBe('boundary');
    expect(controlCalls.some((call) => call['action'] === 'resume')).toBe(false);
    expect(controlCalls.some((call) => call['action'] === 'abort')).toBe(true);
  });

  test('keeps Linux handover playback continuous without aborting the native session', async () => {
    await setup(entry as BookMediaSource, linux);
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();
    controlCalls.length = 0;

    await client.stop(true);

    expect(controlCalls).toHaveLength(0);
    await client.stop();
  });

  test('ignores a stale start-session completion after the replacement session is ready', async () => {
    const player = new NativeNarrationPlayer();
    const control = vi.mocked(invoke).getMockImplementation()!;
    let finishOld!: (value: { session: number }) => void;
    const oldSession = new Promise<{ session: number }>((resolve) => {
      finishOld = resolve;
    });
    let starts = 0;
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      const payload = (args as { payload?: Record<string, unknown> })?.payload;
      if (cmd === 'plugin:native-tts|playout_control' && payload?.['action'] === 'start-session') {
        starts++;
        return starts === 1 ? oldSession : { session: 8 };
      }
      if (cmd === 'plugin:native-tts|playout_position') {
        return { session: 8, index: 0, positionMs: 2000, playing: false };
      }
      return control(cmd, args as Parameters<typeof invoke>[1]);
    });
    try {
      const oldReady = player.ensureReady();
      await vi.waitFor(() => expect(starts).toBe(1));
      player.invalidateSession(true);
      await player.ensureReady();
      finishOld({ session: 7 });
      await oldReady;

      expect(await player.sync()).toMatchObject({ session: 8, positionMs: 2000 });
      expect(player.currentTime).toBe(2);
    } finally {
      await player.shutdown();
    }
  });

  test('forwards native playback errors to the waiting utterance', async () => {
    await setup(entry as BookMediaSource, linux);
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();
    const pending = iter.next();
    playoutEvents!({ type: 'error', session: 7, index: 0 });

    expect((await pending).value?.code).toBe('error');
  });
});

describe('MediaOverlayClient on iOS Tauri', () => {
  // A compressed entry has no byte window in the book file to play.
  test('stages a compressed entry and drives the native playout instead of an element', async () => {
    await setup(null);
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    const first = await iter.next();

    expect(first.value).toEqual({ code: 'boundary', mark: '0', message: 'narration' });
    const actions = controlCalls.map((c) => c['action']);
    expect(actions).toContain('start-session');
    expect(actions).toContain('load');
    expect(actions).toContain('resume');
    const load = controlCalls.find((c) => c['action'] === 'load');
    expect(load?.['path']).toMatch(/mo-narration-.*\.mp4$/);
  });

  // A book's one shared track can be most of the book (900 MB in #6989), so
  // AVPlayer reads the stored entry's window of the book file instead of a
  // staged copy of it.
  test('plays a stored audio entry from its window of the book file without copying it', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    expect(book.loadBlob).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    const load = controlCalls.find((c) => c['action'] === 'load');
    expect(load).toMatchObject({ ...WINDOW, contentType: 'audio/mp4' });
  });

  test('stages the entry when the player cannot open its window', async () => {
    await setup();
    const control = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      const payload = (args as { payload?: Record<string, unknown> })?.payload ?? {};
      if (cmd === 'plugin:native-tts|playout_control' && payload['action'] === 'load') {
        controlCalls.push(payload);
        if (payload['start'] !== undefined) throw new Error('playout load: cannot open window');
        return { session: 7 } as unknown;
      }
      return control(cmd, args as Parameters<typeof invoke>[1]);
    });
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    expect(book.loadBlob).toHaveBeenCalledTimes(1);
    const loads = controlCalls.filter((c) => c['action'] === 'load');
    expect(loads.at(-1)?.['path']).toMatch(/mo-narration-.*\.mp4$/);
  });

  // iPadOS sends a desktop user agent, so the OS reads as macOS there (#6974).
  test('takes the native path on an iPad too', async () => {
    platform.os = 'macos';
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    const first = await iter.next();

    expect(first.value).toEqual({ code: 'boundary', mark: '0', message: 'narration' });
    expect(controlCalls.map((c) => c['action'])).toContain('start-session');
  });

  test('a native playback failure ends the utterance instead of hanging on it', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    const pending = iter.next();
    playoutEvents!({ type: 'error', session: 7, index: 0 });
    const step = await pending;

    expect(step.value?.code).toBe('error');
  });

  test('plays a paired local audiobook from its existing path without staging a copy', async () => {
    await setup();
    client.attachSource({
      narrator: 'External Narrator',
      loadBlob: vi.fn(async () => new Blob([new Uint8Array(8)])),
      resolvePath: vi.fn(async () => '/books/hash/audiobook/book.m4b'),
    });
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    expect(writeFile).not.toHaveBeenCalled();
    expect(controlCalls.find((call) => call['action'] === 'load')?.['path']).toBe(
      '/books/hash/audiobook/book.m4b',
    );
  });

  test('invalidatePlayback makes the next block open a fresh native session', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();
    expect(controlCalls.filter((c) => c['action'] === 'start-session')).toHaveLength(1);

    client.invalidatePlayback();
    const next = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await next.next();

    expect(controlCalls.filter((c) => c['action'] === 'start-session')).toHaveLength(2);
  });

  test('shutdown awaits one native abort', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    let finishAbort!: () => void;
    const abortGate = new Promise<void>((resolve) => {
      finishAbort = resolve;
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      const payload = (args as { payload?: Record<string, unknown> })?.payload ?? {};
      if (cmd === 'plugin:native-tts|playout_control') {
        controlCalls.push(payload);
        if (payload['action'] === 'abort') await abortGate;
        return { session: null } as unknown;
      }
      return undefined as unknown;
    });

    let settled = false;
    const shutdown = client.shutdown().then(() => {
      settled = true;
    });
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(settled).toBe(false);
    finishAbort();
    await shutdown;
    expect(controlCalls.filter((call) => call['action'] === 'abort')).toHaveLength(1);
  });
});
