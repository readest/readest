'use client';

import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import RSVPOverlay from '@/app/reader/components/rsvp/RSVPOverlay';
import type { RSVPController, RsvpState } from '@/services/rsvp';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    themeCode: { primary: '#000', bg: '#fff', fg: '#111' },
    isDarkMode: false,
  }),
}));

// Stub the dictionary popup/sheet so the overlay test does not pull in the
// whole dictionary provider/registry stack — we only assert it opens with the
// word. The overlay uses the sheet below `sm` and the popup otherwise.
vi.mock('@/app/reader/components/annotator/DictionarySheet', () => ({
  default: ({ word, onDismiss }: { word: string; onDismiss: () => void }) => (
    <div data-testid='rsvp-dict-sheet' data-word={word}>
      <button aria-label='close-dict' onClick={onDismiss}>
        x
      </button>
    </div>
  ),
}));

vi.mock('@/app/reader/components/annotator/DictionaryPopup', () => ({
  default: ({ word, onDismiss }: { word: string; onDismiss: () => void }) => (
    <div data-testid='rsvp-dict-popup' data-word={word}>
      <button aria-label='close-dict' onClick={onDismiss}>
        x
      </button>
    </div>
  ),
}));

const buildState = (overrides: Partial<RsvpState> = {}): RsvpState => ({
  active: true,
  playing: false,
  words: [],
  currentIndex: 0,
  currentPartIndex: 0,
  wpm: 300,
  punctuationPauseMs: 100,
  splitHyphens: false,
  cjkCharMode: false,
  startDelaySeconds: 3,
  hasCJK: false,
  progress: 0,
  ...overrides,
});

const buildController = (state: RsvpState) => {
  const listeners = new Map<string, EventListener[]>();
  const controller = {
    get currentState() {
      return state;
    },
    get currentDisplayWord() {
      return state.words[state.currentIndex] ?? null;
    },
    get currentCountdown() {
      return null;
    },
    seekToIndex: vi.fn(),
    seekToPosition: vi.fn(),
    skipBackward: vi.fn(),
    skipForward: vi.fn(),
    nextWord: vi.fn(),
    prevWord: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    togglePlayPause: vi.fn(),
    decreaseSpeed: vi.fn(),
    increaseSpeed: vi.fn(),
    setWpm: vi.fn(),
    setPunctuationPause: vi.fn(),
    setSplitHyphens: vi.fn(),
    setCjkCharMode: vi.fn(),
    setStartDelay: vi.fn(),
    getWpmOptions: vi.fn(() => [100, 200, 300]),
    getPunctuationPauseOptions: vi.fn(() => [25, 50, 100]),
    getStartDelayOptions: vi.fn(() => [0, 1, 2, 3]),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(listener);
    }),
    removeEventListener: vi.fn(),
  };
  return controller;
};

const renderOverlay = (state: RsvpState, fontFamily?: string) => {
  const controller = buildController(state);
  const result = render(
    <RSVPOverlay
      gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
      controller={controller as unknown as RSVPController}
      chapters={[]}
      currentChapterHref={null}
      fontFamily={fontFamily}
      onClose={vi.fn()}
      onChapterSelect={vi.fn()}
      onRequestNextPage={vi.fn()}
    />,
  );
  return { ...result, controller };
};

describe('RSVPOverlay — capture lifecycle', () => {
  afterEach(() => cleanup());

  test('marks its mounted full-screen surface as capture-blocking', () => {
    const state = buildState({
      words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }],
    });

    const { getByTestId } = renderOverlay(state);

    expect(getByTestId('rsvp-overlay').getAttribute('data-capture-blocking-overlay')).toBe('true');
  });
});

describe('RSVPOverlay — context panel performance', () => {
  afterEach(() => cleanup());

  test('renders a bounded number of word buttons for a large word list', () => {
    const words = Array.from({ length: 5000 }, (_, i) => ({
      text: `word${i}`,
      orpIndex: 0,
      pauseMultiplier: 1,
    }));
    const state = buildState({ words, currentIndex: 2500 });

    const { container } = renderOverlay(state);

    const buttons = container.querySelectorAll('[data-rsvp-word-button]');
    // Without windowing this would be 5000; with windowing it should be far fewer.
    expect(buttons.length).toBeLessThan(2000);
    expect(buttons.length).toBeGreaterThan(0);
  });

  test('clicking a windowed word seeks to that word', () => {
    const words = Array.from({ length: 200 }, (_, i) => ({
      text: `w${i}`,
      orpIndex: 0,
      pauseMultiplier: 1,
    }));
    const state = buildState({ words, currentIndex: 100 });

    const { container, controller } = renderOverlay(state);

    const target = container.querySelector('[data-rsvp-word-index="90"]');
    expect(target).not.toBeNull();
    fireEvent.click(target!);
    expect(controller.seekToIndex).toHaveBeenCalledWith(90);
  });

  test('the current word is rendered with the highlight ref', () => {
    const words = Array.from({ length: 100 }, (_, i) => ({
      text: `w${i}`,
      orpIndex: 0,
      pauseMultiplier: 1,
    }));
    const state = buildState({ words, currentIndex: 42 });

    const { container } = renderOverlay(state);

    const current = container.querySelector('[data-rsvp-word-index="42"]');
    expect(current).not.toBeNull();
    // current word should not be a button (not clickable)
    expect(current!.getAttribute('role')).toBeNull();
  });
});

describe('RSVPOverlay — reading font', () => {
  afterEach(() => cleanup());

  const wordState = () =>
    buildState({ words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }], currentIndex: 0 });

  test('applies the reader font family to the word display', () => {
    const { container } = renderOverlay(wordState(), '"Bitter", "Source Han Serif CN", serif');
    const word = container.querySelector('.rsvp-word') as HTMLElement;
    expect(word).not.toBeNull();
    expect(word.style.fontFamily).toContain('Bitter');
    // With a reading font supplied, the word no longer uses the monospace fallback.
    expect(word.classList.contains('font-mono')).toBe(false);
  });

  test('falls back to the monospace class when no font family is supplied', () => {
    const { container } = renderOverlay(wordState());
    const word = container.querySelector('.rsvp-word') as HTMLElement;
    expect(word).not.toBeNull();
    expect(word.classList.contains('font-mono')).toBe(true);
    expect(word.style.fontFamily).toBe('');
  });
});

describe('RSVPOverlay — progress bar drag on mobile', () => {
  afterEach(() => cleanup());

  test('horizontal drag starting on the progress bar does not trigger a speed swipe', () => {
    const words = Array.from({ length: 100 }, (_, i) => ({
      text: `w${i}`,
      orpIndex: 0,
      pauseMultiplier: 1,
    }));
    const state = buildState({ words, currentIndex: 10 });

    const { container, controller } = renderOverlay(state);
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    expect(slider).not.toBeNull();

    // Simulate a horizontal touch drag long enough to clear SWIPE_THRESHOLD (50px).
    fireEvent.touchStart(slider, { touches: [{ clientX: 50, clientY: 400 }] });
    fireEvent.touchEnd(slider, {
      changedTouches: [{ clientX: 200, clientY: 400 }],
    });

    expect(controller.increaseSpeed).not.toHaveBeenCalled();
    expect(controller.decreaseSpeed).not.toHaveBeenCalled();
  });

  test('horizontal drag starting on a footer button does not trigger a speed swipe', () => {
    const state = buildState({
      words: [{ text: 'a', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container, controller } = renderOverlay(state);
    // Pick any control inside `.rsvp-controls` (e.g. the play/pause button).
    const playButton = container.querySelector('[aria-label="Play"]') as HTMLElement;
    expect(playButton).not.toBeNull();

    fireEvent.touchStart(playButton, { touches: [{ clientX: 50, clientY: 400 }] });
    fireEvent.touchEnd(playButton, {
      changedTouches: [{ clientX: 200, clientY: 400 }],
    });

    expect(controller.increaseSpeed).not.toHaveBeenCalled();
    expect(controller.decreaseSpeed).not.toHaveBeenCalled();
  });

  test('progress bar uses touch-action: none so pointer capture survives on mobile', () => {
    const state = buildState({
      words: [{ text: 'a', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    expect(slider).not.toBeNull();
    expect(slider.style.touchAction).toBe('none');
  });
});

describe('RSVPOverlay — CJK reading options', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  const openSettings = (container: HTMLElement) => {
    fireEvent.click(container.querySelector('[aria-label="Settings"]') as HTMLElement);
  };

  test('shows Character Mode and Highlight Word toggles for CJK sections', () => {
    const state = buildState({
      words: [{ text: '喜欢', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: true,
    });
    const { container } = renderOverlay(state);
    openSettings(container);

    expect(container.querySelector('[data-testid="rsvp-char-mode-toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rsvp-highlight-word-toggle"]')).not.toBeNull();
  });

  test('hides CJK toggles when the section has no CJK text', () => {
    const state = buildState({
      words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: false,
    });
    const { container } = renderOverlay(state);
    openSettings(container);

    expect(container.querySelector('[data-testid="rsvp-char-mode-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="rsvp-highlight-word-toggle"]')).toBeNull();
  });

  test('toggling Character Mode calls controller.setCjkCharMode', () => {
    const state = buildState({
      words: [{ text: '喜欢', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: true,
    });
    const { container, controller } = renderOverlay(state);
    openSettings(container);

    fireEvent.click(
      container.querySelector('[data-testid="rsvp-char-mode-toggle"]') as HTMLElement,
    );
    expect(controller.setCjkCharMode).toHaveBeenCalledWith(true);
  });

  test('renders the focus-letter layout for a CJK word by default', () => {
    const state = buildState({
      words: [{ text: '喜欢', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: true,
    });
    const { container } = renderOverlay(state);

    expect(container.querySelector('.rsvp-word-orp')).not.toBeNull();
    expect(container.querySelector('.rsvp-word-whole')).toBeNull();
  });

  test('renders a single centered span when Highlight Word is enabled', () => {
    localStorage.setItem('readest_rsvp_cjk_highlight_word', '1');
    const state = buildState({
      words: [{ text: '喜欢', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: true,
    });
    const { container } = renderOverlay(state);

    const whole = container.querySelector('.rsvp-word-whole');
    expect(whole).not.toBeNull();
    expect(whole!.textContent).toBe('喜欢');
    expect(container.querySelector('.rsvp-word-orp')).toBeNull();
  });

  test('keeps the focus-letter layout for Latin words even with Highlight Word enabled', () => {
    localStorage.setItem('readest_rsvp_cjk_highlight_word', '1');
    const state = buildState({
      words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: false,
    });
    const { container } = renderOverlay(state);

    expect(container.querySelector('.rsvp-word-orp')).not.toBeNull();
    expect(container.querySelector('.rsvp-word-whole')).toBeNull();
  });
});

describe('RSVPOverlay — RTL word display (#4630)', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  test('renders an Arabic word as a single RTL whole-word span, never split', () => {
    const state = buildState({
      words: [{ text: 'علم', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);

    // Splitting the word into before/orp/after spans breaks Arabic shaping and
    // reverses the visual order — RTL words must render whole instead.
    const whole = container.querySelector('.rsvp-word-whole');
    expect(whole).not.toBeNull();
    expect(whole!.textContent).toBe('علم');
    expect(whole!.getAttribute('dir')).toBe('rtl');
    expect(container.querySelector('.rsvp-word-orp')).toBeNull();
    expect(container.querySelector('.rsvp-word-before')).toBeNull();
    expect(container.querySelector('.rsvp-word-after')).toBeNull();
  });

  test('renders a Hebrew word whole as well', () => {
    const state = buildState({
      words: [{ text: 'שלום', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);

    const whole = container.querySelector('.rsvp-word-whole');
    expect(whole).not.toBeNull();
    expect(whole!.textContent).toBe('שלום');
    expect(container.querySelector('.rsvp-word-orp')).toBeNull();
  });

  test('keeps the focus-letter split for Latin words (no spurious dir)', () => {
    const state = buildState({
      words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);

    expect(container.querySelector('.rsvp-word-orp')).not.toBeNull();
    expect(container.querySelector('.rsvp-word-whole')).toBeNull();
  });
});

describe('RSVPOverlay — manual word stepping (#4476)', () => {
  afterEach(() => cleanup());

  const wordsState = () =>
    buildState({
      words: Array.from({ length: 10 }, (_, i) => ({
        text: `w${i}`,
        orpIndex: 0,
        pauseMultiplier: 1,
      })),
      currentIndex: 5,
      playing: true,
    });

  test('the next-word button calls controller.nextWord', () => {
    const { container, controller } = renderOverlay(wordsState());
    const button = container.querySelector('[aria-label="Next word"]') as HTMLElement;
    expect(button).not.toBeNull();
    fireEvent.click(button);
    expect(controller.nextWord).toHaveBeenCalledTimes(1);
  });

  test('the previous-word button calls controller.prevWord', () => {
    const { container, controller } = renderOverlay(wordsState());
    const button = container.querySelector('[aria-label="Previous word"]') as HTMLElement;
    expect(button).not.toBeNull();
    fireEvent.click(button);
    expect(controller.prevWord).toHaveBeenCalledTimes(1);
  });

  test('the "." key steps to the next word and "," to the previous word', () => {
    const { controller } = renderOverlay(wordsState());
    fireEvent.keyDown(document, { key: '.' });
    expect(controller.nextWord).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: ',' });
    expect(controller.prevWord).toHaveBeenCalledTimes(1);
  });
});

describe('RSVPOverlay — dictionary lookup (#4475)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const wordsState = () =>
    buildState({
      words: Array.from({ length: 10 }, (_, i) => ({
        text: `w${i}`,
        orpIndex: 0,
        pauseMultiplier: 1,
      })),
      currentIndex: 5,
      playing: true,
    });

  const mockSelection = (text: string, node: Node | null) => {
    const rect = { left: 20, top: 30, right: 60, bottom: 44, width: 40, height: 14 };
    const range = {
      getBoundingClientRect: () => rect,
      cloneRange() {
        return range;
      },
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: text.length === 0,
      anchorNode: node,
      rangeCount: 1,
      toString: () => text,
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
    } as unknown as Selection);
  };

  test('the context panel is selectable', () => {
    const { container } = renderOverlay(wordsState());
    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    expect(panel.className).toContain('select-text');
  });

  test('selecting text in the context panel reveals a Look up action', () => {
    const { container } = renderOverlay(wordsState());
    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    mockSelection('serendipity', panel);
    fireEvent.mouseUp(panel);
    expect(container.querySelector('[aria-label="Look up"]')).not.toBeNull();
  });

  test('tapping Look up pauses playback and opens the dictionary with the selected text', () => {
    const { container, controller } = renderOverlay(wordsState());
    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    mockSelection('serendipity', panel);
    fireEvent.mouseUp(panel);
    fireEvent.click(container.querySelector('[aria-label="Look up"]') as HTMLElement);

    expect(controller.pause).toHaveBeenCalled();
    // jsdom's default viewport is desktop-sized, so the anchored popup is used.
    const popup = container.querySelector('[data-testid="rsvp-dict-popup"]');
    expect(popup).not.toBeNull();
    expect(popup!.getAttribute('data-word')).toBe('serendipity');
  });

  test('clicking outside the popup dismisses it', () => {
    const { container } = renderOverlay(wordsState());
    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    mockSelection('serendipity', panel);
    fireEvent.mouseUp(panel);
    fireEvent.click(container.querySelector('[aria-label="Look up"]') as HTMLElement);
    expect(container.querySelector('[data-testid="rsvp-dict-popup"]')).not.toBeNull();

    // The transparent full-screen catcher behind the popup dismisses on click.
    fireEvent.click(container.querySelector('.overlay') as HTMLElement);
    expect(container.querySelector('[data-testid="rsvp-dict-popup"]')).toBeNull();
  });

  test('uses the bottom sheet on small screens', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(420);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(720);
    const { container } = renderOverlay(wordsState());
    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    mockSelection('serendipity', panel);
    fireEvent.mouseUp(panel);
    fireEvent.click(container.querySelector('[aria-label="Look up"]') as HTMLElement);

    expect(container.querySelector('[data-testid="rsvp-dict-sheet"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rsvp-dict-popup"]')).toBeNull();
  });

  test('an active selection suppresses word-click seeking', () => {
    const { container, controller } = renderOverlay(wordsState());
    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    mockSelection('w3 w4', panel);
    fireEvent.click(container.querySelector('[data-rsvp-word-index="3"]') as HTMLElement);
    expect(controller.seekToIndex).not.toHaveBeenCalled();
  });
});

describe('RSVPOverlay — playback control layout (#4585, regressed by #4589)', () => {
  afterEach(() => cleanup());

  // The audio (TTS) toggle and the settings gear must sit in the SAME flex row
  // as the transport buttons, flanking the centered play button in normal flow.
  // The earlier `absolute end-0` cluster overlaid them on top of the right end
  // of the transport, hiding the audio button behind "skip forward 15" on narrow
  // phones. Keeping all three as siblings of the play button is what prevents the
  // overlap, so assert the structure here (jsdom can't measure the overlap).
  test('audio toggle and settings flank the transport in the same flex row', () => {
    const state = buildState({
      words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);

    const audioButton = container.querySelector('[aria-label="Play audio"]') as HTMLElement;
    const settingsButton = container.querySelector('[aria-label="Settings"]') as HTMLElement;
    const playButton = container.querySelector('[aria-label="Play"]') as HTMLElement;
    expect(audioButton).not.toBeNull();
    expect(settingsButton).not.toBeNull();
    expect(playButton).not.toBeNull();

    // All three share the play button's parent (the single flex row) — the audio
    // toggle and settings are not tucked into a separate absolute cluster.
    expect(audioButton.parentElement).toBe(playButton.parentElement);
    expect(settingsButton.parentElement).toBe(playButton.parentElement);
  });

  // On very narrow phones (< 350px) the row has no room for every control, so
  // the Faster/Slower speed buttons collapse to save space (speed is still
  // adjustable from the WPM dropdown). The core transport stays put.
  test('hides the Faster/Slower buttons below 350px to save space', () => {
    const state = buildState({
      words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);

    const decrease = container.querySelector('[aria-label="Decrease speed"]') as HTMLElement;
    const increase = container.querySelector('[aria-label="Increase speed"]') as HTMLElement;
    const play = container.querySelector('[aria-label="Play"]') as HTMLElement;
    const audio = container.querySelector('[aria-label="Play audio"]') as HTMLElement;
    const settings = container.querySelector('[aria-label="Settings"]') as HTMLElement;

    expect(decrease.className).toContain('max-[350px]:hidden');
    expect(increase.className).toContain('max-[350px]:hidden');
    // Transport, audio toggle and settings must remain visible at any width.
    expect(play.className).not.toContain('max-[350px]:hidden');
    expect(audio.className).not.toContain('max-[350px]:hidden');
    expect(settings.className).not.toContain('max-[350px]:hidden');
  });

  // The previous fix relied on absolute positioning being gone; guard against it
  // sneaking back into the row that holds the transport controls.
  test('the playback control row is not absolutely positioned', () => {
    const state = buildState({
      words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);

    const playButton = container.querySelector('[aria-label="Play"]') as HTMLElement;
    const audioButton = container.querySelector('[aria-label="Play audio"]') as HTMLElement;
    expect(playButton.parentElement!.className).not.toContain('absolute');
    expect(audioButton.parentElement!.className).not.toContain('absolute');
  });
});

describe('RSVPOverlay — start delay setting (#4478)', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  const openSettings = (container: HTMLElement) => {
    fireEvent.click(container.querySelector('[aria-label="Settings"]') as HTMLElement);
  };

  test('changing the Start Delay select calls controller.setStartDelay', () => {
    const state = buildState({
      words: [{ text: 'a', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
      startDelaySeconds: 3,
    });
    const { container, controller } = renderOverlay(state);
    openSettings(container);

    const select = container.querySelector(
      '[data-testid="rsvp-start-delay-select"]',
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    fireEvent.change(select, { target: { value: '0' } });
    expect(controller.setStartDelay).toHaveBeenCalledWith(0);
  });
});
