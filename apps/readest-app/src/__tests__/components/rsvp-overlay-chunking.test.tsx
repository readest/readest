'use client';

import { describe, expect, test, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import RSVPOverlay from '@/app/reader/components/rsvp/RSVPOverlay';
import type { RSVPController, RsvpState } from '@/services/rsvp';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

afterEach(() => {
  cleanup();
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    themeCode: { primary: '#3B82F6', bg: '#111827', fg: '#f3f4f6' },
    isDarkMode: true,
  }),
}));

const mockWords = [
  { text: 'The', orpIndex: 0, pauseMultiplier: 1 },
  { text: 'quick', orpIndex: 1, pauseMultiplier: 1 },
  { text: 'brown', orpIndex: 2, pauseMultiplier: 1 },
  { text: 'fox', orpIndex: 1, pauseMultiplier: 1 },
  { text: 'jumps', orpIndex: 1, pauseMultiplier: 1 },
];

function buildMockController(state: RsvpState) {
  const listeners = new Map<string, EventListener[]>();
  return {
    get currentState() {
      return state;
    },
    get currentDisplayWord() {
      return state.words[state.currentIndex] ?? null;
    },
    get currentChunk() {
      return state.words.slice(state.currentIndex, state.currentIndex + state.chunkSize);
    },
    get currentChunkIndices() {
      const indices: number[] = [];
      for (let i = 0; i < state.chunkSize && state.currentIndex + i < state.words.length; i++) {
        indices.push(state.currentIndex + i);
      }
      return indices;
    },
    get chunkSizeOptions() {
      return [1, 2, 3, 4, 5];
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
    setChunkSize: vi.fn((size: number) => {
      state.chunkSize = size;
    }),
    setEnableWarmup: vi.fn((enabled: boolean) => {
      state.enableWarmup = enabled;
    }),
    setAdaptiveLongWordDelay: vi.fn((enabled: boolean) => {
      state.adaptiveLongWordDelay = enabled;
    }),
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
  } as unknown as RSVPController;
}

function renderHelper(controller: RSVPController) {
  return render(
    <RSVPOverlay
      controller={controller}
      currentChapterHref='ch1.xhtml'
      chapters={[]}
      gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
      onChapterSelect={vi.fn()}
      onRequestNextPage={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('RSVPOverlay Multi-Word UI & Interaction', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('renders multi-word chunk with per-word fixation when chunkSize > 1', () => {
    const state: RsvpState = {
      active: true,
      playing: false,
      words: mockWords,
      currentIndex: 0,
      currentPartIndex: 0,
      wpm: 300,
      punctuationPauseMs: 100,
      splitHyphens: false,
      cjkCharMode: false,
      startDelaySeconds: 0,
      hasCJK: false,
      progress: 0,
      chunkSize: 3,
      enableWarmup: false,
      adaptiveLongWordDelay: true,
    };
    const controller = buildMockController(state);

    const { container } = renderHelper(controller);

    // Multi-word chunk elements
    const chunkWords = container.querySelectorAll('.rsvp-chunk-word');
    expect(chunkWords.length).toBe(3);
    expect(chunkWords[0]!.textContent).toBe('The');
    expect(chunkWords[1]!.textContent).toBe('quick');
    expect(chunkWords[2]!.textContent).toBe('brown');
  });

  test('context panel highlights all words in the current chunk simultaneously', () => {
    const state: RsvpState = {
      active: true,
      playing: false,
      words: mockWords,
      currentIndex: 0,
      currentPartIndex: 0,
      wpm: 300,
      punctuationPauseMs: 100,
      splitHyphens: false,
      cjkCharMode: false,
      startDelaySeconds: 0,
      hasCJK: false,
      progress: 0,
      chunkSize: 3,
      enableWarmup: false,
      adaptiveLongWordDelay: true,
    };
    const controller = buildMockController(state);

    const { container } = renderHelper(controller);

    const wordButtons = container.querySelectorAll('[data-rsvp-word-button]');
    // Words at index 0, 1, 2 should not have role="button" because isCurrent=true
    expect(wordButtons[0]!.getAttribute('role')).toBeNull();
    expect(wordButtons[1]!.getAttribute('role')).toBeNull();
    expect(wordButtons[2]!.getAttribute('role')).toBeNull();

    // Words at index 3, 4 should have role="button" (not current)
    expect(wordButtons[3]!.getAttribute('role')).toBe('button');
    expect(wordButtons[4]!.getAttribute('role')).toBe('button');
  });

  test('keyboard shortcuts [ and ] adjust chunk size', () => {
    const state: RsvpState = {
      active: true,
      playing: false,
      words: mockWords,
      currentIndex: 0,
      currentPartIndex: 0,
      wpm: 300,
      punctuationPauseMs: 100,
      splitHyphens: false,
      cjkCharMode: false,
      startDelaySeconds: 0,
      hasCJK: false,
      progress: 0,
      chunkSize: 2,
      enableWarmup: false,
      adaptiveLongWordDelay: true,
    };
    const controller = buildMockController(state);

    renderHelper(controller);

    fireEvent.keyDown(document, { key: ']' });
    expect(controller.setChunkSize).toHaveBeenCalledWith(3);

    fireEvent.keyDown(document, { key: '[' });
    expect(controller.setChunkSize).toHaveBeenLastCalledWith(2);
  });

  test('chunk size selector opens and selects new chunk size', () => {
    const state: RsvpState = {
      active: true,
      playing: false,
      words: mockWords,
      currentIndex: 0,
      currentPartIndex: 0,
      wpm: 300,
      punctuationPauseMs: 100,
      splitHyphens: false,
      cjkCharMode: false,
      startDelaySeconds: 0,
      hasCJK: false,
      progress: 0,
      chunkSize: 1,
      enableWarmup: false,
      adaptiveLongWordDelay: true,
    };
    const controller = buildMockController(state);

    const { getByLabelText, getByTestId } = renderHelper(controller);

    // Click chunk size button in header
    const chunkBtn = getByLabelText('Words per flash');
    fireEvent.click(chunkBtn);

    const dropdown = getByTestId('rsvp-chunk-dropdown');
    expect(dropdown).toBeDefined();

    // Click option 4
    const buttons = dropdown.querySelectorAll('button');
    fireEvent.click(buttons[3]!); // 4 words
    expect(controller.setChunkSize).toHaveBeenCalledWith(4);
  });
});
