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

vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getOSPlatform: () => 'ios',
}));

import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { BookDoc } from '@/libs/document';
import type { TTSController } from '@/services/tts/TTSController';
import {
  loadMediaOverlaySection,
  type MediaOverlaySection,
} from '@/services/tts/mediaOverlay/MediaOverlaySection';
import { MediaOverlayClient } from '@/services/tts/mediaOverlay/MediaOverlayClient';

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

const setup = async () => {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html lang="en"><body>${HTML}</body></html>`,
    'text/html',
  );
  const book = {
    sections: [{ mediaOverlay: { href: 'OEBPS/ch1.smil', id: 'smil1' } }],
    loadText: async () => `<smil xmlns="http://www.w3.org/ns/SMIL"><body>${SMIL}</body></smil>`,
    loadBlob: vi.fn(async () => new Blob([new Uint8Array(8)])),
    media: { narrator: 'Jane Reader' },
  } as unknown as BookDoc;
  section = (await loadMediaOverlaySection(book, 0, doc, 'en'))!;
  client = new MediaOverlayClient({ dispatchSpeakMark: vi.fn() } as unknown as TTSController);
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
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('MediaOverlayClient on iOS Tauri', () => {
  test('prepares the next embedded file while native playback keeps running', async () => {
    await setup();
    const signal = new AbortController().signal;
    await client.speak(section.ssmlForBlock(0)!, signal).next();
    const callsBefore = controlCalls.length;
    const next = {
      pars: [{ audioHref: 'OEBPS/ch2.mp4', clipBegin: 0, clipEnd: 3 }],
    } as unknown as MediaOverlaySection;
    await client.preloadSection(next);
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(controlCalls.slice(callsBefore).every((call) => call['action'] === 'queue-next')).toBe(
      true,
    );
  });

  test('adopts a prepared native member without extracting or writing it again', async () => {
    await setup();
    const loadBlob = vi.fn(async () => new Blob([new Uint8Array(8)]));
    client.attachSource({ loadBlob });
    const signal = new AbortController().signal;
    await client.speak(section.ssmlForBlock(0)!, signal).next();
    const href = 'OEBPS/ch2.mp4';
    await client.preloadSection({ pars: [{ audioHref: href }] } as unknown as MediaOverlaySection);
    await client.stop(true);
    for (const par of section.pars) par.audioHref = href;
    expect((await client.speak(section.ssmlForBlock(0)!, signal).next()).value).toMatchObject({
      code: 'boundary',
    });
    expect(loadBlob).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(controlCalls.filter((call) => call['action'] === 'load').at(-1)?.['path']).toContain(
      '-next-',
    );
  });

  test('queues the prepared section before the current native file finishes', async () => {
    await setup();
    await client.speak(section.ssmlForBlock(0)!, new AbortController().signal).next();
    await client.preloadSection({
      pars: [{ audioHref: 'OEBPS/ch2.mp4', clipBegin: 2, clipEnd: 8 }],
    } as unknown as MediaOverlaySection);
    expect(controlCalls).toContainEqual(
      expect.objectContaining({ action: 'queue-next', atMs: 3000, positionMs: 2000, endMs: 8000 }),
    );
  });

  test('joins an already playing native member after delayed page navigation without a pause or rewind', async () => {
    vi.useFakeTimers();
    await setup();
    const signal = new AbortController().signal;
    const current = client.speak(section.ssmlForBlock(0)!, signal);
    await current.next();
    const href = 'OEBPS/ch2.mp4';
    await client.preloadSection({
      pars: [{ audioHref: href, clipBegin: 2, clipEnd: 9 }],
    } as unknown as MediaOverlaySection);
    const path = controlCalls.find((call) => call['action'] === 'queue-next')!['path'];
    const invokeOriginal = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd, args) =>
      cmd === 'plugin:native-tts|playout_position'
        ? { session: 7, index: 0, positionMs: 3000, playing: false }
        : invokeOriginal(cmd, args),
    );
    await vi.advanceTimersByTimeAsync(250);
    vi.mocked(invoke).mockImplementation(invokeOriginal);
    playoutEvents!({ type: 'segment-start', session: 7, path, positionMs: 6500 });
    for await (const _ of current);
    await client.stop(true);
    expect(
      client.isAudioPlaying?.(),
      'the native queued item is already audible during navigation',
    ).toBe(true);
    for (const [index, par] of section.pars.entries()) {
      par.audioHref = href;
      par.clipBegin = 2 + index;
      par.clipEnd = 3 + index;
    }
    const before = controlCalls.length;
    expect((await client.speak(section.ssmlForBlock(0)!, signal).next()).value).toMatchObject({
      code: 'boundary',
    });
    expect(
      controlCalls
        .slice(before)
        .some((call) => ['load', 'pause', 'seek'].includes(String(call['action']))),
    ).toBe(false);
    expect(client.getChunkPosition()).toBe(1);
  });

  test('a chapter stop prepares the file without scheduling automatic playback', async () => {
    await setup();
    await client.speak(section.ssmlForBlock(0)!, new AbortController().signal).next();
    await client.preloadSection(
      {
        pars: [{ audioHref: 'next.mp4', clipBegin: 0, clipEnd: 3 }],
      } as unknown as MediaOverlaySection,
      false,
    );
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(controlCalls.some((call) => call['action'] === 'queue-next')).toBe(false);
  });

  test('stages the chapter and drives the native playout instead of an element', async () => {
    await setup();
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
