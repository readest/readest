// Android narration across a file boundary with the WebView asleep (#7193).
// ExoPlayer keeps playing under screen lock while the WebView's JS is
// suspended or throttled, so the next section's file is queued natively and
// JS reconciles with wherever the recording got to when it runs again. The
// fake below models the plugin's playout playlist: `load` seeks in place when
// jumps to a file already in the playlist (dropping the items before it) and
// otherwise replaces the playlist, `queue` keeps the last item and appends,
// and a file that plays out rolls into the next item on its own.
import { afterEach, beforeEach, describe, expect, type Mock, test, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), addPluginListener: vi.fn() }));
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
  getOSPlatform: () => 'android',
}));

import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import type { BookDoc } from '@/libs/document';
import type { TTSController } from '@/services/tts/TTSController';
import type { TTSMessageEvent } from '@/services/tts/TTSClient';
import type { AppService } from '@/types/system';
import {
  loadMediaOverlaySection,
  type MediaOverlaySection,
} from '@/services/tts/mediaOverlay/MediaOverlaySection';
import { MediaOverlayClient } from '@/services/tts/mediaOverlay/MediaOverlayClient';

const SESSION = 11;
const native = {
  items: [] as string[],
  current: -1,
  positionMs: 0,
  playing: false,
  // The item the playlist ended on, reported once nothing is current.
  endedIndex: -1,
};
let calls: string[] = [];
let emit: ((event: unknown) => void) | null = null;
// Runs inside the next native `load`, before the plugin handles it.
let beforeLoad: (() => void) | null = null;
// Holds back the next position read's reply, taken before it waits.
let positionGate: Promise<void> | null = null;

const file = (path: unknown) => String(path).split('/').pop();
const currentFile = () => file(native.items[native.current]);

const fakeInvoke = async (command: string, args?: unknown): Promise<unknown> => {
  const p = (args as { payload?: Record<string, unknown> })?.payload ?? {};
  if (command === 'plugin:native-tts|playout_position') {
    const pos = {
      session: SESSION,
      index: native.current,
      positionMs: native.positionMs,
      playing: native.playing,
      ...(native.current < 0 && native.endedIndex >= 0 ? { endedIndex: native.endedIndex } : {}),
    };
    const gate = positionGate;
    positionGate = null;
    if (gate) await gate;
    return pos;
  }
  switch (p['action']) {
    case 'start-session':
      Object.assign(native, { items: [], current: -1, positionMs: 0, playing: false });
      return { session: SESSION };
    case 'load': {
      beforeLoad?.();
      beforeLoad = null;
      const path = String(p['path']);
      const index = native.items.indexOf(path);
      native.items = index >= 0 ? native.items.slice(index) : [path];
      native.current = 0;
      native.positionMs = Number(p['positionMs'] ?? 0);
      calls.push(`load ${file(path)}`);
      return { session: SESSION };
    }
    case 'queue': {
      const path = String(p['path']);
      if (!native.items.length) throw new Error('nothing loaded to queue after');
      if (!native.items.includes(path)) {
        const last = native.items.length - 1;
        const keep = Math.min(last, native.current < 0 ? last : native.current);
        native.items = native.items.slice(keep);
        if (native.current >= 0) native.current -= keep;
        native.items.push(path);
      }
      calls.push(`queue ${file(path)}`);
      return { session: SESSION };
    }
    case 'seek':
      native.positionMs = Number(p['positionMs']);
      calls.push(`seek ${currentFile()} ${native.positionMs / 1000}s`);
      return { session: null };
    case 'resume':
      native.playing = true;
      return { session: null };
    case 'pause':
      native.playing = false;
      return { session: null };
    default:
      return { session: null };
  }
};

// ExoPlayer crossed from the current file into the queued one by itself and
// is `ms` into it.
const rollOver = (ms: number, { deliverEvent = true } = {}) => {
  const previous = native.current;
  native.current = previous + 1;
  native.positionMs = ms;
  if (deliverEvent) emit!({ type: 'item-ended', session: SESSION, index: previous });
};

const smil = (audio: string) =>
  `<smil xmlns="http://www.w3.org/ns/SMIL"><body>
    <par><text src="x.xhtml#s1"/><audio src="${audio}" clipBegin="0s" clipEnd="6s"/></par>
    <par><text src="x.xhtml#s2"/><audio src="${audio}" clipBegin="6s" clipEnd="12s"/></par>
    <par><text src="x.xhtml#s3"/><audio src="${audio}" clipBegin="12s" clipEnd="18s"/></par>
  </body></smil>`;

// Stanza 3 recorded in a file of its own.
const splitSmil = (audio: string) =>
  `<smil xmlns="http://www.w3.org/ns/SMIL"><body>
    <par><text src="x.xhtml#s1"/><audio src="${audio}.mp3" clipBegin="0s" clipEnd="6s"/></par>
    <par><text src="x.xhtml#s2"/><audio src="${audio}.mp3" clipBegin="6s" clipEnd="12s"/></par>
    <par><text src="x.xhtml#s3"/><audio src="${audio}-c.mp3" clipBegin="0s" clipEnd="6s"/></par>
  </body></smil>`;

const loadSection = async (audio: string, split = false): Promise<MediaOverlaySection> => {
  const doc = new DOMParser().parseFromString(
    '<!DOCTYPE html><html><body><p id="s1">One.</p><p id="s2">Two.</p><p id="s3">Three.</p></body></html>',
    'text/html',
  );
  const book = {
    sections: [{ mediaOverlay: { href: 'poem.smil', id: 'smil' } }],
    loadText: async () => (split ? splitSmil(audio) : smil(audio)),
  } as unknown as BookDoc;
  return (await loadMediaOverlaySection(book, 0, doc, 'en'))!;
};

let client: MediaOverlayClient;
let marks: string[];
let resolvePath: Mock<(href: string) => Promise<string | null>>;

const start = async (platform: Partial<AppService> = { isAndroidApp: true }) => {
  const a = await loadSection('poem1.mp3');
  const b = await loadSection('poem2.mp3');
  marks = [];
  client = new MediaOverlayClient(
    {
      dispatchSpeakMark: vi.fn((mark: { name: string }) => marks.push(mark.name)),
    } as unknown as TTSController,
    platform as AppService,
  );
  await client.init();
  resolvePath = vi.fn(async (href: string) => `/books/hash/${href}`);
  client.attachSource({ loadBlob: vi.fn(async () => new Blob([new Uint8Array(8)])), resolvePath });
  client.setSection(a);
  return { a, b };
};

const drain = async (gen: AsyncGenerator<TTSMessageEvent>) => {
  const out: TTSMessageEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
};

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves 'stuck' when the generator does not finish within `ms`.
const finishes = (gen: AsyncGenerator<TTSMessageEvent>, ms = 1500) =>
  Promise.race([drain(gen), tick(ms).then(() => 'stuck' as const)]);

// Play section A's last stanza, queue section B's file, and park the
// generator inside its wait for the clip end (where the controller keeps it).
const playLastStanzaOfA = async (a: MediaOverlaySection, b: MediaOverlaySection) => {
  const gen = client.speak(a.ssmlForBlock(2)!, new AbortController().signal);
  await gen.next(); // boundary for stanza 3 of poem1.mp3
  await client.preloadSection(b);
  const rest = drain(gen);
  await tick();
  return { rest };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
  Object.assign(native, { items: [], current: -1, positionMs: 0, playing: false, endedIndex: -1 });
  calls = [];
  emit = null;
  beforeLoad = null;
  positionGate = null;
  vi.mocked(addPluginListener).mockImplementation(async (_plugin, _event, cb) => {
    emit = cb as (event: unknown) => void;
    return { unregister: vi.fn() } as unknown as PluginListener;
  });
  vi.mocked(invoke).mockImplementation(fakeInvoke as typeof invoke);
});

afterEach(async () => {
  await client?.shutdown();
  vi.unstubAllEnvs();
});

describe('Android narration handover to the next file', () => {
  test('queues the next section file once the last file of this section plays', async () => {
    const { a, b } = await start();
    const { rest } = await playLastStanzaOfA(a, b);
    expect(calls).toEqual(['load poem1.mp3', 'seek poem1.mp3 12s', 'queue poem2.mp3']);
    native.positionMs = 18000;
    emit!({ type: 'ended', session: SESSION, index: 0 });
    await rest;
  });

  test('does not queue while this section has a later file still to play', async () => {
    const { a, b } = await start();
    const gen = client.speak(a.ssmlForBlock(0)!, new AbortController().signal);
    await gen.next();
    const twoFiles = await loadSection('poem1.mp3');
    // The current section's last stanza is in another file than the one playing.
    (twoFiles.pars.at(-1) as { audioHref: string }).audioHref = 'poem1b.mp3';
    client.setSection(twoFiles);
    await client.preloadSection(b);

    expect(calls.filter((call) => call.startsWith('queue'))).toEqual([]);
    await client.stop();
  });

  test('an offer repeated on every preload queues the file once', async () => {
    const { a, b } = await start();
    const { rest } = await playLastStanzaOfA(a, b);
    const lookups = resolvePath.mock.calls.length;
    await client.preloadSection(b);
    await client.preloadSection(b);

    expect(calls.filter((call) => call.startsWith('queue'))).toEqual(['queue poem2.mp3']);
    expect(resolvePath.mock.calls.length).toBe(lookups);
    native.positionMs = 18000;
    emit!({ type: 'ended', session: SESSION, index: 0 });
    await rest;
  });

  test("queues the section's own next file while an earlier one plays", async () => {
    await start();
    const split = await loadSection('poem1', true);
    client.setSection(split);
    const gen = client.speak(split.ssmlForBlock(0)!, new AbortController().signal);
    await gen.next();
    await tick();

    expect(calls).toContain('queue poem1-c.mp3');
    // Its stanza joins the rolled-over file like a next section would.
    const rest = drain(gen);
    await tick();
    rollOver(3000);
    await rest;
    calls = [];
    const gen2 = client.speak(split.ssmlForBlock(2)!, new AbortController().signal);
    await gen2.next();
    expect(calls).toEqual([]);
    await client.stop();
  });

  test('a queue still resolving when another file loads is dropped', async () => {
    const { a, b } = await start();
    const gen = client.speak(a.ssmlForBlock(2)!, new AbortController().signal);
    await gen.next();
    // poem2.mp3's path is slow to resolve; meanwhile the reader moves on.
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    resolvePath.mockImplementation(async (href: string) => {
      if (href === 'poem2.mp3') await slow;
      return `/books/hash/${href}`;
    });
    const offer = client.preloadSection(b);
    const c = await loadSection('poem3.mp3');
    client.setSection(c);
    const gen2 = client.speak(c.ssmlForBlock(0)!, new AbortController().signal);
    await gen2.next();
    release();
    await offer;

    expect(calls).toContain('load poem3.mp3');
    expect(calls.filter((call) => call.startsWith('queue'))).toEqual([]);
    await client.stop();
  });

  test('does not queue on iOS, whose player has no playlist', async () => {
    const { a, b } = await start({ isIOSApp: true });
    const gen = client.speak(a.ssmlForBlock(2)!, new AbortController().signal);
    await gen.next();
    await client.preloadSection(b);

    expect(calls.filter((call) => call.startsWith('queue'))).toEqual([]);
    await client.stop();
  });

  test('screen on: the next section joins the rolled-over file without a load or seek', async () => {
    const { a, b } = await start();
    const { rest } = await playLastStanzaOfA(a, b);
    rollOver(100);
    expect(await rest).toEqual([{ code: 'end', message: 'Narration finished' }]);

    calls = [];
    client.setSection(b);
    const gen = client.speak(b.ssmlForBlock(0)!, new AbortController().signal);
    await gen.next();

    expect(calls).toEqual([]);
    // Stanza 1 of poem2.mp3 runs to 6 s: the block must not end after one poll.
    expect(await finishes(gen, 1200)).toBe('stuck');
  });

  test('screen on: rolling over just as JS loads the next file loses no stanza', async () => {
    const { a, b } = await start();
    const { rest } = await playLastStanzaOfA(a, b);
    // JS reaches poem1.mp3's last clip end a moment before the file runs out.
    native.positionMs = 18000;
    await rest;

    // ExoPlayer rolls into poem2.mp3 between JS deciding to load it and the
    // load reaching the plugin; the rollover event lands after the load.
    beforeLoad = () => {
      native.current = 1;
      native.positionMs = 50;
      setTimeout(() => emit!({ type: 'item-ended', session: SESSION, index: 0 }), 30);
    };
    client.setSection(b);
    const gen = client.speak(b.ssmlForBlock(0)!, new AbortController().signal);
    await gen.next();

    expect(calls.slice(-1)).toEqual(['load poem2.mp3']);
    expect(native.items.map(file)).toEqual(['poem2.mp3']);
    // Stanza 1 of poem2.mp3 runs to 6 s: the late event must not end it.
    expect(await finishes(gen, 1200)).toBe('stuck');
  });

  test('queueing the following file drops the files already played', async () => {
    const { a, b } = await start();
    const { rest } = await playLastStanzaOfA(a, b);
    rollOver(7000);
    await rest;
    client.setSection(b);
    const gen = client.speak(b.ssmlForBlock(2)!, new AbortController().signal);
    await gen.next();
    const c = await loadSection('poem3.mp3');
    await client.preloadSection(c);

    expect(native.items.map(file)).toEqual(['poem2.mp3', 'poem3.mp3']);
    await client.stop();
  });

  test('a late rollover event from before the next queue does not end the file playing', async () => {
    const { a, b } = await start();
    const { rest } = await playLastStanzaOfA(a, b);
    // The position read finds the rollover; its event is still on the way.
    rollOver(7000, { deliverEvent: false });
    await rest;
    client.setSection(b);
    const gen = client.speak(b.ssmlForBlock(2)!, new AbortController().signal);
    await gen.next();
    await client.preloadSection(await loadSection('poem3.mp3'));
    expect(native.items.map(file)).toEqual(['poem2.mp3', 'poem3.mp3']);

    // poem1.mp3's event names item 0, which is now poem2.mp3.
    emit!({ type: 'item-ended', session: SESSION, index: 0 });
    // Stanza 3 of poem2.mp3 runs to 18 s, and the player is at 7 s.
    expect(await finishes(gen, 1200)).toBe('stuck');
  });

  test('after the lock: the next section continues from the live position, not 0 s', async () => {
    const { a, b } = await start();
    const { rest } = await playLastStanzaOfA(a, b);
    // Under lock ExoPlayer played into poem2.mp3's second stanza.
    rollOver(7000);
    await rest;

    calls = [];
    client.setSection(b);
    const gen = client.speak(b.ssmlForBlock(0)!, new AbortController().signal);
    expect(await finishes(gen)).not.toBe('stuck');

    // Stanza 1 (0-6 s) was heard under lock: its mark passes without a seek.
    expect(calls).toEqual([]);
    expect(marks.at(-1)).toBe(b.pars[0]!.markName);
  });

  test('after a lock longer than the queued file: it is passed over, not replayed', async () => {
    const { a, b } = await start();
    const { rest } = await playLastStanzaOfA(a, b);
    // poem2.mp3 played to its end too, and the playlist stopped.
    rollOver(18000);
    native.current = -1;
    native.playing = false;
    emit!({ type: 'ended', session: SESSION, index: 0 });
    await rest;

    calls = [];
    client.setSection(b);
    for (const block of [0, 1, 2]) {
      const gen = client.speak(b.ssmlForBlock(block)!, new AbortController().signal);
      expect(await finishes(gen)).not.toBe('stuck');
    }
    expect(calls).toEqual([]);
  });

  test('after a lock longer than the queued file, with every event lost: it is not replayed', async () => {
    const { a, b } = await start();
    const { rest } = await playLastStanzaOfA(a, b);
    // poem2.mp3 played to its end too; neither the rollover nor the end
    // reached JS. Only the position read tells.
    rollOver(18000, { deliverEvent: false });
    native.endedIndex = native.current;
    native.current = -1;
    native.playing = false;
    expect(await Promise.race([rest, tick(1500).then(() => 'stuck')])).not.toBe('stuck');

    calls = [];
    client.setSection(b);
    for (const block of [0, 1, 2]) {
      const gen = client.speak(b.ssmlForBlock(block)!, new AbortController().signal);
      expect(await finishes(gen)).not.toBe('stuck');
    }
    expect(calls).toEqual([]);
  });

  test('after the lock: stanzas of the old file still behind are skipped, never sought in the new file', async () => {
    const { a, b } = await start();
    // JS is still on stanza 1 of poem1.mp3 when the file runs out natively.
    const gen = client.speak(a.ssmlForBlock(0)!, new AbortController().signal);
    await gen.next();
    await client.preloadSection(b);
    const rest = drain(gen);
    await tick();
    // 2 s into poem2.mp3: outside every clip of poem1.mp3 still to come.
    rollOver(2000);
    await rest;

    calls = [];
    const gen2 = client.speak(a.ssmlForBlock(1)!, new AbortController().signal);
    expect(await finishes(gen2)).not.toBe('stuck');

    expect(calls.filter((call) => call.startsWith('seek'))).toEqual([]);
  });

  test('after the lock: a rollover whose event was lost is found from the position', async () => {
    const { a, b } = await start();
    const { rest } = await playLastStanzaOfA(a, b);
    rollOver(7000, { deliverEvent: false });
    expect(await Promise.race([rest, tick(1500).then(() => 'stuck')])).not.toBe('stuck');

    calls = [];
    client.setSection(b);
    const gen = client.speak(b.ssmlForBlock(0)!, new AbortController().signal);
    await finishes(gen);
    expect(calls).toEqual([]);
  });
});

describe('Android narration end of file while the WebView was asleep', () => {
  test('an ended event that lands between two clip waits still ends the block', async () => {
    const { a } = await start();
    const gen = client.speak(a.ssmlForBlock(0)!, new AbortController().signal);
    await gen.next(); // the generator is parked at the boundary, not waiting
    native.current = -1;
    native.playing = false;
    emit!({ type: 'ended', session: SESSION, index: 0 });

    expect(await finishes(gen)).toEqual([{ code: 'end', message: 'Narration finished' }]);
  });

  test('a late ended event does not end the file loaded since', async () => {
    const { a, b } = await start();
    const gen = client.speak(a.ssmlForBlock(2)!, new AbortController().signal);
    await gen.next();
    const rest = finishes(gen);
    // poem1.mp3 ends; a position read finds it before the event arrives.
    native.current = -1;
    native.playing = false;
    expect(await rest).not.toBe('stuck');

    client.setSection(b);
    const gen2 = client.speak(b.ssmlForBlock(0)!, new AbortController().signal);
    await gen2.next();
    expect(calls.slice(-1)).toEqual(['load poem2.mp3']);
    emit!({ type: 'ended', session: SESSION, index: 0 });
    // Stanza 1 of poem2.mp3 runs to 6 s, and the player is at 0 s.
    expect(await finishes(gen2, 1200)).toBe('stuck');
  });

  test('a position read taken before a load does not end the file loaded', async () => {
    const { a, b } = await start();
    const gen = client.speak(a.ssmlForBlock(2)!, new AbortController().signal);
    await gen.next();
    const rest = finishes(gen);
    // poem1.mp3 ends. The first read to see it is slow to come back; a later
    // one ends the block and JS loads poem2.mp3 before the slow one lands.
    let release!: () => void;
    positionGate = new Promise<void>((resolve) => (release = resolve));
    native.current = -1;
    native.playing = false;
    expect(await rest).not.toBe('stuck');

    client.setSection(b);
    const gen2 = client.speak(b.ssmlForBlock(0)!, new AbortController().signal);
    await gen2.next();
    expect(calls.slice(-1)).toEqual(['load poem2.mp3']);
    release();
    expect(await finishes(gen2, 1200)).toBe('stuck');
  });

  test('a file queued after the playlist ended is loaded, not waited on', async () => {
    const { a, b } = await start();
    const gen = client.speak(a.ssmlForBlock(2)!, new AbortController().signal);
    await gen.next();
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    resolvePath.mockImplementation(async (href: string) => {
      if (href === 'poem2.mp3') await slow;
      return `/books/hash/${href}`;
    });
    const offer = client.preloadSection(b);
    const rest = finishes(gen);
    // poem1.mp3 ends while poem2.mp3's path still resolves.
    native.current = -1;
    native.endedIndex = 0;
    native.playing = false;
    expect(await rest).not.toBe('stuck');
    release();
    await offer;
    expect(native.items.map(file)).toEqual(['poem1.mp3', 'poem2.mp3']);

    client.setSection(b);
    const gen2 = client.speak(b.ssmlForBlock(0)!, new AbortController().signal);
    await gen2.next();
    expect(calls.slice(-1)).toEqual(['load poem2.mp3']);
    expect(native.items.map(file)).toEqual(['poem2.mp3']);
    expect(native.current).toBe(0);
    expect(await finishes(gen2, 1200)).toBe('stuck');
  });

  test('an ended event that never arrives is found from the position', async () => {
    const { a } = await start();
    const gen = client.speak(a.ssmlForBlock(0)!, new AbortController().signal);
    await gen.next();
    const rest = finishes(gen);
    native.current = -1;
    native.playing = false;

    expect(await rest).toEqual([{ code: 'end', message: 'Narration finished' }]);
  });
});
