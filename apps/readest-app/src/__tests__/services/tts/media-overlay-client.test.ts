import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { BookDoc } from '@/libs/document';
import type { TTSController } from '@/services/tts/TTSController';
import {
  loadMediaOverlaySection,
  type MediaOverlaySection,
} from '@/services/tts/mediaOverlay/MediaOverlaySection';
import { MediaOverlayClient } from '@/services/tts/mediaOverlay/MediaOverlayClient';

// Minimal HTMLAudioElement stand-in: jsdom has no media pipeline, so the test
// drives the clock itself and emits the events a real element would.
class FakeAudio {
  static instances: FakeAudio[] = [];

  src = '';
  playbackRate = 1;
  preservesPitch = true;
  paused = true;
  playCalls = 0;
  // Every explicit currentTime write, i.e. every seek the client performs.
  seeks: number[] = [];
  #time = 0;
  #listeners = new Map<string, Set<() => void>>();

  constructor() {
    FakeAudio.instances.push(this);
  }

  get currentTime(): number {
    return this.#time;
  }
  set currentTime(value: number) {
    this.#time = value;
    this.seeks.push(value);
  }

  addEventListener(type: string, fn: () => void): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.#listeners.get(type)?.delete(fn);
  }
  async play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }

  #emit(type: string): void {
    for (const fn of [...(this.#listeners.get(type) ?? [])]) fn();
  }
  // Advance the media clock as playback would — not a seek.
  advanceTo(seconds: number): void {
    this.#time = seconds;
    this.#emit('timeupdate');
  }
  fireEnded(): void {
    this.#emit('ended');
  }
  fireError(): void {
    this.#emit('error');
  }
}

const par = (id: string, begin: number, end: number, audio = 'ch1.mp3') =>
  `<par><text src="ch1.xhtml#${id}"/><audio src="${audio}" clipBegin="${begin}s" clipEnd="${end}s"/></par>`;

const HTML =
  '<p id="p1"><span id="w1">Alpha</span> <span id="w2">beta</span> <span id="w3">gamma</span></p>' +
  '<p id="p2">Second paragraph entirely.</p>';

const makeSection = async (
  smilBody: string,
  html = HTML,
): Promise<[MediaOverlaySection, BookDoc]> => {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html lang="en"><body>${html}</body></html>`,
    'text/html',
  );
  const book = {
    sections: [{ mediaOverlay: { href: 'OEBPS/ch1.smil', id: 'smil1' } }],
    loadText: async () => `<smil xmlns="http://www.w3.org/ns/SMIL"><body>${smilBody}</body></smil>`,
    // Typeless, as blobs really come out of the EPUB container.
    loadBlob: vi.fn(async () => new Blob([new Uint8Array(8)])),
    media: { narrator: 'Jane Reader' },
  } as unknown as BookDoc;
  const section = (await loadMediaOverlaySection(book, 0, doc, 'en'))!;
  return [section, book];
};

// One block of three word-level pars, then a whole-paragraph block.
const WORD_SMIL = par('w1', 0, 1) + par('w2', 1, 2) + par('w3', 2, 3) + par('p2', 3, 6);

let controller: { dispatchSpeakMark: ReturnType<typeof vi.fn> };
let client: MediaOverlayClient;
let section: MediaOverlaySection;
let book: BookDoc;

const setup = async (smilBody = WORD_SMIL) => {
  [section, book] = await makeSection(smilBody);
  controller = { dispatchSpeakMark: vi.fn() };
  client = new MediaOverlayClient(controller as unknown as TTSController);
  await client.init();
  client.attachBook(book);
  client.setSection(section);
};

const audio = () => FakeAudio.instances.at(-1)!;

// Patch the two URL statics in place: replacing the whole global would break
// `new URL()`, which parseSmil uses to resolve hrefs.
const createObjectURL = vi.fn((_blob: Blob) => 'blob:audio');
const revokeObjectURL = vi.fn();
const originalURLStatics = {
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};

beforeEach(() => {
  FakeAudio.instances = [];
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal('Audio', FakeAudio);
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  URL.createObjectURL = originalURLStatics.createObjectURL;
  URL.revokeObjectURL = originalURLStatics.revokeObjectURL;
});

describe('MediaOverlayClient capabilities', () => {
  test('reports a media clock and live rate, but no word boundaries or gap control', async () => {
    await setup();
    expect(client.getCapabilities()).toEqual({
      wordBoundaries: false,
      mediaClock: true,
      gapControl: false,
      liveRateChange: true,
      continuousTimeline: true,
    });
  });

  test('offers the narrator as its only voice', async () => {
    await setup();
    const groups = await client.getVoices('en');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.voices).toEqual([{ id: 'media-overlay', name: 'Jane Reader', lang: 'en' }]);
  });

  test('names the voice generically when the book declares no narrator', async () => {
    [section, book] = await makeSection(WORD_SMIL);
    (book as { media?: unknown }).media = undefined;
    client = new MediaOverlayClient({ dispatchSpeakMark: vi.fn() } as unknown as TTSController);
    await client.init();
    client.attachBook(book);
    client.setSection(section);
    const groups = await client.getVoices('en');
    expect(groups[0]!.voices[0]!.name).toBe('Book narration');
  });
});

describe('MediaOverlayClient playback', () => {
  test('emits a boundary per par and ends after the last one in the block', async () => {
    await setup();
    const ssml = section.ssmlForBlock(0)!;
    const iter = client.speak(ssml, new AbortController().signal);

    const events: (string | undefined)[] = [];
    let step = await iter.next();
    events.push(step.value?.code === 'boundary' ? `boundary:${step.value.mark}` : step.value?.code);

    for (const [time, _] of [
      [1, '1'],
      [2, '2'],
      [3, 'end'],
    ] as const) {
      const pending = iter.next();
      audio().advanceTo(time);
      step = await pending;
      events.push(
        step.value?.code === 'boundary' ? `boundary:${step.value.mark}` : step.value?.code,
      );
    }

    expect(events).toEqual(['boundary:0', 'boundary:1', 'boundary:2', 'end']);
    expect(controller.dispatchSpeakMark.mock.calls.map((c) => c[0].name)).toEqual(['0', '1', '2']);
  });

  // The utterance covers exactly the block's clips: 'end' arrives when its last
  // clipEnd is reached, which is what makes the controller advance a paragraph.
  test('ends the utterance at the last clip of the block', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();
    let step;
    for (const time of [1, 2, 3]) {
      const pending = iter.next();
      audio().advanceTo(time);
      step = await pending;
    }

    expect(step!.value).toMatchObject({ code: 'end' });
  });

  test('stops when the audio file itself runs out', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();
    const pending = iter.next();
    audio().fireEnded();
    const step = await pending;

    expect(step.value).toMatchObject({ code: 'end' });
    expect(audio().paused).toBe(true);
  });

  test('plays the block as one continuous span with no seeking at all', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();
    for (const time of [1, 2, 3]) {
      const pending = iter.next();
      audio().advanceTo(time);
      await pending;
    }

    // Block 0 starts at 0s and a fresh element is already there, so not one
    // seek is needed: the pars inside a block are contiguous audio.
    expect(audio().seeks).toEqual([]);
    expect(audio().playCalls).toBe(1);
  });

  // The listener's complaint that started this: a gap at every paragraph. The
  // recording runs on into the next paragraph, so a block ending must leave the
  // element playing, and the controller's pre-speak stop() is a handover.
  test('leaves the element playing when a block ends', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();
    for (const time of [1, 2, 3.04]) {
      const pending = iter.next();
      audio().advanceTo(time);
      await pending;
    }

    expect(audio().paused).toBe(false);
  });

  test('a handover stop keeps playing; a real stop silences', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    await client.stop(true);
    expect(audio().paused).toBe(false);

    await client.stop();
    expect(audio().paused).toBe(true);
  });

  test('a block that nothing takes over is silenced rather than left running', async () => {
    vi.useFakeTimers();
    try {
      await setup();
      const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
      await iter.next();
      for (const time of [1, 2, 3.04]) {
        const pending = iter.next();
        audio().advanceTo(time);
        await pending;
      }
      expect(audio().paused).toBe(false);

      await vi.advanceTimersByTimeAsync(1500);
      expect(audio().paused).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test('seeks in when the block does not start at the top of the file', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(1)!, new AbortController().signal);
    await iter.next();

    expect(audio().seeks).toEqual([3]);
    expect(audio().currentTime).toBe(3);
  });

  test('resumes mid-block from the requested mark', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0, '1')!, new AbortController().signal);
    const first = await iter.next();

    expect(first.value).toMatchObject({ code: 'boundary', mark: '1' });
    expect(audio().seeks).toEqual([1]);
  });

  test('re-seeks when a block spans more than one audio file', async () => {
    await setup(
      par('w1', 0, 1) + par('w2', 5, 6, 'ch2.mp3') + par('w3', 6, 7, 'ch2.mp3') + par('p2', 0, 2),
    );
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    const firstFile = audio();
    const pending = iter.next();
    firstFile.advanceTo(1);
    await pending;

    expect(FakeAudio.instances).toHaveLength(2);
    expect(audio().seeks).toEqual([5]);
  });

  test('treats the audio file ending as the end of the block', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    const pending = iter.next();
    audio().fireEnded();
    const step = await pending;

    expect(step.value).toMatchObject({ code: 'end' });
  });

  test('reports an error when the element fails mid-clip', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    const pending = iter.next();
    audio().fireError();
    const step = await pending;

    expect(step.value).toMatchObject({ code: 'error' });
  });

  test('stops without ending when aborted mid-clip', async () => {
    await setup();
    const abort = new AbortController();
    const iter = client.speak(section.ssmlForBlock(0)!, abort.signal);
    await iter.next();

    const pending = iter.next();
    abort.abort();
    const step = await pending;

    expect(step.value?.code).not.toBe('end');
    expect(audio().paused).toBe(true);
  });

  test('skips marks with no par, so a filtered SSML cannot wedge playback', async () => {
    await setup();
    const ssml =
      '<speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en">' +
      '<mark name="99"/>ghost<mark name="2"/>gamma</speak>';
    const iter = client.speak(ssml, new AbortController().signal);
    const first = await iter.next();

    expect(first.value).toMatchObject({ code: 'boundary', mark: '2' });
  });

  test('ends immediately when the SSML resolves to no pars at all', async () => {
    await setup();
    const ssml =
      '<speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en"><mark name="99"/>x</speak>';
    const iter = client.speak(ssml, new AbortController().signal);

    expect((await iter.next()).value).toMatchObject({ code: 'end' });
  });

  test('fetches each audio file once and reuses it across blocks', async () => {
    await setup();
    const play = async (blockIndex: number, upTo: number) => {
      const iter = client.speak(section.ssmlForBlock(blockIndex)!, new AbortController().signal);
      await iter.next();
      const pending = iter.next();
      audio().advanceTo(upTo);
      await pending;
      await client.stop();
    };
    await play(0, 1);
    await play(1, 6);

    expect(book.loadBlob).toHaveBeenCalledTimes(1);
  });

  // Media Overlay clips are contiguous, so sequential playback needs no seeking.
  // Detecting clipEnd by polling always lands a few ms PAST it, so the opening
  // milliseconds of the NEXT clip have already been heard. Seeking back to that
  // clip's clipBegin replays them, which is audible as a stutter on the first
  // word of every paragraph ("me me"). The client must keep rolling instead.
  test('does not seek when the playhead is already rolling into the clip', async () => {
    await setup();
    const signal = new AbortController().signal;

    // Play block 0 to its end; the clock overshoots past par w3's clipEnd of 3s.
    const first = client.speak(section.ssmlForBlock(0)!, signal);
    await first.next();
    for (const t of [1, 2, 3.04]) {
      const pending = first.next();
      audio().advanceTo(t);
      await pending;
    }
    const el = audio();
    const seeksAfterBlock0 = [...el.seeks];

    // Block 1 begins at 3s — behind where we stopped (3.04s).
    const second = client.speak(section.ssmlForBlock(1)!, signal);
    await second.next();

    expect(el.seeks).toEqual(seeksAfterBlock0);
    expect(el.currentTime).toBeCloseTo(3.04, 5);
  });

  test('still seeks when the playhead is somewhere unrelated', async () => {
    await setup();
    const signal = new AbortController().signal;

    const first = client.speak(section.ssmlForBlock(0)!, signal);
    await first.next();
    for (const t of [1, 2, 3.04]) {
      const pending = first.next();
      audio().advanceTo(t);
      await pending;
    }
    const el = audio();
    // The reader scrubs somewhere unrelated before the next block plays.
    el.advanceTo(120);

    const second = client.speak(section.ssmlForBlock(1)!, signal);
    await second.next();

    expect(el.seeks.at(-1)).toBe(3);
    expect(el.currentTime).toBe(3);
  });

  test('preloading warms the audio file without starting playback', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal, true);
    for await (const _ of iter);

    expect(book.loadBlob).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances.at(-1)?.playCalls ?? 0).toBe(0);
  });

  // Found by end-to-end playback of the W3C Moby-Dick MO sample: zip blobs come
  // out typeless and Chromium then refuses the blob URL with
  // MEDIA_ELEMENT_ERROR code 4 ("Format error").
  test('gives the blob URL an audio MIME type, since container blobs have none', async () => {
    await setup(par('w1', 0, 1, 'ch1.m4b'));
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0]![0].type).toBe('audio/mp4');
  });

  test('keeps a type the container did supply', async () => {
    [section, book] = await makeSection(WORD_SMIL);
    (book.loadBlob as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Blob([new Uint8Array(8)], { type: 'audio/flac' }),
    );
    client = new MediaOverlayClient({ dispatchSpeakMark: vi.fn() } as unknown as TTSController);
    await client.init();
    client.attachBook(book);
    client.setSection(section);

    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    expect(createObjectURL.mock.calls[0]![0].type).toBe('audio/flac');
  });

  // Also from end-to-end playback: preloadNextSSML(4) and playback all asked for
  // the same chapter file before any load finished, so five elements were built
  // and each one's release revoked the previous URL mid-load.
  test('concurrent requests for the same file share a single load', async () => {
    await setup();
    const signal = new AbortController().signal;
    const ssml = section.ssmlForBlock(0)!;

    await Promise.all([
      (async () => {
        for await (const _ of client.speak(ssml, signal, true));
      })(),
      (async () => {
        for await (const _ of client.speak(ssml, signal, true));
      })(),
      (async () => {
        for await (const _ of client.speak(ssml, signal, true));
      })(),
    ]);

    expect(book.loadBlob).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  test('preloading never swaps the element out from under live playback', async () => {
    // Block 0 plays ch1.mp3; block 1 is a different file. Preload of block 1
    // runs concurrently with playback and must not touch the playing element.
    await setup(par('w1', 0, 1) + par('w2', 1, 2) + par('w3', 2, 3) + par('p2', 0, 4, 'ch2.mp3'));
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();
    const playing = audio();

    const preload = client.speak(section.ssmlForBlock(1)!, new AbortController().signal, true);
    for await (const _ of preload);

    expect(audio()).toBe(playing);
    expect(playing.paused).toBe(false);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});

describe('MediaOverlayClient transport', () => {
  test('reports the position inside the audible par, clamped to its length', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0, '1')!, new AbortController().signal);
    await iter.next();

    audio().advanceTo(1.4);
    expect(client.getChunkPosition()).toBeCloseTo(0.4, 6);

    audio().advanceTo(9);
    expect(client.getChunkPosition()).toBeCloseTo(1, 6);
  });

  test('has no position before playback starts', async () => {
    await setup();
    expect(client.getChunkPosition()).toBeNull();
  });

  test('applies a rate change to audio already in flight', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    await client.setRate(1.5);
    expect(audio().playbackRate).toBe(1.5);
  });

  test('pause and resume drive the element and report success', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();

    await expect(client.pause()).resolves.toBe(true);
    expect(audio().paused).toBe(true);
    await expect(client.resume()).resolves.toBe(true);
    expect(audio().paused).toBe(false);
  });

  test('shutdown releases the blob URL it created', async () => {
    await setup();
    const iter = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await iter.next();
    await client.shutdown();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:audio');
  });
});
