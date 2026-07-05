import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TTSController } from '@/services/tts/TTSController';
import { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import { FoliateView } from '@/types/view';

// Detach/attach suite: headless operation guards, swap-time re-seed, and
// attach-epoch cancellation.

const makeMockClient = (name: string): TTSClient => ({
  name,
  initialized: true,
  init: vi.fn().mockResolvedValue(true),
  shutdown: vi.fn().mockResolvedValue(undefined),
  speak: vi.fn().mockImplementation(async function* (): AsyncIterable<TTSMessageEvent> {
    yield { code: 'boundary', message: 'chunk', mark: '0' };
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
  supportsWordBoundaries: vi.fn().mockReturnValue(false),
  getVoiceId: vi.fn().mockReturnValue('detach-voice'),
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

interface MockTtsInstance {
  start: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  next: ReturnType<typeof vi.fn>;
  prev: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  setMark: ReturnType<typeof vi.fn>;
  getLastRange: ReturnType<typeof vi.fn>;
  doc: Document | null;
}
const mockTtsInstances: MockTtsInstance[] = [];
let ttsNextReturns: (string | undefined)[] = [];

vi.mock('foliate-js/tts.js', () => ({
  TTS: vi.fn().mockImplementation(function (this: Record<string, unknown>, doc: Document) {
    const instance = {
      start: vi.fn().mockReturnValue('<speak>hello</speak>'),
      resume: vi.fn().mockReturnValue('<speak>hello</speak>'),
      next: vi.fn().mockImplementation(() => ttsNextReturns.shift()),
      prev: vi.fn().mockReturnValue(undefined),
      from: vi.fn().mockReturnValue('<speak>from</speak>'),
      setMark: vi.fn().mockImplementation(() => new Range()),
      getLastRange: vi.fn().mockReturnValue(undefined),
      doc,
    };
    Object.assign(this, instance);
    mockTtsInstances.push(instance);
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

interface ViewOptions {
  createDocument?: () => Promise<Document>;
  rendered?: boolean;
}

const makeView = (options: ViewOptions = {}): { view: FoliateView; overlayer: unknown } => {
  const doc = document.implementation.createHTMLDocument('section');
  const overlayer = { add: vi.fn(), remove: vi.fn() };
  const view = {
    book: {
      sections: [
        { createDocument: options.createDocument ?? vi.fn().mockResolvedValue(doc) },
        { createDocument: vi.fn().mockResolvedValue(doc) },
      ],
    },
    renderer: {
      getContents: () => (options.rendered === false ? [] : [{ doc, index: 0, overlayer }]),
      primaryIndex: 0,
    },
    language: { isCJK: false },
    getCFI: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2)'),
    resolveCFI: vi.fn().mockImplementation(() => ({ index: 0, anchor: () => new Range() })),
    tts: null,
  } as unknown as FoliateView;
  return { view, overlayer };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TTSController detach/attach', () => {
  let controller: TTSController;
  let view: FoliateView;
  let onSectionChange: ReturnType<typeof vi.fn<(sectionIndex: number) => Promise<void>>>;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockTtsInstances.length = 0;
    ttsNextReturns = [];
    onSectionChange = vi.fn<(sectionIndex: number) => Promise<void>>().mockResolvedValue(undefined);
    ({ view } = makeView());
    controller = new TTSController(null, view, false, undefined, onSectionChange);
    await controller.init();
    await controller.initViewTTS(0);
  });

  test('starts attached; detachView flips the flag idempotently', () => {
    expect(controller.isViewAttached).toBe(true);
    controller.detachView();
    expect(controller.isViewAttached).toBe(false);
    expect(() => controller.detachView()).not.toThrow();
  });

  test('detached playback advances without touching layout or dead callbacks', async () => {
    const preprocess = vi.fn(async (ssml: string) => ssml);
    controller.preprocessCallback = preprocess;
    const positions: string[] = [];
    controller.addEventListener('tts-position', (e) => {
      positions.push((e as CustomEvent).detail.cfi);
    });

    controller.detachView();
    ttsNextReturns = ['<speak>next</speak>'];
    controller.state = 'playing';
    await controller.forward();
    await flush();

    expect(mockTtsInstances[0]!.next).toHaveBeenCalled();
    // Dead-hook closures are severed at detach.
    expect(preprocess).not.toHaveBeenCalled();
    expect(onSectionChange).not.toHaveBeenCalled();
    // Position events keep flowing for persistence/lock-screen.
    expect(positions.length).toBeGreaterThan(0);
  });

  test('attachView swaps to a new view: re-seeds, rebinds, invalidates timeline', async () => {
    controller.detachView();

    // The old instance's cursor is the seed source.
    const oldRange = new Range();
    mockTtsInstances[0]!.getLastRange.mockReturnValue(oldRange);

    const { view: newView } = makeView();
    const anchored = new Range();
    (newView.resolveCFI as ReturnType<typeof vi.fn>).mockReturnValue({
      index: 0,
      anchor: () => anchored,
    });
    const newPreprocess = vi.fn(async (ssml: string) => ssml);
    const newSectionChange = vi.fn().mockResolvedValue(undefined);

    await controller.attachView(newView, {
      bookKey: 'hash-new123',
      preprocessCallback: newPreprocess,
      onSectionChange: newSectionChange,
    });

    expect(controller.isViewAttached).toBe(true);
    expect(controller.view).toBe(newView);
    expect(mockTtsInstances).toHaveLength(2);
    const newTts = mockTtsInstances[1]!;
    // Seeded at the old cursor, anchored into the NEW doc, SSML discarded.
    expect(newTts.from).toHaveBeenCalledWith(anchored);
    expect(controller.ttsClient.speak).not.toHaveBeenCalled();
    // The mirror points at the new instance.
    expect(newView.tts).toBeTruthy();
    expect(controller.preprocessCallback).toBe(newPreprocess);
    expect(controller.onSectionChange).toBe(newSectionChange);
  });

  test('attach re-seeds from the cursor position at swap time, not prep time', async () => {
    controller.detachView();

    const earlyRange = new Range();
    const lateRange = new Range();
    mockTtsInstances[0]!.getLastRange.mockReturnValue(earlyRange);

    // Gate the new view's section doc so prep stays in flight.
    let releaseDoc!: (doc: Document) => void;
    const gated = new Promise<Document>((resolve) => {
      releaseDoc = resolve;
    });
    const { view: newView } = makeView({ createDocument: () => gated, rendered: false });
    const anchorSpy = vi.fn().mockReturnValue(new Range());
    (newView.resolveCFI as ReturnType<typeof vi.fn>).mockReturnValue({
      index: 0,
      anchor: anchorSpy,
    });
    const getCFISpy = newView.getCFI as ReturnType<typeof vi.fn>;

    const attaching = controller.attachView(newView, { bookKey: 'hash-race' });
    await flush();
    // The old cursor advances while prep is in flight (paragraph auto-advance).
    mockTtsInstances[0]!.getLastRange.mockReturnValue(lateRange);
    releaseDoc(document.implementation.createHTMLDocument('late'));
    await attaching;

    // The CFI for the seed must be computed from the LATE range.
    const seedCall = getCFISpy.mock.calls.find(([, range]) => range === lateRange);
    expect(seedCall).toBeTruthy();
    expect(getCFISpy.mock.calls.some(([, range]) => range === earlyRange)).toBe(false);
  });

  test('detachView during attach prep cancels the attach', async () => {
    controller.detachView();

    let releaseDoc!: (doc: Document) => void;
    const gated = new Promise<Document>((resolve) => {
      releaseDoc = resolve;
    });
    const { view: newView } = makeView({ createDocument: () => gated, rendered: false });

    const attaching = controller.attachView(newView, { bookKey: 'hash-cancel' });
    await flush();
    controller.detachView(); // e.g. the new view closed while attach prepared
    releaseDoc(document.implementation.createHTMLDocument('stale'));
    await attaching;

    expect(controller.isViewAttached).toBe(false);
    expect(controller.view).not.toBe(newView);
    const staleInstance = mockTtsInstances[1];
    if (staleInstance) expect(staleInstance.from).not.toHaveBeenCalled();
  });
});
