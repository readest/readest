import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import RSVPOverlay from '@/app/reader/components/rsvp/RSVPOverlay';
import type { RSVPController, RsvpState } from '@/services/rsvp';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    themeCode: { primary: '#000', bg: '#fff', fg: '#111' },
    isDarkMode: false,
  }),
}));

await import('@/styles/globals.css');

const buildState = (text: string, orpIndex: number, hasCJK = false): RsvpState => ({
  active: true,
  playing: false,
  words: [{ text, orpIndex, pauseMultiplier: 1 }],
  currentIndex: 0,
  currentPartIndex: 0,
  wpm: 300,
  punctuationPauseMs: 100,
  splitHyphens: false,
  cjkCharMode: false,
  startDelaySeconds: 3,
  hasCJK,
  progress: 0,
});

const renderWord = (text: string, orpIndex: number, hasCJK = false) => {
  const state = buildState(text, orpIndex, hasCJK);
  const controller = {
    get currentState() {
      return state;
    },
    get currentDisplayWord() {
      return state.words[0];
    },
    get currentCountdown() {
      return null;
    },
    getWpmOptions: vi.fn(() => [100, 200, 300]),
    getPunctuationPauseOptions: vi.fn(() => [25, 50, 100]),
    getStartDelayOptions: vi.fn(() => [0, 1, 2, 3]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return render(
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
};

const rect = (container: HTMLElement, selector: string) =>
  (container.querySelector(selector) as HTMLElement).getBoundingClientRect();

describe('RSVPOverlay — focus cluster (#7024)', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  test('keeps the text before and after clear of a Bengali conjunct focus', () => {
    // বন্ধু at index 1: the focus is the whole conjunct ন্ধু, wider than one letter.
    const { container } = renderWord('বন্ধু', 1);
    expect(container.querySelector('.rsvp-word-orp')?.textContent).toBe('ন্ধু');
    const focus = rect(container, '.rsvp-word-orp');
    expect(rect(container, '.rsvp-word-before').right).toBeLessThanOrEqual(focus.left + 1);
  });

  test('keeps the text after clear of a focus with a pre-base vowel sign', () => {
    const { container } = renderWord('কিন্তু', 0);
    expect(container.querySelector('.rsvp-word-orp')?.textContent).toBe('কি');
    const focus = rect(container, '.rsvp-word-orp');
    expect(rect(container, '.rsvp-word-after').left).toBeGreaterThanOrEqual(focus.right - 1);
  });

  test('measures the focus when Highlight Word is turned off', () => {
    // Under Highlight Word a CJK word renders whole, with no focus span to
    // measure; turning it off splits the word around ক্ষ্মী.
    localStorage.setItem('readest_rsvp_cjk_highlight_word', '1');
    const { container } = renderWord('ক্ষ্মী中', 0, true);
    expect(container.querySelector('.rsvp-word-orp')).toBeNull();
    fireEvent.click(container.querySelector('[aria-label="Settings"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-testid="rsvp-highlight-word-toggle"]')!);
    const focus = rect(container, '.rsvp-word-orp');
    expect(rect(container, '.rsvp-word-after').left).toBeGreaterThanOrEqual(focus.right - 1);
  });
});
