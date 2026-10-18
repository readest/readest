import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TTSController } from '@/services/tts/TTSController';
import { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import { FoliateView } from '@/types/view';

// The look-ahead that preloads upcoming paragraphs steps the live foliate TTS
// forward and back. It must leave the sentence being read where it was, or the
// next "next sentence" tap starts from no sentence and skips the rest of the
// block (#6850). Runs the real foliate TTS so its reading position is real.

const makeMockClient = (name: string): TTSClient => ({
  name,
  initialized: true,
  init: vi.fn().mockResolvedValue(true),
  shutdown: vi.fn().mockResolvedValue(undefined),
  speak: vi.fn().mockImplementation(async function* (): AsyncIterable<TTSMessageEvent> {
    yield { code: 'end', message: 'done' };
  }),
  pause: vi.fn().mockResolvedValue(true),
  resume: vi.fn().mockResolvedValue(true),
  stop: vi.fn().mockResolvedValue(undefined),
  setPrimaryLang: vi.fn(),
  setRate: vi.fn().mockResolvedValue(undefined),
  setPitch: vi.fn().mockResolvedValue(undefined),
  setVoice: vi.fn().mockResolvedValue(undefined),
  getAllVoices: vi.fn().mockResolvedValue([]),
  getVoices: vi.fn().mockResolvedValue([]),
  getGranularities: vi.fn().mockReturnValue(['sentence']),
  getCapabilities: vi.fn().mockReturnValue({
    wordBoundaries: false,
    mediaClock: false,
    gapControl: false,
    liveRateChange: false,
  }),
  getVoiceId: vi.fn().mockReturnValue('preload-voice'),
  getSpeakingLang: vi.fn().mockReturnValue('en'),
});

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, makeMockClient('web-speech'));
  }),
}));
vi.mock('@/services/tts/EdgeTTSClient', () => ({
  DEFAULT_SENTENCE_GAP_SEC: 0.15,
  EdgeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, makeMockClient('edge-tts'));
  }),
}));
vi.mock('@/services/tts/NativeTTSClient', () => ({
  NativeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, makeMockClient('native'));
  }),
}));
vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredClient: vi.fn().mockReturnValue('edge-tts'),
    setPreferredClient: vi.fn(),
    setPreferredVoice: vi.fn(),
    getPreferredVoice: vi.fn().mockReturnValue(null),
  },
}));
vi.mock('foliate-js/overlayer.js', () => ({ Overlayer: { highlight: 'highlightFn' } }));

interface LiveTTS {
  start(): string | undefined;
  getLastRange(): Range | undefined;
}
const ttsInstances: LiveTTS[] = [];
vi.mock('foliate-js/tts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('foliate-js/tts.js')>();
  class RecordingTTS extends actual.TTS {
    constructor(...args: ConstructorParameters<typeof actual.TTS>) {
      super(...args);
      ttsInstances.push(this as unknown as LiveTTS);
    }
  }
  return { ...actual, TTS: RecordingTTS };
});

const makeView = (bodyHTML: string): FoliateView => {
  const doc = document.implementation.createHTMLDocument('t');
  doc.documentElement.lang = 'en';
  doc.body.innerHTML = bodyHTML;
  return {
    book: { sections: [{ createDocument: vi.fn().mockResolvedValue(doc) }] },
    renderer: {
      getContents: () => [{ doc, index: 0, overlayer: { add: vi.fn(), remove: vi.fn() } }],
      primaryIndex: 0,
    },
    language: { isCJK: false },
    getCFI: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2)'),
    resolveCFI: vi.fn().mockReturnValue({ anchor: () => new Range() }),
    tts: null,
  } as unknown as FoliateView;
};

const startOn = async (bodyHTML: string) => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  ttsInstances.length = 0;
  const controller = new TTSController(null, makeView(bodyHTML));
  await controller.init();
  await controller.initViewTTS(0);
  const tts = ttsInstances.at(-1)!;
  tts.start();
  // Reading has reached the second sentence of the first block.
  controller.dispatchSpeakMark({ offset: 0, name: '1', text: 'Two.', language: 'en' });
  expect(tts.getLastRange()?.toString().trim()).toBe('Two.');
  return { controller, tts };
};

describe('TTSController look-ahead keeps the sentence being read (#6850)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // The reporter's book: each chapter is one <div> of <br>-separated text, so
  // the whole chapter is a single block and the next block is the next chapter.
  test('next sentence after a preload stays in a one-block chapter', async () => {
    const { controller, tts } = await startOn(
      '<div><h3>Chapter</h3>One. Two. Three.<br/><br/>　　Four.</div>',
    );

    await controller.preloadNextSSML();
    await controller.forward(true);

    expect(tts.getLastRange()?.toString().trim()).toBe('Three.');
  });

  test('next sentence after a preload does not skip the rest of the paragraph', async () => {
    const { controller, tts } = await startOn('<p>One. Two. Three.</p><p>Four. Five.</p>');

    await controller.preloadNextSSML();
    await controller.forward(true);

    expect(tts.getLastRange()?.toString().trim()).toBe('Three.');
  });

  // A windowed engine looks ahead by duration, across many paragraphs.
  test('next sentence after a long windowed look-ahead stays in the paragraph', async () => {
    const paragraphs = Array.from({ length: 8 }, (_, i) => `<p>P${i}a. P${i}b.</p>`).join('');
    const { controller, tts } = await startOn(`<p>One. Two. Three.</p>${paragraphs}`);
    vi.mocked(controller.ttsClient.getCapabilities).mockReturnValue({
      wordBoundaries: false,
      mediaClock: false,
      gapControl: false,
      liveRateChange: false,
      windowedPrefetch: true,
    });

    await controller.preloadNextSSML();
    await controller.forward(true);

    expect(tts.getLastRange()?.toString().trim()).toBe('Three.');
  });

  test('previous sentence after a preload stays in the paragraph', async () => {
    const { controller, tts } = await startOn('<p>One. Two. Three.</p><p>Four. Five.</p>');

    await controller.preloadNextSSML();
    await controller.backward(true);

    expect(tts.getLastRange()?.toString().trim()).toBe('One.');
  });
});
