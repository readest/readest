import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Dependency mocks (must be set up before importing the hook) ---

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: { isIOSApp: false, isMobile: false },
    envConfig: {},
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false }),
}));

const mockView = {
  book: { primaryLanguage: 'en', sections: [{ id: 0 }] },
  renderer: {
    getContents: () => [{ index: 0, doc: document as unknown as Document }],
    scrollToAnchor: vi.fn(),
    primaryIndex: 0,
    scrolled: false,
    nextSection: vi.fn(),
    start: 0,
    end: 0,
    sideProp: 'height',
    next: vi.fn(),
    goTo: vi.fn(),
  },
  resolveCFI: vi.fn().mockReturnValue({ index: 0, anchor: () => new Range() }),
  getCFI: vi.fn().mockReturnValue('cfi'),
  deselect: vi.fn(),
  resolveNavigation: vi.fn(),
  goTo: vi.fn(),
  history: { back: vi.fn(), forward: vi.fn() },
  tts: {
    from: vi.fn().mockReturnValue('<speak>hello</speak>'),
    start: vi.fn().mockReturnValue('<speak>hello</speak>'),
    getLastRange: vi.fn().mockReturnValue(null),
    highlight: vi.fn(),
  },
};

let mockProgress = {
  location: { start: { cfi: '' }, end: { cfi: '' } },
  index: 0,
  range: null as Range | null,
  sectionLabel: '',
};

const mockViewSettings = {
  ttsLocation: null as string | null,
  ttsRate: 1,
  ttsHighlightOptions: { style: 'highlight', color: '#ffff00' },
  isEink: false,
  ttsMediaMetadata: 'sentence',
  translationEnabled: false,
  ttsReadAloudText: 'source',
};

const mockBookData = {
  isFixedLayout: false,
  book: { primaryLanguage: 'en', title: 'T', author: 'A', coverImageUrl: '' },
};

vi.mock('@/store/readerStore', () => {
  const store = {
    hoveredBookKey: null,
    bookKeys: ['book-1'],
    getView: () => mockView,
    getProgress: () => mockProgress,
    getViewSettings: () => mockViewSettings,
    setViewSettings: vi.fn(),
    setTTSEnabled: vi.fn(),
  };
  // Production code uses per-field selectors; mock must apply them.
  const useReaderStore = <R,>(selector?: (s: typeof store) => R) =>
    selector ? selector(store) : store;
  useReaderStore.getState = () => store;
  return { useReaderStore };
});

vi.mock('@/store/bookDataStore', () => {
  const state = { getBookData: () => mockBookData };
  return {
    useBookDataStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});

// useTTSControl now reads progress reactively from readerProgressStore.
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => mockProgress,
  getBookProgress: () => mockProgress,
}));

vi.mock('@/store/proofreadStore', () => ({
  useProofreadStore: () => ({
    getMergedRules: () => [],
  }),
}));

vi.mock('@/services/transformers/proofread', () => ({
  proofreadTransformer: {
    transform: vi.fn(async (ctx: { content: string }) => ctx.content),
  },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

// Track TTSController instantiations — this is the assertion target.
const ttsControllerInstances: unknown[] = [];
// Gate init() calls so that handleTTSSpeak stays suspended inside an `await`.
// This is the exact point where a second concurrent invocation would otherwise
// race ahead and construct a second TTSController. The test releases all
// pending resolvers once both dispatches have had a chance to interleave.
const pendingInitResolvers: Array<() => void> = [];

vi.mock('@/services/tts', () => ({
  TTSController: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, {
      init: vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            pendingInitResolvers.push(() => resolve());
          }),
      ),
      initViewTTS: vi.fn().mockResolvedValue(undefined),
      updateHighlightOptions: vi.fn(),
      setHighlightGranularity: vi.fn(),
      setLang: vi.fn(),
      setRate: vi.fn(),
      setSentenceGap: vi.fn(),
      setParagraphGap: vi.fn(),
      supportsGapControl: vi.fn().mockReturnValue(false),
      setVoice: vi.fn(),
      setTargetLang: vi.fn(),
      speak: vi.fn(),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      forward: vi.fn().mockResolvedValue(undefined),
      backward: vi.fn().mockResolvedValue(undefined),
      getVoices: vi.fn().mockResolvedValue([]),
      getVoiceId: vi.fn().mockReturnValue(''),
      redispatchPosition: vi.fn(),
      ensureTimeline: vi.fn().mockResolvedValue(null),
      getPlaybackInfo: vi.fn().mockReturnValue(null),
      seekToTime: vi.fn().mockResolvedValue(undefined),
      detachView: vi.fn(),
      attachView: vi.fn().mockResolvedValue(undefined),
      getSpeakingLang: vi.fn().mockReturnValue('en'),
      getSentenceProgress: vi.fn().mockReturnValue(null),
      isSoundingSentenceOnScreen: vi.fn().mockReturnValue(false),
      getCurrentHighlightCfi: vi.fn().mockReturnValue(null),
      reapplyCurrentHighlight: vi.fn(),
      terminated: false,
      isViewAttached: true,
      narrationActive: narrationState.active,
      state: 'idle',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    ttsControllerInstances.push(this);
  }),
  ensureSharedAudioContext: vi.fn().mockResolvedValue(undefined),
}));

// jsdom reports every rect as zero, so the layout probe cannot answer here.
// What this suite covers is the follow loop; where the page break falls is
// covered by src/__tests__/utils/ttsPageFollow.test.ts.
vi.mock('@/utils/ttsPageFollow', () => ({
  pageBreakFraction: vi.fn(() => null),
}));

vi.mock('@/services/tts/wordHighlight', () => ({
  rangeTextExcludingInert: vi.fn(() => 'a sentence long enough to straddle a page break'),
  getTextSubRange: vi.fn(() => null),
}));

vi.mock('@/libs/mediaSession', () => ({
  TauriMediaSession: class {},
  getMediaSession: vi.fn(() => null),
}));

const { narrationState } = vi.hoisted(() => ({ narrationState: { active: false } }));

const { mockSessionManager } = vi.hoisted(() => ({
  mockSessionManager: {
    claim: vi.fn(),
    detach: vi.fn(),
    release: vi.fn(),
    adopt: vi.fn(),
    getSessionByHash: vi.fn((_hash: string) => null as unknown),
    getActiveSession: vi.fn(() => null as unknown),
    stopActive: vi.fn().mockResolvedValue(undefined),
    setSleepTimer: vi.fn(),
    getSleepTimer: vi.fn(() => null),
    setStopAtChapterEnd: vi.fn(),
    getStopAtChapterEnd: vi.fn(() => false),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
}));

vi.mock('@/services/tts/TTSSessionManager', () => ({
  getBookHashFromKey: (key: string) => key.split('-')[0]!,
  ttsSessionManager: mockSessionManager,
  TTS_STOP_AT_CHAPTER_END: -1,
}));

vi.mock('@/utils/ssml', () => ({
  genSSMLRaw: vi.fn((s: string) => `<speak>${s}</speak>`),
  parseSSMLLang: vi.fn(() => 'en'),
}));

vi.mock('@/utils/throttle', () => ({
  throttle: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock('@/utils/cfi', () => ({
  isCfiInLocation: () => false,
}));

vi.mock('@/utils/misc', () => ({
  getLocale: () => 'en',
  getOSPlatform: () => 'macos',
  stubTranslation: (key: string) => key,
}));

vi.mock('@/utils/ttsMetadata', () => ({
  buildTTSMediaMetadata: () => ({
    shouldUpdate: false,
    title: '',
    artist: '',
    album: '',
  }),
}));

vi.mock('@/utils/bridge', () => ({
  invokeUseBackgroundAudio: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/ttsTime', () => ({
  estimateTTSTime: () => ({
    chapterRemainingSec: 0,
    bookRemainingSec: 0,
    finishAtTimestamp: 0,
  }),
}));

// Imports must come AFTER vi.mock calls so they pick up the mocked modules.
import { useTTSControl } from '@/app/reader/hooks/useTTSControl';
import { ttsMediaBridge } from '@/services/tts/ttsMediaBridge';
import { eventDispatcher } from '@/utils/event';
import { pageBreakFraction } from '@/utils/ttsPageFollow';
import { useReaderStore } from '@/store/readerStore';

const getSetTTSEnabledMock = () =>
  (
    useReaderStore as unknown as {
      getState: () => { setTTSEnabled: ReturnType<typeof vi.fn> };
    }
  ).getState().setTTSEnabled;

const Harness = () => {
  useTTSControl({ bookKey: 'book-1' });
  return null;
};

describe('useTTSControl concurrent tts-speak events', () => {
  beforeEach(() => {
    ttsControllerInstances.length = 0;
    pendingInitResolvers.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it('creates only one TTSController when two tts-speak events fire back-to-back', async () => {
    render(<Harness />);

    await act(async () => {
      // Kick off both dispatches without awaiting — this models rapid clicks
      // where the second click arrives while the first is still inside its
      // initial awaits (initMediaSession / backgroundAudio / init()).
      const p1 = eventDispatcher.dispatch('tts-speak', { bookKey: 'book-1' });
      const p2 = eventDispatcher.dispatch('tts-speak', { bookKey: 'book-1' });

      // Let both invocations drain microtasks and reach their gated await.
      // Without the single-flight guard in handleTTSSpeak, both invocations
      // would construct a TTSController here and both would be queued in
      // pendingInitResolvers.
      for (let i = 0; i < 10; i++) await Promise.resolve();

      // The assertion that matters: exactly one controller was constructed.
      expect(ttsControllerInstances.length).toBe(1);

      // Release any pending init() promises so the dispatch chain can unwind
      // cleanly (otherwise the act() would never settle).
      while (pendingInitResolvers.length > 0) pendingInitResolvers.shift()!();
      await Promise.all([p1, p2]);
    });
  });
});

// Reading a selection aloud has to mean different things for the two kinds of
// engine: a synthesizer can render the selected words, a recording only has the
// clips the publisher timed. Handing raw text to the narration client ended the
// utterance at once, which fired the one-shot callback and killed the session —
// the button appeared to play for a moment and stop.
describe('useTTSControl reading a selection aloud', () => {
  beforeEach(() => {
    ttsControllerInstances.length = 0;
    pendingInitResolvers.length = 0;
    narrationState.active = false;
    mockView.tts.from.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  const speakSelection = async () => {
    render(<Harness />);
    const range = new Range();
    await act(async () => {
      const p = eventDispatcher.dispatch('tts-speak', { bookKey: 'book-1', range, oneTime: true });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      while (pendingInitResolvers.length > 0) pendingInitResolvers.shift()!();
      await p;
    });
    const controller = ttsControllerInstances[0] as unknown as {
      speak: ReturnType<typeof vi.fn>;
    };
    return { range, controller };
  };

  it('starts the recording at the selection when the book is narrated', async () => {
    narrationState.active = true;

    const { range, controller } = await speakSelection();

    expect(mockView.tts.from).toHaveBeenCalledWith(range);
    // Not a one-shot: the session goes on from that passage rather than being
    // stopped by the one-time callback as soon as the first clip ends.
    expect(controller.speak).toHaveBeenCalledWith(expect.anything(), false, expect.any(Function));
  });

  it('synthesizes the selected text when the book is not narrated', async () => {
    const { controller } = await speakSelection();

    expect(mockView.tts.from).not.toHaveBeenCalled();
    expect(controller.speak).toHaveBeenCalledWith(expect.anything(), true, expect.any(Function));
  });
});

// Following the voice onto the next page moves the view past the *start* of the
// sentence being read, which is what ttsLocation records. Judged on that alone
// the reader looks like they navigated away, so the back-to-position prompt
// appeared on every page turn — while they were in fact looking at the words
// being spoken. isCfiInLocation is mocked false throughout this suite, so these
// two tests turn entirely on whether the sentence is still on screen.
describe('useTTSControl back-to-position prompt', () => {
  const BannerHarness = () => {
    const tts = useTTSControl({ bookKey: 'book-1' });
    return <div data-testid='banner'>{String(tts.showBackToCurrentTTSLocation)}</div>;
  };

  beforeEach(() => {
    ttsControllerInstances.length = 0;
    pendingInitResolvers.length = 0;
    mockViewSettings.ttsLocation = 'epubcfi(/6/4!/4/2)';
  });

  afterEach(() => {
    cleanup();
    mockViewSettings.ttsLocation = null;
  });

  const startSessionThenRelocate = async (sentenceOnScreen: boolean) => {
    const view = render(<BannerHarness />);
    await act(async () => {
      const p = eventDispatcher.dispatch('tts-speak', { bookKey: 'book-1' });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      while (pendingInitResolvers.length > 0) pendingInitResolvers.shift()!();
      await p;
    });
    const controller = ttsControllerInstances[0] as unknown as {
      isSoundingSentenceOnScreen: ReturnType<typeof vi.fn>;
    };
    controller.isSoundingSentenceOnScreen.mockReturnValue(sentenceOnScreen);

    // Past the suppression window that hides the prompt right after a section
    // change, so this asserts the on-screen test rather than that grace period.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    try {
      // A page turn republishes the location as a new object; the re-render is
      // what a store update would do, and is what re-runs the location effect.
      await act(async () => {
        mockProgress = { ...mockProgress, location: { start: { cfi: 'a' }, end: { cfi: 'b' } } };
        view.rerender(<BannerHarness />);
        for (let i = 0; i < 5; i++) await Promise.resolve();
      });
    } finally {
      vi.useRealTimers();
    }
    return screen.getByTestId('banner').textContent;
  };

  it('stays hidden when the sentence being read is still on the page', async () => {
    expect(await startSessionThenRelocate(true)).toBe('false');
  });

  it('appears when the reader has paged away from the sentence entirely', async () => {
    expect(await startSessionThenRelocate(false)).toBe('true');
  });
});

describe('useTTSControl tts-sync-request (mode-entry replay)', () => {
  beforeEach(() => {
    ttsControllerInstances.length = 0;
    pendingInitResolvers.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  const startSession = async () => {
    render(<Harness />);
    await act(async () => {
      const p = eventDispatcher.dispatch('tts-speak', { bookKey: 'book-1' });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      while (pendingInitResolvers.length > 0) pendingInitResolvers.shift()!();
      await p;
    });
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    return ttsControllerInstances[0] as { redispatchPosition: ReturnType<typeof vi.fn> };
  };

  it('replays the current position then the playback state when a session exists', async () => {
    const controller = await startSession();
    const order: string[] = [];
    controller.redispatchPosition.mockImplementation(() => order.push('position'));
    const stateListener = (e: Event) => {
      order.push(`state:${(e as CustomEvent).detail.state}`);
    };
    eventDispatcher.on('tts-playback-state', stateListener);

    await act(async () => {
      await eventDispatcher.dispatch('tts-sync-request', { bookKey: 'book-1' });
    });

    eventDispatcher.off('tts-playback-state', stateListener);
    // Position-before-state is required so RSVP's 'paused' handler (which drops
    // following) can't discard the replayed position.
    expect(order).toEqual(['position', 'state:playing']);
  });

  it('ignores a sync request for a different book', async () => {
    const controller = await startSession();
    controller.redispatchPosition.mockClear();

    await act(async () => {
      await eventDispatcher.dispatch('tts-sync-request', { bookKey: 'other-book' });
    });

    expect(controller.redispatchPosition).not.toHaveBeenCalled();
  });

  it('is a no-op once the session has stopped', async () => {
    const controller = await startSession();
    await act(async () => {
      await eventDispatcher.dispatch('tts-stop', { bookKey: 'book-1' });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    controller.redispatchPosition.mockClear();

    await act(async () => {
      await eventDispatcher.dispatch('tts-sync-request', { bookKey: 'book-1' });
    });

    expect(controller.redispatchPosition).not.toHaveBeenCalled();
  });
});

describe('useTTSControl handleStop resilience (#4676)', () => {
  beforeEach(() => {
    ttsControllerInstances.length = 0;
    pendingInitResolvers.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  const startSession = async () => {
    render(<Harness />);
    await act(async () => {
      const p = eventDispatcher.dispatch('tts-speak', { bookKey: 'book-1' });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      while (pendingInitResolvers.length > 0) pendingInitResolvers.shift()!();
      await p;
    });
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    return ttsControllerInstances[0] as { shutdown: ReturnType<typeof vi.fn> };
  };

  it('disables TTS even when controller.shutdown rejects', async () => {
    // Regression: a native teardown that throws (observed with iOS system TTS)
    // must not skip the state resets that turn the TTS icon off.
    const controller = await startSession();
    const setTTSEnabled = getSetTTSEnabledMock();
    setTTSEnabled.mockClear();
    controller.shutdown.mockRejectedValueOnce(new Error('native teardown failed'));

    await act(async () => {
      await eventDispatcher.dispatch('tts-stop', { bookKey: 'book-1' });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(setTTSEnabled).toHaveBeenCalledWith('book-1', false);
  });

  it('disables TTS even when controller.shutdown never resolves', async () => {
    // The state resets must run before (not after) the teardown await, so a
    // hung native teardown can never leave the TTS icon stuck on.
    const controller = await startSession();
    const setTTSEnabled = getSetTTSEnabledMock();
    setTTSEnabled.mockClear();
    controller.shutdown.mockReturnValueOnce(new Promise<void>(() => {}));

    await act(async () => {
      // Do not await the dispatch: handleStop intentionally never settles here.
      eventDispatcher.dispatch('tts-stop', { bookKey: 'book-1' });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(setTTSEnabled).toHaveBeenCalledWith('book-1', false);
  });

  it('tears down the media session even when controller.shutdown never resolves', async () => {
    // Regression for the lock-screen Now Playing lingering with iOS system TTS:
    // the media-session teardown must not be gated behind the controller's own
    // shutdown, which can stall. The media session is owned by ttsMediaBridge
    // now; the teardown is its unbind().
    const unbindSpy = vi.spyOn(ttsMediaBridge, 'unbind');
    const controller = await startSession();
    unbindSpy.mockClear();
    controller.shutdown.mockReturnValueOnce(new Promise<void>(() => {}));

    await act(async () => {
      eventDispatcher.dispatch('tts-stop', { bookKey: 'book-1' });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(unbindSpy).toHaveBeenCalled();
    unbindSpy.mockRestore();
  });
});

describe('useTTSControl handleHighlightMark cross-section navigation', () => {
  beforeEach(() => {
    ttsControllerInstances.length = 0;
    pendingInitResolvers.length = 0;
    mockView.renderer.scrollToAnchor.mockClear();
    mockView.renderer.goTo.mockClear();
    mockView.goTo.mockClear();
    mockView.resolveCFI.mockReset();
    // Reset renderer state a test may override (a throwing assertion can skip
    // an inline restore, leaking into later tests).
    mockView.renderer.getContents = () => [{ index: 0, doc: document as unknown as Document }];
    mockView.renderer.primaryIndex = 0;
    mockView.renderer.scrolled = false;
    mockProgress.range = null;
    mockViewSettings.ttsLocation = null;
    vi.mocked(pageBreakFraction).mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  const setupAndCaptureHighlightHandler = async (
    eventName: 'tts-highlight-mark' | 'tts-highlight-word' = 'tts-highlight-mark',
  ) => {
    render(<Harness />);

    await act(async () => {
      const p = eventDispatcher.dispatch('tts-speak', { bookKey: 'book-1' });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      while (pendingInitResolvers.length > 0) pendingInitResolvers.shift()!();
      await p;
    });

    // Let the listener-registration useEffect run.
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    const controller = ttsControllerInstances[0] as {
      addEventListener: { mock: { calls: [string, (e: Event) => void][] } };
    };
    const calls = controller.addEventListener.mock.calls;
    const entry = calls.find(([name]) => name === eventName);
    if (!entry) throw new Error(`${eventName} listener was not registered`);
    return entry[1];
  };

  it('navigates to the cfi via view.goTo when TTS crosses into a new section', async () => {
    const handler = await setupAndCaptureHighlightHandler();

    // primaryIndex is 0 (current view section). Make the TTS cfi resolve to section 1.
    mockView.resolveCFI.mockReturnValue({ index: 1, anchor: () => new Range() });

    await act(async () => {
      handler(new CustomEvent('tts-highlight-mark', { detail: { cfi: 'epubcfi(/6/8!/4/2)' } }));
    });

    expect(mockView.goTo).toHaveBeenCalledWith('epubcfi(/6/8!/4/2)');
    expect(mockView.renderer.scrollToAnchor).not.toHaveBeenCalled();
  });

  it('keeps in-section behaviour: scrolls via renderer without navigating', async () => {
    const handler = await setupAndCaptureHighlightHandler();

    mockView.resolveCFI.mockReturnValue({ index: 0, anchor: () => new Range() });

    await act(async () => {
      handler(new CustomEvent('tts-highlight-mark', { detail: { cfi: 'epubcfi(/6/4!/4/2)' } }));
    });

    expect(mockView.renderer.scrollToAnchor).toHaveBeenCalledTimes(1);
    expect(mockView.goTo).not.toHaveBeenCalled();
  });

  // A sentence laid out across a page break: its mark fires once, on the page it
  // starts on, and a phrase-timed recording reports no words in between. Without
  // following the audio clock the reader is left on the first page while the
  // voice reads the tail rendered on the next one.
  it('turns the page when the voice reads past the visible part of a sentence', async () => {
    vi.useFakeTimers();
    try {
      const handler = await setupAndCaptureHighlightHandler();
      const controller = ttsControllerInstances[0] as unknown as {
        getSentenceProgress: ReturnType<typeof vi.fn>;
        state: string;
      };
      controller.state = 'playing';

      // Three quarters of the sentence is readable on this page; the tail is
      // laid out past its edge.
      vi.mocked(pageBreakFraction).mockReturnValue(0.75);
      mockView.renderer.end = 528;
      mockView.resolveCFI.mockReturnValue({ index: 0, anchor: () => new Range() });
      controller.getSentenceProgress.mockReturnValue(0);

      await act(async () => {
        handler(new CustomEvent('tts-highlight-mark', { detail: { cfi: 'epubcfi(/6/4!/4/2)' } }));
      });

      // Still reading the visible part.
      controller.getSentenceProgress.mockReturnValue(0.5);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(mockView.renderer.next).not.toHaveBeenCalled();

      // Past it: the page must follow.
      controller.getSentenceProgress.mockReturnValue(0.8);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(mockView.renderer.next).toHaveBeenCalled();
    } finally {
      mockView.renderer.end = 0;
      mockView.renderer.next = vi.fn();
      vi.useRealTimers();
    }
  });

  it('does not follow a sentence that fits on the page', async () => {
    vi.useFakeTimers();
    try {
      const handler = await setupAndCaptureHighlightHandler();
      const controller = ttsControllerInstances[0] as unknown as {
        getSentenceProgress: ReturnType<typeof vi.fn>;
        state: string;
      };
      controller.state = 'playing';
      controller.getSentenceProgress.mockReturnValue(0.99);
      // The whole sentence fits: no break to follow.
      vi.mocked(pageBreakFraction).mockReturnValue(null);
      mockView.renderer.end = 528;
      mockView.resolveCFI.mockReturnValue({ index: 0, anchor: () => new Range() });

      await act(async () => {
        handler(new CustomEvent('tts-highlight-mark', { detail: { cfi: 'epubcfi(/6/4!/4/2)' } }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockView.renderer.next).not.toHaveBeenCalled();
    } finally {
      mockView.renderer.end = 0;
      mockView.renderer.next = vi.fn();
      vi.useRealTimers();
    }
  });

  it('does not follow when the engine reports no clock', async () => {
    vi.useFakeTimers();
    try {
      const handler = await setupAndCaptureHighlightHandler();
      const controller = ttsControllerInstances[0] as unknown as {
        getSentenceProgress: ReturnType<typeof vi.fn>;
        state: string;
      };
      controller.state = 'playing';
      controller.getSentenceProgress.mockReturnValue(null);
      vi.mocked(pageBreakFraction).mockReturnValue(0.1);
      mockView.renderer.end = 528;
      mockView.resolveCFI.mockReturnValue({ index: 0, anchor: () => new Range() });

      await act(async () => {
        handler(new CustomEvent('tts-highlight-mark', { detail: { cfi: 'epubcfi(/6/4!/4/2)' } }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockView.renderer.next).not.toHaveBeenCalled();
    } finally {
      mockView.renderer.end = 0;
      mockView.renderer.next = vi.fn();
      vi.useRealTimers();
    }
  });

  it('does not throw when the renderer has no loaded contents (READEST-19)', async () => {
    const handler = await setupAndCaptureHighlightHandler();
    // getContents() can be empty mid-relocate (section still loading / view
    // torn down); the mark handler must not destructure `doc` off undefined.
    mockView.renderer.getContents = () => [];
    mockView.resolveCFI.mockReturnValue({ index: 0, anchor: () => new Range() });

    expect(() => {
      handler(new CustomEvent('tts-highlight-mark', { detail: { cfi: 'epubcfi(/6/4!/4/2)' } }));
    }).not.toThrow();
  });

  it('bails without scrolling when the cfi resolves to a null range (READEST-21)', async () => {
    const handler = await setupAndCaptureHighlightHandler();
    // In-section (index 0 == primaryIndex 0) so the follow-scroll path runs,
    // but the anchor cannot resolve to a range in the doc.
    mockView.resolveCFI.mockReturnValue({ index: 0, anchor: () => null });

    expect(() => {
      handler(new CustomEvent('tts-highlight-mark', { detail: { cfi: 'epubcfi(/6/4!/4/2)' } }));
    }).not.toThrow();
    // A null range must never reach scrollToAnchor (foliate reads
    // range.startContainer inside it -> the READEST-21 crash).
    expect(mockView.renderer.scrollToAnchor).not.toHaveBeenCalled();
  });

  it('does not throw in scrolled mode when the range is null (READEST-21)', async () => {
    const handler = await setupAndCaptureHighlightHandler();
    mockView.renderer.scrolled = true;
    mockView.resolveCFI.mockReturnValue({ index: 0, anchor: () => null });

    expect(() => {
      handler(new CustomEvent('tts-highlight-mark', { detail: { cfi: 'epubcfi(/6/4!/4/2)' } }));
    }).not.toThrow();
  });

  it('does not throw when a word highlight fires with no loaded contents (READEST-4S)', async () => {
    const handler = await setupAndCaptureHighlightHandler('tts-highlight-word');
    mockView.renderer.getContents = () => [];

    expect(() => {
      handler(new CustomEvent('tts-highlight-word', { detail: { cfi: 'epubcfi(/6/4!/4/2)' } }));
    }).not.toThrow();
  });

  it('follows a visible-section word using the first loaded content as fallback', async () => {
    const handler = await setupAndCaptureHighlightHandler('tts-highlight-word');
    const wordRange = {
      compareBoundaryPoints: vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(0),
    } as unknown as Range;
    const visibleRange = {} as Range;
    mockView.renderer.primaryIndex = 1;
    mockView.renderer.getContents = () => [{ index: 0, doc: document as unknown as Document }];
    mockProgress.range = visibleRange;
    mockView.resolveCFI.mockReturnValue({ index: 0, anchor: () => wordRange });

    handler(new CustomEvent('tts-highlight-word', { detail: { cfi: 'epubcfi(/6/4!/4/2)' } }));

    expect(wordRange.compareBoundaryPoints).toHaveBeenCalledWith(Range.END_TO_START, visibleRange);
    expect(mockView.renderer.scrollToAnchor).toHaveBeenCalledWith(wordRange);
  });

  it('follows a word in the primary loaded section', async () => {
    const handler = await setupAndCaptureHighlightHandler('tts-highlight-word');
    const wordRange = {
      compareBoundaryPoints: vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(0),
    } as unknown as Range;
    mockProgress.range = {} as Range;
    mockView.resolveCFI.mockReturnValue({ index: 0, anchor: () => wordRange });

    handler(new CustomEvent('tts-highlight-word', { detail: { cfi: 'epubcfi(/6/4!/4/2)' } }));

    expect(mockView.renderer.scrollToAnchor).toHaveBeenCalledWith(wordRange);
  });
});

describe('useTTSControl background session lifecycle', () => {
  type ControllerMock = {
    shutdown: ReturnType<typeof vi.fn>;
    detachView: ReturnType<typeof vi.fn>;
    attachView: ReturnType<typeof vi.fn>;
    terminated: boolean;
    state: string;
  };

  beforeEach(() => {
    ttsControllerInstances.length = 0;
    pendingInitResolvers.length = 0;
    mockSessionManager.claim.mockClear();
    mockSessionManager.detach.mockClear();
    mockSessionManager.release.mockClear();
    mockSessionManager.adopt.mockClear();
    mockSessionManager.stopActive.mockClear();
    mockSessionManager.getSessionByHash.mockReturnValue(null);
    mockSessionManager.getActiveSession.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  const startSession = async () => {
    render(<Harness />);
    await act(async () => {
      const p = eventDispatcher.dispatch('tts-speak', { bookKey: 'book-1' });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      while (pendingInitResolvers.length > 0) pendingInitResolvers.shift()!();
      await p;
    });
    return ttsControllerInstances[0] as ControllerMock;
  };

  it('claims the session at controller birth', async () => {
    await startSession();
    expect(mockSessionManager.claim).toHaveBeenCalledWith(
      'book-1',
      ttsControllerInstances[0],
      expect.objectContaining({ bookKey: 'book-1', title: 'T' }),
    );
  });

  it('unmount while the session lives transfers ownership (detach, no shutdown)', async () => {
    const controller = await startSession();
    controller.state = 'playing';
    controller.terminated = false;
    mockSessionManager.getSessionByHash.mockReturnValue({
      bookHash: 'book',
      bookKey: 'book-1',
      controller,
    });
    cleanup(); // unmounts the hook
    expect(mockSessionManager.detach).toHaveBeenCalledWith('book');
    expect(controller.shutdown).not.toHaveBeenCalled();
  });

  it('unmount after termination shuts down and releases', async () => {
    const controller = await startSession();
    controller.terminated = true;
    mockSessionManager.getSessionByHash.mockReturnValue({
      bookHash: 'book',
      bookKey: 'book-1',
      controller,
    });
    cleanup();
    expect(controller.shutdown).toHaveBeenCalled();
    expect(mockSessionManager.release).toHaveBeenCalledWith('book');
  });

  it('tts-close-book detaches a live session; tts-stop stays a hard stop', async () => {
    const controller = await startSession();
    controller.terminated = false;
    await act(async () => {
      await eventDispatcher.dispatch('tts-close-book', { bookKey: 'book-1' });
    });
    expect(mockSessionManager.detach).toHaveBeenCalledWith('book');
    expect(controller.shutdown).not.toHaveBeenCalled();

    await act(async () => {
      await eventDispatcher.dispatch('tts-stop', { bookKey: 'book-1' });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(controller.shutdown).toHaveBeenCalled();
    expect(mockSessionManager.release).toHaveBeenCalledWith('book');
  });

  it('mounting a book stops an active session of a different, unmounted book', async () => {
    mockSessionManager.getActiveSession.mockReturnValue({
      bookHash: 'otherhash',
      bookKey: 'otherhash-r9',
      controller: {},
    });
    render(<Harness />);
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(mockSessionManager.stopActive).toHaveBeenCalledWith('replaced');
  });

  it('adopts a live session for the same book without constructing a controller', async () => {
    const liveController = {
      state: 'playing',
      terminated: false,
      isViewAttached: false,
      shutdown: vi.fn(),
      detachView: vi.fn(),
      attachView: vi.fn().mockResolvedValue(undefined),
      getSpeakingLang: vi.fn().mockReturnValue('en'),
      getCurrentHighlightCfi: vi.fn().mockReturnValue(null),
      isSoundingSentenceOnScreen: vi.fn().mockReturnValue(false),
      getSpokenSentence: vi.fn().mockReturnValue(null),
      updateHighlightOptions: vi.fn(),
      setHighlightGranularity: vi.fn(),
      getVoiceId: vi.fn().mockReturnValue(''),
      setTargetLang: vi.fn(),
      setLang: vi.fn(),
      setRate: vi.fn(),
      pause: vi.fn().mockResolvedValue(true),
      resume: vi.fn().mockResolvedValue(true),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      forward: vi.fn().mockResolvedValue(undefined),
      backward: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      redispatchPosition: vi.fn(),
    };
    mockSessionManager.getSessionByHash.mockReturnValue({
      bookHash: 'book',
      bookKey: 'book-old',
      controller: liveController,
    });
    render(<Harness />);
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(ttsControllerInstances).toHaveLength(0); // no new controller
    expect(mockSessionManager.adopt).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({ bookKey: 'book-1' }),
    );
    expect(liveController.attachView).toHaveBeenCalledWith(
      mockView,
      expect.objectContaining({ bookKey: 'book-1' }),
    );
  });
});

describe('useTTSControl gap control (handleSetSentenceGap / handleSupportsGapControl)', () => {
  let hookResult: ReturnType<typeof useTTSControl> | null = null;

  const CaptureHarness = () => {
    hookResult = useTTSControl({ bookKey: 'book-1' });
    return null;
  };

  beforeEach(() => {
    ttsControllerInstances.length = 0;
    pendingInitResolvers.length = 0;
    hookResult = null;
    mockSessionManager.claim.mockClear();
    mockSessionManager.getSessionByHash.mockReturnValue(null);
    mockSessionManager.getActiveSession.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  const startSession = async () => {
    render(<CaptureHarness />);
    await act(async () => {
      const p = eventDispatcher.dispatch('tts-speak', { bookKey: 'book-1' });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      while (pendingInitResolvers.length > 0) pendingInitResolvers.shift()!();
      await p;
    });
    return ttsControllerInstances[0] as {
      setSentenceGap: ReturnType<typeof vi.fn>;
      supportsGapControl: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      start: ReturnType<typeof vi.fn>;
      state: string;
    };
  };

  it('handleSetSentenceGap calls controller.setSentenceGap directly, without stop/start', async () => {
    const controller = await startSession();
    controller.state = 'playing';

    act(() => {
      hookResult!.handleSetSentenceGap(0.5);
    });

    expect(controller.setSentenceGap).toHaveBeenCalledWith(0.5);
    expect(controller.stop).not.toHaveBeenCalled();
    expect(controller.start).not.toHaveBeenCalled();
  });
});
