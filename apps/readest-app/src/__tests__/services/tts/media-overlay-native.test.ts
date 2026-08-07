import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The iOS Tauri branch of MediaOverlayClient: narration plays through the
// shared native playout AVPlayer instead of an HTMLAudioElement, because
// WebKit media elements lose the app's non-mixable .playback session.
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

vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getOSPlatform: () => 'ios',
}));

import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('MediaOverlayClient on iOS Tauri', () => {
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
});
