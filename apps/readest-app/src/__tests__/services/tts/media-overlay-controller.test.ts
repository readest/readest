import { beforeEach, describe, expect, test, vi } from 'vitest';

import { TTSController } from '@/services/tts/TTSController';
import type { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import { MEDIA_OVERLAY_VOICE_ID } from '@/services/tts/mediaOverlay';
import type { FoliateView } from '@/types/view';

// Synthesis clients replaced with fakes; the narration client is the real one,
// since its selection and its effect on the mark source are what's under test.
const makeMockClient = (name: string, mediaClock: boolean): TTSClient => ({
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
  getVoices: vi.fn().mockResolvedValue([{ id: name, name, voices: [] }]),
  getGranularities: vi.fn().mockReturnValue(['sentence']),
  getCapabilities: vi.fn().mockReturnValue({
    wordBoundaries: false,
    mediaClock,
    gapControl: false,
    liveRateChange: false,
  }),
  getVoiceId: vi.fn().mockReturnValue(name),
  getSpeakingLang: vi.fn().mockReturnValue('en'),
});

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, makeMockClient('web-speech', false));
  }),
}));
vi.mock('@/services/tts/EdgeTTSClient', () => ({
  DEFAULT_SENTENCE_GAP_SEC: 0.15,
  EdgeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, makeMockClient('edge-tts', true));
  }),
}));
vi.mock('@/services/tts/NativeTTSClient', () => ({
  NativeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, makeMockClient('native-tts', false));
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
vi.mock('foliate-js/text-walker.js', () => ({ textWalker: vi.fn() }));
vi.mock('foliate-js/tts.js', () => ({
  TTS: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, {
      start: vi.fn().mockReturnValue('<speak>text-source</speak>'),
      resume: vi.fn().mockReturnValue('<speak>text-source</speak>'),
      next: vi.fn().mockReturnValue(undefined),
      prev: vi.fn().mockReturnValue(undefined),
      from: vi.fn().mockReturnValue('<speak>text-source</speak>'),
      setMark: vi.fn(),
      getLastRange: vi.fn(),
      doc: null,
    });
  }),
  getSentences: vi.fn().mockImplementation(function* () {}),
}));

const par = (id: string, begin: number, end: number) =>
  `<par><text src="ch.xhtml#${id}"/><audio src="ch.mp3" clipBegin="${begin}s" clipEnd="${end}s"/></par>`;

const SMIL = `<smil xmlns="http://www.w3.org/ns/SMIL"><body>${par('s1', 0, 3) + par('s2', 3, 7)}</body></smil>`;
const HTML = '<p id="s1">First narrated sentence.</p><p id="s2">Second narrated sentence.</p>';

const makeDoc = (html = HTML) =>
  new DOMParser().parseFromString(
    `<!DOCTYPE html><html lang="en"><body>${html}</body></html>`,
    'text/html',
  );

// `overlays` marks which spine sections carry a Media Overlay.
const makeView = (overlays: boolean[], docs?: Document[]) => {
  const sectionDocs = docs ?? overlays.map(() => makeDoc());
  const sections = overlays.map((hasOverlay, index) => ({
    id: `s${index}`,
    createDocument: vi.fn().mockResolvedValue(sectionDocs[index]),
    mediaOverlay: hasOverlay ? { href: 'OEBPS/ch.smil', id: `smil${index}` } : null,
  }));
  return {
    book: {
      sections,
      media: { narrator: 'Jane Reader' },
      loadText: vi.fn(async () => SMIL),
      loadBlob: vi.fn(async () => new Blob([new Uint8Array(4)])),
    },
    renderer: { getContents: () => [], primaryIndex: 0 },
    language: { isCJK: false, canonical: 'en' },
    getCFI: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2)'),
    resolveCFI: vi.fn().mockReturnValue({ anchor: () => null }),
    tts: null,
  } as unknown as FoliateView;
};

// Books without loadText/loadBlob (i.e. non-EPUB) can never be narrated.
const makePlainView = () => {
  const view = makeView([false]);
  (view.book as { loadText?: unknown }).loadText = undefined;
  (view.book as { loadBlob?: unknown }).loadBlob = undefined;
  return view;
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'Audio',
    class {
      addEventListener() {}
      removeEventListener() {}
      pause() {}
      async play() {}
    },
  );
  URL.createObjectURL = vi.fn(() => 'blob:audio') as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
});

describe('narration selection', () => {
  test('a book with recorded narration is read by its narrator, not synthesized', async () => {
    const controller = new TTSController(null, makeView([true]));
    await controller.init();

    expect(controller.narrationAvailable).toBe(true);
    expect(controller.narrationActive).toBe(true);
    expect(controller.ttsClient).toBe(controller.ttsMediaOverlayClient);
  });

  test('the per-book opt-out keeps synthesis even when narration exists', async () => {
    const controller = new TTSController(null, makeView([true]));
    controller.useNarration = false;
    await controller.init();

    expect(controller.narrationAvailable).toBe(true);
    expect(controller.narrationActive).toBe(false);
    expect(controller.ttsClient).toBe(controller.ttsEdgeClient);
  });

  test('a book without overlays is unaffected and keeps the preferred client', async () => {
    const controller = new TTSController(null, makeView([false, false]));
    await controller.init();

    expect(controller.narrationAvailable).toBe(false);
    expect(controller.narrationActive).toBe(false);
    expect(controller.ttsClient).toBe(controller.ttsEdgeClient);
  });

  test('a format that cannot read its own container offers no narration', async () => {
    const controller = new TTSController(null, makePlainView());
    await controller.init();

    expect(controller.narrationAvailable).toBe(false);
    expect(controller.ttsClient).toBe(controller.ttsEdgeClient);
  });

  test('the narrator leads the voice list, and only for narrated books', async () => {
    const narrated = new TTSController(null, makeView([true]));
    await narrated.init();
    const groups = await narrated.getVoices('en');
    expect(groups[0]!.voices[0]).toMatchObject({ id: MEDIA_OVERLAY_VOICE_ID, name: 'Jane Reader' });

    const plain = new TTSController(null, makeView([false]));
    await plain.init();
    const plainGroups = await plain.getVoices('en');
    expect(plainGroups.some((g) => g.voices.some((v) => v.id === MEDIA_OVERLAY_VOICE_ID))).toBe(
      false,
    );
  });

  test('picking a synthetic voice leaves narration, and picking the narrator returns to it', async () => {
    const controller = new TTSController(null, makeView([true]));
    await controller.init();
    await controller.initViewTTS(0);
    expect(controller.narrationActive).toBe(true);

    const invalidate = vi.spyOn(controller.ttsMediaOverlayClient, 'invalidatePlayback');

    await controller.setVoice('edge-tts', 'en');
    expect(controller.narrationActive).toBe(false);
    expect(controller.useNarration).toBe(false);
    expect(invalidate).toHaveBeenCalled();

    invalidate.mockClear();
    await controller.setVoice(MEDIA_OVERLAY_VOICE_ID, 'en');
    expect(controller.narrationActive).toBe(true);
    expect(controller.useNarration).toBe(true);
    // Returning must invalidate again: Edge may have aborted the shared player.
    expect(invalidate).toHaveBeenCalled();
  });
});

describe('narration mark source and timeline', () => {
  test('the section is driven by SMIL pars, with the recording as the clock', async () => {
    const controller = new TTSController(null, makeView([true]));
    await controller.init();
    await controller.initViewTTS(0);

    // Marks are par ordinals, so the SSML comes from the overlay, not foliate.
    expect(controller.view.tts!.start()).toContain('<mark name="0"/>');
    expect(controller.supportsPlaybackInfo()).toBe(true);
  });

  test('the timeline uses the recording exact durations, needing no estimates', async () => {
    const controller = new TTSController(null, makeView([true]));
    await controller.init();
    await controller.initViewTTS(0);

    const timeline = await controller.ensureTimeline();
    expect(timeline).not.toBeNull();
    expect(timeline!.length).toBe(2);
    // 3s + 4s of narration, reported as fully measured.
    expect(timeline!.getDuration()).toBeCloseTo(7, 5);
    expect(timeline!.getMeasuredFraction()).toBeCloseTo(1, 5);
  });

  test('synthesis still uses foliate segmentation for the same book', async () => {
    const controller = new TTSController(null, makeView([true]));
    controller.useNarration = false;
    await controller.init();
    await controller.initViewTTS(0);

    expect(controller.view.tts!.start()).toBe('<speak>text-source</speak>');
  });
});

describe('unnarrated sections', () => {
  test('playback starts at the first narrated section, skipping front matter', async () => {
    const controller = new TTSController(null, makeView([false, false, true]));
    await controller.init();
    await controller.initViewTTS(0);

    expect(controller.view.tts!.start()).toContain('<mark name="0"/>');
    expect(controller.view.book.sections[2]!.createDocument).toHaveBeenCalled();
    expect(controller.view.book.sections[0]!.createDocument).not.toHaveBeenCalled();
  });

  test('a book with overlays everywhere but the target still finds nothing after it', async () => {
    const controller = new TTSController(null, makeView([true, false]));
    await controller.init();
    await controller.initViewTTS(1);

    // Nothing narrated at or after section 1: no source is built.
    expect(controller.view.tts).toBeNull();
  });

  test('a section whose SMIL yields nothing usable is treated as unnarrated', async () => {
    // Section 0 advertises an overlay but its pars point at absent ids.
    const docs = [makeDoc('<p id="other">Nothing the SMIL references.</p>'), makeDoc()];
    const view = makeView([true, true], docs);
    const controller = new TTSController(null, view);
    await controller.init();
    await controller.initViewTTS(0);

    expect(controller.view.tts!.start()).toContain('<mark name="0"/>');
    expect(view.book.sections[1]!.createDocument).toHaveBeenCalled();
  });
});
