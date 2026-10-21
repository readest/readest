import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { TTSController } from '@/services/tts/TTSController';
import type { SpeechProvider, SpeechSynthesisResult } from '@/services/tts/providers/types';
import { FakeAudioContext, FakeAudioBuffer } from './tts-fake-audio';

let parsedMarks: Array<{ name: string; text: string; language: string }> = [];
vi.mock('@/utils/ssml', () => ({
  parseSSMLMarks: vi.fn(() => ({ marks: parsedMarks })),
}));
vi.mock('@/utils/misc', () => ({
  getUserLocale: vi.fn((lang: string) => (lang === 'en' ? 'en-US' : lang)),
  getOSPlatform: vi.fn(() => 'android'),
  stubTranslation: (key: string) => key,
}));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => false,
}));
vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredVoice: vi.fn(() => null),
    sortVoicesPreferLocaleFunc: () => () => 0,
  },
}));
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'log').mockImplementation(() => {});

const DECODE_SEC = 0.5;
const GAP_SEC = 0.2;
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

// The audio carries its sentence's text, so the fake decoder can record which
// sentences were decoded.
const encodeAudio = (text: string) => {
  const bytes = new Uint8Array(text.startsWith('Short') ? 48000 : 144000);
  bytes.set(new TextEncoder().encode(text));
  return bytes.buffer;
};
let decoded: string[] = [];
let decodeSec = 0;
let decodeGate: Promise<void> | null = null;

class DecodingAudioContext extends FakeAudioContext {
  override decodeImpl = async (data: ArrayBuffer) => {
    decoded.push(new TextDecoder().decode(new Uint8Array(data)).split('\0')[0]!);
    if (decodeGate) await decodeGate;
    this.currentTime += decodeSec;
    const samples = new Float32Array(data.byteLength / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.3 * Math.sin(i / 8);
    return new FakeAudioBuffer(samples, this.sampleRate);
  };
}

describe('first sentences prepared ahead', () => {
  let client: InstanceType<typeof import('@/services/tts/BufferedTTSClient').BufferedTTSClient>;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    FakeAudioContext.instances = [];
    decoded = [];
    decodeSec = 0;
    decodeGate = null;
    vi.stubGlobal('AudioContext', DecodingAudioContext);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => vi.unstubAllGlobals());

  // A windowed provider (Readest Voice) takes preloads as prefetch hints and
  // hands the audio back through onDelivered.
  // `held` sentences arrive only when released; requests for one share its
  // audio, as a windowed provider shares one synthesis between them.
  const makeClient = async (windowed = false, held = new Map<string, Promise<void>>()) => {
    await import('@/services/tts/EdgeTTSClient');
    const { BufferedTTSClient } = await import('@/services/tts/BufferedTTSClient');
    const synthesize = async (req: { text: string }): Promise<SpeechSynthesisResult> => {
      await held.get(req.text);
      return {
        audio: encodeAudio(req.text),
        boundaries: [{ offset: 0, duration: 1e7, text: req.text }],
      };
    };
    const provider: SpeechProvider = {
      id: 'mem',
      label: 'Mem',
      init: async () => true,
      getAllVoices: async () => [{ id: 'v1', name: 'Voice 1', lang: 'en-US' }],
      synthesize,
      ...(windowed && {
        prefetch: (reqs, _lane, _signal, options) => {
          for (const req of reqs) {
            void synthesize(req).then((result) => options?.onDelivered?.(req, result));
          }
        },
      }),
    };
    const controller = {
      dispatchSpeakMark: vi.fn(),
      prepareSpeakWords: vi.fn(),
      dispatchSpeakWord: vi.fn(),
    } as unknown as TTSController;
    client = new BufferedTTSClient(provider, controller);
    await client.init();
    await client.setRate(1.5);
    client.setParagraphGap(GAP_SEC);
  };

  const run = (marks: typeof parsedMarks, preload = false) => {
    parsedMarks = marks;
    const codes: string[] = [];
    const done = (async () => {
      for await (const e of await client.speak('<ssml/>', new AbortController().signal, preload))
        codes.push(e.code);
    })();
    return { codes, done };
  };

  // What the controller does: preload the paragraph, then speak it.
  const speak = async (marks: typeof parsedMarks) => {
    await run(marks, true).done;
    return run(marks);
  };

  const para = (p: string) => [
    { name: `${p}0`, text: `${p} one.`, language: 'en' },
    { name: `${p}1`, text: `${p} two.`, language: 'en' },
  ];

  test.each([
    ['an online voice', false],
    ['a windowed voice', true],
  ])(
    '%s: the pause between paragraphs is the scheduled gap, not decode time',
    async (_, windowed) => {
      await makeClient(windowed);
      const a = run(para('A'));
      await flush();
      const ctx = FakeAudioContext.instances.at(-1)!;
      decodeSec = DECODE_SEC;
      await run(para('B'), true).done;
      await flush();
      for (let i = 0; i < 50 && !a.codes.includes('end'); i++) {
        const pending = ctx.sources.filter((s) => !s.endedFired && !s.stopped);
        await ctx.advanceTo(Math.max(ctx.currentTime, ...pending.map((s) => s.endTime)));
        await flush();
      }
      await a.done;
      const lastEnd = Math.max(...ctx.sources.map((s) => s.endTime));
      const before = ctx.sources.length;
      await speak(para('B'));
      await flush();
      expect(ctx.sources[before]!.startedAt! - lastEnd).toBeCloseTo(GAP_SEC, 2);
    },
    30_000,
  );

  test('no gap longer than the scheduled pauses after a run of short paragraphs', async () => {
    await makeClient();
    client.setSentenceGap(0.1);
    const long = (p: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        name: `${p}${i}`,
        text: `${p} long ${i}.`,
        language: 'en',
      }));
    const short = (p: string) => [{ name: `${p}0`, text: `Short ${p}.`, language: 'en' }];
    const paragraphs = [long('A', 6), short('B'), short('C'), short('D'), short('E'), long('F', 6)];
    let ctx: FakeAudioContext | undefined;
    for (let p = 0; p < paragraphs.length; p++) {
      const session = await speak(paragraphs[p]!);
      if (!ctx) {
        await flush();
        ctx = FakeAudioContext.instances.at(-1)!;
        decodeSec = DECODE_SEC;
      }
      let preloaded = false;
      for (let step = 0; step < 2000 && !session.codes.includes('end'); step++) {
        if (!preloaded && session.codes.length > 0) {
          preloaded = true;
          void (async () => {
            for (const next of paragraphs.slice(p + 1, p + 5)) await run(next, true).done;
          })();
        }
        await ctx.advanceTo(ctx.currentTime + 0.05);
        await flush();
      }
      await session.done;
    }
    const played = ctx!.sources
      .filter((s) => s.startedAt !== null && s.endedFired)
      .sort((a, b) => a.startedAt! - b.startedAt!);
    let worst = 0;
    for (let i = 1; i < played.length; i++) {
      worst = Math.max(worst, played[i]!.startedAt! - played[i - 1]!.endTime);
    }
    expect(played.length).toBe(16);
    expect(worst).toBeLessThanOrEqual(GAP_SEC + 0.01);
  }, 60_000);

  test('preload finishes without waiting for the first sentence to be prepared', async () => {
    await makeClient();
    decodeGate = new Promise(() => {});
    const preload = run(para('B'), true);
    await flush();
    expect(decoded).toEqual(['B one.']);
    expect(preload.codes).toEqual(['end']);
  });

  test('keeps the nearest paragraphs when more are preloaded than it holds', async () => {
    await makeClient();
    const paragraphs = Array.from({ length: 10 }, (_, i) => para(`P${i}`));
    for (const p of paragraphs) await run(p, true).done;
    await flush();
    decoded = [];
    await speak(paragraphs[0]!);
    await flush();
    expect(decoded).not.toContain('P0 one.');
  });

  test("only a paragraph's first sentence takes a prepared chunk", async () => {
    await makeClient();
    const a = [
      { name: 'A0', text: 'A one.', language: 'en' },
      { name: 'A1', text: 'B one.', language: 'en' },
    ];
    await run(a, true).done;
    await run(para('B'), true).done;
    await flush();
    await speak(a);
    await flush();
    decoded = [];
    await speak(para('B'));
    await flush();
    expect(decoded).not.toContain('B one.');
  });

  test('a first sentence delivered as its paragraph starts leaves later ones prepared', async () => {
    let release = () => {};
    const held = new Map([['B one.', new Promise<void>((r) => (release = r))]]);
    await makeClient(true, held);
    await run(para('B'), true).done;
    await run(para('C'), true).done;
    await flush();
    await speak(para('B'));
    await flush();
    release();
    await flush();
    decoded = [];
    await speak(para('C'));
    await flush();
    expect(decoded).not.toContain('C one.');
  });

  test('a handover keeps what was prepared, any other stop drops it', async () => {
    await makeClient();
    await run(para('B'), true).done;
    await flush();
    await client.stop(true);
    decoded = [];
    await speak(para('B'));
    await flush();
    expect(decoded).not.toContain('B one.');

    await run(para('C'), true).done;
    await flush();
    await client.stop();
    decoded = [];
    await speak(para('C'));
    await flush();
    expect(decoded).toContain('C one.');
  });
});
