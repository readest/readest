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

const buildState = (overrides: Partial<RsvpState> = {}): RsvpState => ({
  active: true,
  playing: false,
  words: [],
  currentIndex: 0,
  currentPartIndex: 0,
  wpm: 300,
  punctuationPauseMs: 100,
  splitHyphens: false,
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
    pause: vi.fn(),
    resume: vi.fn(),
    togglePlayPause: vi.fn(),
    decreaseSpeed: vi.fn(),
    increaseSpeed: vi.fn(),
    setWpm: vi.fn(),
    setPunctuationPause: vi.fn(),
    setSplitHyphens: vi.fn(),
    getWpmOptions: vi.fn(() => [100, 200, 300]),
    getPunctuationPauseOptions: vi.fn(() => [25, 50, 100]),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(listener);
    }),
    removeEventListener: vi.fn(),
  };
  return controller;
};

const renderOverlay = (state: RsvpState) => {
  const controller = buildController(state);
  const result = render(
    <RSVPOverlay
      gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
      controller={controller as unknown as RSVPController}
      chapters={[]}
      currentChapterHref={null}
      onClose={vi.fn()}
      onChapterSelect={vi.fn()}
      onRequestNextPage={vi.fn()}
    />,
  );
  return { ...result, controller };
};

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
