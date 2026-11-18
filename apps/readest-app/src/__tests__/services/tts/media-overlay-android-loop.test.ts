import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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

vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getOSPlatform: () => 'android',
}));

import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import type { BookDoc } from '@/libs/document';
import type { NarrationAudioSource } from '@/services/tts/mediaOverlay/MediaOverlayClient';
import type { NarrationLoopSpan, TTSController } from '@/services/tts/TTSController';
import type { AppService } from '@/types/system';
import {
  loadMediaOverlaySection,
  type MediaOverlaySection,
} from '@/services/tts/mediaOverlay/MediaOverlaySection';
import { MediaOverlayClient } from '@/services/tts/mediaOverlay/MediaOverlayClient';

// Two sentences of one chapter file: A = 0-4s, B = 4-9s.
const SMIL = `<smil xmlns="http://www.w3.org/ns/SMIL"><body>
  <par><text src="ch1.xhtml#a"/><audio src="ch1.mp3" clipBegin="0s" clipEnd="4s"/></par>
  <par><text src="ch1.xhtml#b"/><audio src="ch1.mp3" clipBegin="4s" clipEnd="9s"/></par>
</body></smil>`;

let client: MediaOverlayClient;
let section: MediaOverlaySection;
let controlCalls: Array<Record<string, unknown>>;
let positionMs: number;
let emit: (event: unknown) => void;
let loopSpan: NarrationLoopSpan | null;
let pauseAfterSentence: boolean;

const source: NarrationAudioSource = {
  loadBlob: vi.fn(async () => new Blob([new Uint8Array(8)])),
  resolvePath: vi.fn(async () => '/books/hash/ch1.mp3'),
};

const setup = async () => {
  const doc = new DOMParser().parseFromString(
    '<!DOCTYPE html><html><body><p id="a">One.</p><p id="b">Two.</p></body></html>',
    'text/html',
  );
  const book = {
    sections: [{ mediaOverlay: { href: 'ch1.smil', id: 'smil1' } }],
    loadText: async () => SMIL,
    loadBlob: vi.fn(async () => new Blob([new Uint8Array(8)])),
  } as unknown as BookDoc;
  section = (await loadMediaOverlaySection(book, 0, doc, 'en'))!;
  client = new MediaOverlayClient(
    {
      dispatchSpeakMark: vi.fn(),
      getNarrationLoop: () => loopSpan,
      get pauseAfterSentence() {
        return pauseAfterSentence;
      },
    } as unknown as TTSController,
    { isAndroidApp: true } as AppService,
  );
  await client.init();
  client.attachSource(source);
  client.setSection(section);
};

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Whether `promise` settles within `ms`.
const settlesWithin = async (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => true), settle(ms).then(() => false)]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
  controlCalls = [];
  positionMs = 4000;
  loopSpan = { audioHref: 'ch1.mp3', clipBegin: 0, clipEnd: 9 };
  pauseAfterSentence = false;
  vi.mocked(addPluginListener).mockImplementation(async (_plugin, _event, handler) => {
    emit = handler as (event: unknown) => void;
    return { unregister: vi.fn() } as unknown as PluginListener;
  });
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    const payload = (args as { payload?: Record<string, unknown> })?.payload ?? {};
    if (command === 'plugin:native-tts|playout_control') {
      controlCalls.push(payload);
      if (payload['action'] === 'start-session') return { session: 11 };
      if (payload['action'] === 'set-loop') return { session: 11, armed: true };
      return { session: null };
    }
    if (command === 'plugin:native-tts|playout_position') {
      // A still clock the test moves by hand.
      return { session: 11, index: 0, positionMs, playing: false };
    }
    return undefined;
  });
});

afterEach(async () => {
  await client?.shutdown();
  vi.unstubAllEnvs();
});

describe('MediaOverlayClient A-B repeat on Android', () => {
  test('hands an A-B span inside one file to the native player', async () => {
    await setup();
    const utterance = client.speak(section.ssmlForBlock(1)!, new AbortController().signal);
    await utterance.next();

    expect(controlCalls.filter((call) => call['action'] === 'set-loop')).toEqual([
      { action: 'set-loop', path: '/books/hash/ch1.mp3', loopStartMs: 0, loopEndMs: 9000 },
    ]);
  });

  test("B ends on the native player's jump back to A, not on a late clock read", async () => {
    await setup();
    const utterance = client.speak(section.ssmlForBlock(1)!, new AbortController().signal);
    await utterance.next(); // B's boundary
    const end = utterance.next();

    // A throttled WebView may read the clock just past B's end before the
    // jump: that alone must not end B, or JS would seek to A a second time.
    positionMs = 9200;
    await settle(400);
    expect(await settlesWithin(end, 0)).toBe(false);

    // The native player jumped back to A on its own.
    positionMs = 0;
    emit({ type: 'loop', session: 11, index: 0 });
    expect(await settlesWithin(end, 300)).toBe(true);
    expect((await end).value).toMatchObject({ code: 'end' });
  });

  test('a wait that missed the loop event ends once the clock is back before B', async () => {
    await setup();
    const utterance = client.speak(section.ssmlForBlock(1)!, new AbortController().signal);
    await utterance.next();
    const end = utterance.next();

    positionMs = 1500; // somewhere in A: the span came round already
    expect(await settlesWithin(end, 600)).toBe(true);
  });

  test('restarting at A does not seek while the native player is inside the span', async () => {
    await setup();
    const b = client.speak(section.ssmlForBlock(1)!, new AbortController().signal);
    await b.next();
    const bEnd = b.next();
    positionMs = 2500; // looped, and already halfway through A
    emit({ type: 'loop', session: 11, index: 0 });
    await bEnd;
    await b.next();

    const seeksBefore = controlCalls.filter((call) => call['action'] === 'seek').length;
    const a = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await a.next();
    expect(controlCalls.filter((call) => call['action'] === 'seek')).toHaveLength(seeksBefore);
  });

  test('an explicit return to A still seeks while the playhead is inside the span', async () => {
    await setup();
    // B is sounding (6s) when the listener picks A: the controller aborts B.
    const playingB = new AbortController();
    const b = client.speak(section.ssmlForBlock(1)!, playingB.signal);
    await b.next();
    const bEnd = b.next();
    positionMs = 6000;
    await settle(300);
    playingB.abort();
    await bEnd;

    const seeksBefore = controlCalls.filter((call) => call['action'] === 'seek').length;
    const a = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await a.next();
    const seeks = controlCalls.filter((call) => call['action'] === 'seek');
    expect(seeks).toHaveLength(seeksBefore + 1);
    expect(seeks.at(-1)).toMatchObject({ positionMs: 0 });
  });

  test('retries a set-loop that failed', async () => {
    await setup();
    let failSetLoop = true;
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const payload = (args as { payload?: Record<string, unknown> })?.payload ?? {};
      if (payload['action'] === 'set-loop' && failSetLoop) {
        controlCalls.push(payload);
        throw new Error('plugin busy');
      }
      return base(command, args);
    });
    const utterance = client.speak(section.ssmlForBlock(1)!, new AbortController().signal);
    await utterance.next();
    failSetLoop = false;
    await client.refreshLoop();

    expect(controlCalls.filter((call) => call['action'] === 'set-loop')).toHaveLength(2);
  });

  test('sends the span again when the plugin did not arm it', async () => {
    await setup();
    let armed = false; // playback had moved on to another file
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const payload = (args as { payload?: Record<string, unknown> })?.payload ?? {};
      if (payload['action'] === 'set-loop') {
        controlCalls.push(payload);
        return { session: 11, armed };
      }
      return base(command, args);
    });
    const utterance = client.speak(section.ssmlForBlock(1)!, new AbortController().signal);
    await utterance.next();
    armed = true;
    await client.refreshLoop();

    expect(controlCalls.filter((call) => call['action'] === 'set-loop')).toHaveLength(2);
  });

  test('retries a clear-loop that failed, keeping the span until it succeeds', async () => {
    await setup();
    const utterance = client.speak(section.ssmlForBlock(1)!, new AbortController().signal);
    await utterance.next();
    let failClear = true;
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const payload = (args as { payload?: Record<string, unknown> })?.payload ?? {};
      if (payload['action'] === 'clear-loop' && failClear) {
        controlCalls.push(payload);
        throw new Error('plugin busy');
      }
      return base(command, args);
    });
    loopSpan = null;
    await client.refreshLoop();
    // Android may still be repeating: B's end still waits on its jump.
    const end = utterance.next();
    positionMs = 9200;
    expect(await settlesWithin(end, 400)).toBe(false);

    failClear = false;
    await client.refreshLoop();
    expect(controlCalls.filter((call) => call['action'] === 'clear-loop')).toHaveLength(2);
  });

  test('falls back to the clock if the native player never jumps', async () => {
    await setup();
    const utterance = client.speak(section.ssmlForBlock(1)!, new AbortController().signal);
    await utterance.next();
    const end = utterance.next();

    positionMs = 10000;
    expect(await settlesWithin(end, 600)).toBe(true);
  });

  test('leaves B to the clock when playback pauses after every sentence', async () => {
    // The controller pauses at B's end: a native jump would start A first.
    pauseAfterSentence = true;
    await setup();
    const utterance = client.speak(section.ssmlForBlock(1)!, new AbortController().signal);
    await utterance.next();
    const end = utterance.next();

    expect(controlCalls.filter((call) => call['action'] === 'set-loop')).toHaveLength(0);
    positionMs = 9000;
    expect(await settlesWithin(end, 300)).toBe(true);
  });

  test('clears the native loop when the span leaves the file', async () => {
    await setup();
    const first = client.speak(section.ssmlForBlock(1)!, new AbortController().signal);
    await first.next();
    loopSpan = null;
    await client.refreshLoop();

    expect(controlCalls.filter((call) => call['action'] === 'clear-loop')).toHaveLength(1);
  });
});
