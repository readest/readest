import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TTSController } from '@/services/tts/TTSController';
import { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import { transformTTSSectionDocument } from '@/services/tts/transformDoc';
import { FoliateView } from '@/types/view';

// #5406: TTS must read the same transformed content the display shows.
// Sections that are not currently rendered used to be read through
// section.createDocument(), which parses the raw resource and bypasses the
// loader 'data' event where display transformers (proofread, simplecc, ...)
// run. Speech then diverged from the displayed text and highlight offsets
// drifted once a proofread rule added or deleted text.

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
  getVoiceId: vi.fn().mockReturnValue('doc-sync-voice'),
  getSpeakingLang: vi.fn().mockReturnValue('en'),
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
vi.mock('foliate-js/overlayer.js', () => ({ Overlayer: { highlight: 'highlightFn' } }));

// Capture the document each foliate TTS instance is constructed over: that is
// the document whose text gets spoken.
const ttsCtorDocs: Document[] = [];
vi.mock('foliate-js/tts.js', () => ({
  TTS: vi.fn().mockImplementation(function (this: Record<string, unknown>, doc: Document) {
    ttsCtorDocs.push(doc);
    Object.assign(this, {
      start: vi.fn().mockReturnValue('<speak>hello</speak>'),
      resume: vi.fn().mockReturnValue('<speak>hello</speak>'),
      next: vi.fn().mockReturnValue(undefined),
      prev: vi.fn().mockReturnValue(undefined),
      from: vi.fn().mockReturnValue('<speak>from</speak>'),
      setMark: vi.fn().mockReturnValue(undefined),
      getLastRange: vi.fn().mockReturnValue(undefined),
      doc,
    });
  }),
  getSentences: vi.fn().mockImplementation(function* () {}),
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

const parseXhtml = (body: string) =>
  new DOMParser().parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`,
    'application/xhtml+xml',
  );

// Mirrors FoliateViewer's getDocTransformHandler contract: replace detail.data
// with a promise of the transformed markup, or '' on error.
const attachDisplayTransform = (target: EventTarget, replace: (content: string) => string) => {
  const seen: { name?: string; type?: string }[] = [];
  target.addEventListener('data', (event) => {
    const detail = (event as CustomEvent).detail;
    seen.push({ name: detail.name, type: detail.type });
    detail.data = Promise.resolve(detail.data).then((data: string) => replace(data));
  });
  return seen;
};

describe('transformTTSSectionDocument', () => {
  test('returns the input document when the book has no transformTarget', async () => {
    const doc = parseXhtml('<p>proofread me please</p>');
    const out = await transformTTSSectionDocument({}, 'sec.xhtml', doc);
    expect(out).toBe(doc);
  });

  test('applies the display transform pipeline to the section document', async () => {
    const transformTarget = new EventTarget();
    const seen = attachDisplayTransform(transformTarget, (content) =>
      content.replace('proofread me please', 'corrected text'),
    );
    const doc = parseXhtml('<p>proofread me please</p>');
    const out = await transformTTSSectionDocument({ transformTarget }, 'sec.xhtml', doc);
    expect(out).not.toBe(doc);
    expect(out.documentElement.textContent).toContain('corrected text');
    expect(out.documentElement.textContent).not.toContain('proofread me please');
    expect(seen[0]?.name).toBe('sec.xhtml');
    expect(seen[0]?.type).toBe('application/xhtml+xml');
  });

  test('falls back to the input document when the transform yields nothing', async () => {
    const transformTarget = new EventTarget();
    // FoliateViewer's handler resolves to '' when a transformer throws.
    attachDisplayTransform(transformTarget, () => '');
    const doc = parseXhtml('<p>proofread me please</p>');
    const out = await transformTTSSectionDocument({ transformTarget }, 'sec.xhtml', doc);
    expect(out).toBe(doc);
  });

  test('returns the input document unchanged when no listener modifies the data', async () => {
    const doc = parseXhtml('<p>proofread me please</p>');
    const out = await transformTTSSectionDocument(
      { transformTarget: new EventTarget() },
      'sec.xhtml',
      doc,
    );
    expect(out).toBe(doc);
  });
});

interface RenderedContent {
  doc: Document;
  index: number;
  overlayer: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
}

const makeView = ({ withTransformTarget = true } = {}) => {
  const liveDoc0 = parseXhtml('<p>rendered section zero</p>');
  const contents: RenderedContent[] = [
    { doc: liveDoc0, index: 0, overlayer: { add: vi.fn(), remove: vi.fn() } },
  ];
  const transformTarget = new EventTarget();
  const view = {
    book: {
      ...(withTransformTarget ? { transformTarget } : {}),
      sections: [
        {
          id: 'sec0.xhtml',
          createDocument: vi.fn().mockResolvedValue(parseXhtml('<p>raw zero</p>')),
        },
        {
          id: 'sec1.xhtml',
          createDocument: vi.fn().mockResolvedValue(parseXhtml('<p>proofread me please</p>')),
        },
      ],
    },
    renderer: { getContents: () => contents, primaryIndex: 0 },
    language: { isCJK: false },
    getCFI: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2)'),
    resolveCFI: vi.fn().mockReturnValue({ anchor: () => new Range() }),
    tts: null,
  } as unknown as FoliateView;
  return { view, contents, transformTarget };
};

describe('TTSController proofread document sync', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    ttsCtorDocs.length = 0;
  });

  test('reads an unrendered section through the display transform pipeline', async () => {
    const { view, transformTarget } = makeView();
    attachDisplayTransform(transformTarget, (content) =>
      content.replace('proofread me please', 'corrected text'),
    );
    const controller = new TTSController(null, view);
    await controller.init();
    // Section 1 is not rendered (primary content is section 0) and there is
    // no onSectionChange navigation, so the doc must come from createDocument
    // plus the display transform.
    await controller.initViewTTS(1);
    const doc = ttsCtorDocs.at(-1)!;
    expect(doc.documentElement.textContent).toContain('corrected text');
    expect(doc.documentElement.textContent).not.toContain('proofread me please');
  });

  test('prefers the live rendered document after section navigation', async () => {
    const { view, contents } = makeView();
    const liveDoc1 = parseXhtml('<p>live transformed one</p>');
    const onSectionChange = vi.fn().mockImplementation(async (index: number) => {
      contents.length = 0;
      contents.push({ doc: liveDoc1, index, overlayer: { add: vi.fn(), remove: vi.fn() } });
    });
    const controller = new TTSController(null, view, false, undefined, onSectionChange);
    await controller.init();
    await controller.initViewTTS(1);
    expect(onSectionChange).toHaveBeenCalledWith(1);
    // The navigated-to view renders the transformed content; TTS must read
    // that exact document so highlights anchor into it by identity.
    expect(ttsCtorDocs.at(-1)).toBe(liveDoc1);
    expect(view.book.sections[1]!.createDocument).not.toHaveBeenCalled();
  });

  test('keeps the raw document when the book has no transform pipeline', async () => {
    const { view } = makeView({ withTransformTarget: false });
    const controller = new TTSController(null, view);
    await controller.init();
    await controller.initViewTTS(1);
    const doc = ttsCtorDocs.at(-1)!;
    expect(doc.documentElement.textContent).toContain('proofread me please');
  });
});
