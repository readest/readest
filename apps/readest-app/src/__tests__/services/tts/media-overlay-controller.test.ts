import { beforeEach, describe, expect, test, vi } from 'vitest';

import { TTSController } from '@/services/tts/TTSController';
import type { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import { MEDIA_OVERLAY_VOICE_ID } from '@/services/tts/mediaOverlay';
import { useABSServerStore } from '@/store/absServerStore';
import type { PairedAudiobook } from '@/types/book';
import type { AppService } from '@/types/system';
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

const PAIRED_AUDIOBOOK: PairedAudiobook = {
  version: 1,
  narrator: 'External Narrator',
  files: [{ id: 'audio-0', name: 'chapter.mp3', path: 'hash/audiobook/chapter.mp3', duration: 30 }],
  chapters: [{ id: 'audio-0:0', fileId: 'audio-0', label: 'Chapter 1', start: 0, end: 30 }],
  mappings: [{ ebookChapterId: 'chapter.xhtml', audioChapterId: 'audio-0:0' }],
  createdAt: 1,
};

// The same chapter, streamed from an Audiobookshelf item split across two files.
const ABS_PAIRED_AUDIOBOOK: PairedAudiobook = {
  version: 1,
  narrator: 'Server Narrator',
  files: [{ id: 'abs', name: 'Book', path: 'abs://srv1/item1', duration: 30 }],
  chapters: [{ id: 'abs:0', fileId: 'abs', label: 'Chapter 1', start: 0, end: 30 }],
  mappings: [{ ebookChapterId: 'chapter.xhtml', audioChapterId: 'abs:0' }],
  createdAt: 1,
  source: {
    kind: 'audiobookshelf',
    serverId: 'srv1',
    itemId: 'item1',
    tracks: [
      { index: 1, startOffset: 0, duration: 20, contentUrl: '/api/items/item1/file/1' },
      { index: 2, startOffset: 20, duration: 10, contentUrl: '/api/items/item1/file/2' },
    ],
  },
};

const makePairedView = () => {
  const docs = [makeDoc('<p>Front matter.</p>'), makeDoc('<h1>Chapter 1</h1><p>Text.</p>')];
  return {
    book: {
      toc: [{ id: 0, label: 'Chapter 1', href: 'chapter.xhtml', index: 0 }],
      sections: [
        { id: 'front.xhtml', createDocument: vi.fn().mockResolvedValue(docs[0]) },
        { id: 'chapter.xhtml', createDocument: vi.fn().mockResolvedValue(docs[1]) },
      ],
      splitTOCHref: (href: string) => href.split('#'),
    },
    renderer: { getContents: () => [], primaryIndex: 0 },
    language: { isCJK: false, canonical: 'en' },
    getCFI: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2)'),
    resolveCFI: vi.fn().mockReturnValue({ anchor: () => null }),
    tts: null,
  } as unknown as FoliateView;
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: { convertFileSrc: vi.fn((path: string) => `asset://${path}`) },
  });
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

  test('a paired audiobook is offered as narration without EPUB media overlays', async () => {
    const view = makePairedView();
    const appService = {
      openFile: vi.fn(async () => new File(['audio'], 'chapter.mp3')),
    } as unknown as AppService;
    const controller = new TTSController(appService, view);
    controller.pairedAudiobook = PAIRED_AUDIOBOOK;

    await controller.init();
    await controller.initViewTTS(0);

    expect(controller.narrationAvailable).toBe(true);
    expect(controller.narrationActive).toBe(true);
    expect(view.book.sections[0]!.createDocument).not.toHaveBeenCalled();
    expect(view.book.sections[1]!.createDocument).toHaveBeenCalled();
    expect(view.tts!.start()).toContain('<mark name="0"/>');
    expect((await controller.getVoices('en'))[0]!.voices[0]!.name).toBe('External Narrator');
  });

  test('streams a paired audiobook from a direct asset URL on desktop Tauri', async () => {
    const view = makePairedView();
    const appService = {
      appPlatform: 'tauri',
      isMobileApp: false,
      openFile: vi.fn(async () => new File(['audio'], 'chapter.mp3')),
      resolveFilePath: vi.fn(async () => '/books/hash/audiobook/chapter.mp3'),
    } as unknown as AppService;
    const controller = new TTSController(appService, view);
    controller.pairedAudiobook = PAIRED_AUDIOBOOK;
    const attachSource = vi.spyOn(controller.ttsMediaOverlayClient, 'attachSource');

    await controller.init();

    const source = attachSource.mock.calls.at(-1)?.[0];
    await expect(source?.resolveUrl?.(PAIRED_AUDIOBOOK.files[0]!.path)).resolves.toBe(
      'asset:///books/hash/audiobook/chapter.mp3',
    );
    expect(appService.resolveFilePath).toHaveBeenCalledWith(
      PAIRED_AUDIOBOOK.files[0]!.path,
      'Books',
    );
    expect(appService.openFile).not.toHaveBeenCalled();
  });

  test('streams an Audiobookshelf pairing as tokened track URLs on one timeline', async () => {
    useABSServerStore.setState({
      servers: [{ id: 'srv1', name: 'Home', url: 'http://abs.local/', accessToken: 'tok-1' }],
    });
    const view = makePairedView();
    const appService = {
      appPlatform: 'tauri',
      isMobileApp: true,
      openFile: vi.fn(),
      resolveFilePath: vi.fn(),
    } as unknown as AppService;
    const controller = new TTSController(appService, view);
    controller.pairedAudiobook = ABS_PAIRED_AUDIOBOOK;
    const attachSource = vi.spyOn(controller.ttsMediaOverlayClient, 'attachSource');

    await controller.init();
    await controller.initViewTTS(0);

    expect(controller.narrationAvailable).toBe(true);
    expect((await controller.getVoices('en'))[0]!.voices[0]!.name).toBe('Server Narrator');
    const source = attachSource.mock.calls.at(-1)?.[0];
    expect(source?.textHighlight).toBe(false);
    await expect(source?.resolveTracks?.('abs://srv1/item1')).resolves.toEqual([
      { url: 'http://abs.local/api/items/item1/file/1?token=tok-1', startOffset: 0, duration: 20 },
      { url: 'http://abs.local/api/items/item1/file/2?token=tok-1', startOffset: 20, duration: 10 },
    ]);
    // The token is read per call, so a rotation is picked up by the next load.
    useABSServerStore.getState().updateServer('srv1', { accessToken: 'tok-2' });
    await expect(source?.resolveTracks?.('abs://srv1/item1')).resolves.toMatchObject([
      { url: 'http://abs.local/api/items/item1/file/1?token=tok-2' },
      { url: 'http://abs.local/api/items/item1/file/2?token=tok-2' },
    ]);
    // Nothing local exists to open or resolve for a streamed pairing.
    expect(appService.openFile).not.toHaveBeenCalled();
    expect(appService.resolveFilePath).not.toHaveBeenCalled();
    useABSServerStore.setState({ servers: [] });
  });

  test('a streamed pairing whose server was removed cannot load audio', async () => {
    useABSServerStore.setState({ servers: [] });
    const controller = new TTSController({} as AppService, makePairedView());
    controller.pairedAudiobook = ABS_PAIRED_AUDIOBOOK;
    const attachSource = vi.spyOn(controller.ttsMediaOverlayClient, 'attachSource');

    await controller.init();

    const source = attachSource.mock.calls.at(-1)?.[0];
    await expect(source?.resolveTracks?.('abs://srv1/item1')).resolves.toBeNull();
    await expect(source?.loadBlob('abs://srv1/item1')).rejects.toThrow(/server not found/i);
  });

  test('starts paired narration at the current text position without drawing a chapter highlight', async () => {
    const view = makePairedView();
    const appService = {
      openFile: vi.fn(async () => new File(['audio'], 'chapter.mp3')),
      resolveFilePath: vi.fn(async () => '/books/chapter.mp3'),
    } as unknown as AppService;
    const controller = new TTSController(appService, view);
    controller.pairedAudiobook = PAIRED_AUDIOBOOK;
    await controller.init();
    await controller.initViewTTS(0);

    const doc = view.tts!.doc;
    const text = doc.querySelector('p')!.firstChild as Text;
    const page = doc.createRange();
    page.setStart(text, 2);
    page.setEnd(text, text.length);
    const setStart = vi.spyOn(controller.ttsMediaOverlayClient, 'setNextChunkPosition');
    const overlayer = { remove: vi.fn(), add: vi.fn() };
    (
      view.renderer as unknown as { getContents: () => unknown[]; primaryIndex: number }
    ).getContents = () => [{ doc, index: 1, overlayer }];
    (view.renderer as unknown as { primaryIndex: number }).primaryIndex = 1;
    view.getCFI = vi.fn((_index: number, range?: Range) => `cfi:${range?.toString() ?? ''}`);

    expect(controller.startFromRange(page)).toContain('<mark name="0"/>');
    expect(setStart).toHaveBeenCalledOnce();
    expect(setStart.mock.calls[0]![0]).toBeGreaterThan(0);

    const location = vi.fn();
    controller.addEventListener('tts-highlight-mark', location);
    controller.dispatchSpeakMark({ offset: 0, name: '0', text: 'Chapter', language: 'en' });

    expect(overlayer.add).not.toHaveBeenCalled();
    expect((location.mock.calls[0]![0] as CustomEvent).detail.cfi).not.toContain('Chapter 1Text.');
    vi.spyOn(controller.ttsMediaOverlayClient, 'getChunkProgress').mockReturnValue(0.75);
    expect(controller.getCurrentPlaybackCfi()).toMatch(/^cfi:.$/);
    expect(controller.isSoundingSentenceOnScreen()).toBe(false);
  });

  test('gives page-follow the whole chapter range, not the one-character reading position', async () => {
    const view = makePairedView();
    const appService = {
      openFile: vi.fn(async () => new File(['audio'], 'chapter.mp3')),
      resolveFilePath: vi.fn(async () => '/books/chapter.mp3'),
    } as unknown as AppService;
    const controller = new TTSController(appService, view);
    controller.pairedAudiobook = PAIRED_AUDIOBOOK;
    await controller.init();
    await controller.initViewTTS(0);

    const doc = view.tts!.doc;
    (
      view.renderer as unknown as { getContents: () => unknown[]; primaryIndex: number }
    ).getContents = () => [{ doc, index: 1, overlayer: { remove: vi.fn(), add: vi.fn() } }];
    (view.renderer as unknown as { primaryIndex: number }).primaryIndex = 1;
    view.getCFI = vi.fn((_index: number, range?: Range) => `cfi:${range?.toString() ?? ''}`);

    const marks: CustomEvent[] = [];
    controller.addEventListener('tts-highlight-mark', (e) => marks.push(e as CustomEvent));
    controller.dispatchSpeakMark({ offset: 0, name: '0', text: 'Chapter', language: 'en' });

    const detail = marks[0]!.detail as { cfi: string; sentenceCfi?: string };
    // The reading dot is one character; a chapter-only pairing has no finer
    // text timing.
    expect(detail.cfi).toMatch(/^cfi:.$/);
    // Page-follow needs the whole chapter's extent to know where the page cuts
    // it off, so the mark carries that separately.
    expect(detail.sentenceCfi).toContain('Chapter 1Text.');
    expect(detail.sentenceCfi).not.toBe(detail.cfi);
  });

  test('keeps paired-audiobook scrubber preview and seek aligned with the audio offset', async () => {
    const view = makePairedView();
    const appService = {
      openFile: vi.fn(async () => new File(['audio'], 'chapter.mp3')),
      resolveFilePath: vi.fn(async () => '/books/chapter.mp3'),
    } as unknown as AppService;
    const controller = new TTSController(appService, view);
    controller.pairedAudiobook = PAIRED_AUDIOBOOK;
    view.getCFI = vi.fn((_index: number, range?: Range) => `cfi:${range?.toString() ?? ''}`);
    await controller.init();
    await controller.initViewTTS(0);
    await controller.ensureTimeline();
    controller.dispatchSpeakMark({ offset: 0, name: '0', text: 'Chapter 1', language: 'en' });

    const locations: { cfi: string; preview?: boolean }[] = [];
    controller.addEventListener('tts-highlight-mark', (event) => {
      locations.push((event as CustomEvent<{ cfi: string; preview?: boolean }>).detail);
    });
    controller.previewSeekTime(15);

    const seekWithin = vi
      .spyOn(controller.ttsMediaOverlayClient, 'seekToChunkPosition')
      .mockResolvedValue(true);
    await controller.seekToTime(20);

    expect(locations).toHaveLength(2);
    expect(locations[0]!.preview).toBe(true);
    expect(locations[0]!.cfi).toMatch(/^cfi:.$/);
    expect(locations[1]!.preview).toBeUndefined();
    expect(locations[1]!.cfi).toMatch(/^cfi:.$/);
    expect(seekWithin).toHaveBeenCalledWith(20);
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

  test('seeks inside the active narration clip instead of restarting it', async () => {
    const controller = new TTSController(null, makeView([true]));
    await controller.init();
    await controller.initViewTTS(0);
    await controller.ensureTimeline();
    controller.dispatchSpeakMark({ offset: 0, name: '0', text: 'First', language: 'en' });
    const seekWithin = vi
      .spyOn(controller.ttsMediaOverlayClient, 'seekToChunkPosition')
      .mockResolvedValue(true);
    const stop = vi.spyOn(controller.ttsMediaOverlayClient, 'stop');

    await controller.seekToTime(2);

    expect(seekWithin).toHaveBeenCalledWith(2);
    expect(stop).not.toHaveBeenCalled();
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
