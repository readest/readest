import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TTSController } from '@/services/tts/TTSController';
import { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import { recordMeasuredDuration } from '@/services/tts/ttsDuration';
import { FoliateView } from '@/types/view';

// --- Heavy clients replaced with light fakes (same pattern as the main
// controller suite); foliate tts.js provides a REAL-shaped getSentences fake
// that yields ranges from a jsdom document.

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
    wordBoundaries: true,
    mediaClock: true,
    gapControl: true,
    liveRateChange: false,
  }),
  getVoiceId: vi.fn().mockReturnValue('timeline-ctrl-voice'),
  getSpeakingLang: vi.fn().mockReturnValue('en'),
  getChunkPosition: vi.fn().mockReturnValue(0.5),
});

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, makeMockClient('web-speech'));
  }),
}));

vi.mock('@/services/tts/EdgeTTSClient', () => ({
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

vi.mock('foliate-js/overlayer.js', () => ({
  Overlayer: { highlight: 'highlightFn' },
}));

// Sentences of the fake section; ends avoid foliate's short-word
// abbreviation merge so counts stay predictable.
const S0 = 'The opening sentence of the chapter reads aloud smoothly.';
const S1 = 'A following sentence continues the passage without pause.';
const S2 = 'The final sentence wraps the paragraph completely together.';

let sectionDoc: Document;
let sentenceRanges: Range[] = [];

const buildSectionDoc = () => {
  const parser = new DOMParser();
  sectionDoc = parser.parseFromString(
    `<!DOCTYPE html><html lang="en"><body><p id="p">${S0} ${S1} ${S2}</p></body></html>`,
    'text/html',
  );
  const textNode = sectionDoc.getElementById('p')!.firstChild!;
  const full = textNode.textContent!;
  sentenceRanges = [S0, S1, S2].map((s) => {
    const start = full.indexOf(s);
    const range = sectionDoc.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + s.length);
    return range;
  });
};

vi.mock('foliate-js/tts.js', () => ({
  TTS: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, {
      start: vi.fn().mockReturnValue('<speak>hello</speak>'),
      resume: vi.fn().mockReturnValue('<speak>hello</speak>'),
      // End-of-section after one paragraph so auto-advance terminates instead
      // of looping the controller forever in tests.
      next: vi.fn().mockReturnValue(undefined),
      prev: vi.fn().mockReturnValue(undefined),
      from: vi.fn().mockReturnValue('<speak>from</speak>'),
      setMark: vi.fn().mockImplementation(() => sentenceRanges[0]!.cloneRange()),
      getLastRange: vi.fn().mockImplementation(() => sentenceRanges[0]!.cloneRange()),
      doc: null,
    });
  }),
  getSentences: vi.fn().mockImplementation(function* () {
    for (let i = 0; i < sentenceRanges.length; i++) {
      yield { blockIndex: 0, markName: String(i), range: sentenceRanges[i]! };
    }
  }),
}));

vi.mock('foliate-js/text-walker.js', () => ({ textWalker: vi.fn() }));

vi.mock('@/utils/ssml', () => ({
  filterSSMLWithLang: vi.fn((ssml: string) => ssml),
  parseSSMLMarks: vi.fn(() => ({
    plainText: 'hello',
    marks: [{ offset: 0, name: '0', text: 'hello', language: 'en' }],
  })),
}));

vi.mock('@/utils/node', () => ({ createRejectFilter: vi.fn(() => () => 1) }));
vi.mock('@/utils/lang', () => ({
  isValidLang: vi.fn(() => true),
  isCJKLang: vi.fn(() => false),
}));

const makeView = () => {
  const contents = {
    doc: sectionDoc,
    index: 0,
    overlayer: { add: vi.fn(), remove: vi.fn() },
  };
  return {
    book: { sections: [{ createDocument: vi.fn().mockResolvedValue(sectionDoc) }] },
    renderer: { getContents: () => [contents], primaryIndex: 0 },
    language: { isCJK: false },
    getCFI: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2)'),
    resolveCFI: vi.fn().mockReturnValue({ anchor: () => sentenceRanges[0] }),
    tts: null,
  } as unknown as FoliateView;
};

describe('TTSController section timeline', () => {
  let controller: TTSController;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    buildSectionDoc();
    controller = new TTSController(null, makeView());
    await controller.init();
    await controller.initViewTTS(0);
  });

  test('ensureTimeline builds lazily for the edge client and caches per section', async () => {
    const timeline = await controller.ensureTimeline();
    expect(timeline).not.toBeNull();
    expect(timeline!.length).toBe(3);
    expect(await controller.ensureTimeline()).toBe(timeline);
  });

  test('getPlaybackInfo composes sentence position with the chunk clock', async () => {
    recordMeasuredDuration('timeline-ctrl-voice', S0, 4);
    recordMeasuredDuration('timeline-ctrl-voice', S1, 6);
    await controller.ensureTimeline();
    // getLastRange resolves to sentence 0; client chunk position is 0.5s.
    const info = controller.getPlaybackInfo();
    expect(info).not.toBeNull();
    expect(info!.position).toBeCloseTo(0.5, 5);
    expect(info!.duration).toBeGreaterThan(10);
    expect(info!.measuredFraction).toBeGreaterThan(0);
  });

  test('getPlaybackInfo is null before the timeline is built (reserved-slot state)', () => {
    expect(controller.getPlaybackInfo()).toBeNull();
  });

  test('getPlaybackInfo is null for non-edge clients', async () => {
    await controller.setVoice('', 'en'); // empty voice id: falls through to web client
    controller.ttsClient = controller.ttsWebClient;
    expect(await controller.ensureTimeline()).toBeNull();
    expect(controller.getPlaybackInfo()).toBeNull();
  });

  test('seekToTime snaps to the sentence and speaks from its range while playing', async () => {
    recordMeasuredDuration('timeline-ctrl-voice', S0, 4);
    recordMeasuredDuration('timeline-ctrl-voice', S1, 6);
    await controller.ensureTimeline();
    controller.state = 'playing';
    await controller.seekToTime(5); // inside sentence 1
    const tts = controller.view.tts as unknown as { from: ReturnType<typeof vi.fn> };
    expect(tts.from).toHaveBeenCalledTimes(1);
    const arg = tts.from.mock.calls[0]![0] as Range;
    expect(arg.toString()).toBe(S1);
  });

  test('seekToTime while paused stays paused and still navigates', async () => {
    await controller.ensureTimeline();
    controller.state = 'paused';
    await controller.seekToTime(0);
    expect(controller.state).toBe('forward-paused');
    const tts = controller.view.tts as unknown as { from: ReturnType<typeof vi.fn> };
    expect(tts.from).toHaveBeenCalled();
  });

  test('seekToTime past the end clamps to the last sentence', async () => {
    await controller.ensureTimeline();
    controller.state = 'playing';
    await controller.seekToTime(9999);
    const tts = controller.view.tts as unknown as { from: ReturnType<typeof vi.fn> };
    const arg = tts.from.mock.calls[0]![0] as Range;
    expect(arg.toString()).toBe(S2);
  });

  test('setRate rescales the timeline', async () => {
    recordMeasuredDuration('timeline-ctrl-voice', S0, 4);
    recordMeasuredDuration('timeline-ctrl-voice', S1, 4);
    recordMeasuredDuration('timeline-ctrl-voice', S2, 4);
    const timeline = await controller.ensureTimeline();
    const before = timeline!.getDuration();
    await controller.setRate(2);
    expect(timeline!.getDuration()).toBeCloseTo(before / 2, 5);
  });

  test('shutdown drops the timeline', async () => {
    await controller.ensureTimeline();
    await controller.shutdown();
    expect(controller.getPlaybackInfo()).toBeNull();
  });
});
