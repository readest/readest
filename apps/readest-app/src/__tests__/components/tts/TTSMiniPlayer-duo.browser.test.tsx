/**
 * Where the TTS mini player card lands on iPhone Duo, measured with real
 * layout (#6307).
 *
 * The status bar is an 84pt side strip on the Duo and reports as a left or
 * right safe-area inset. The card clears it with left/right offsets. At the
 * sm breakpoint the card is also `sm:w-full`, 100% of its book cell clamped to
 * max-w-md. With two books side by side, the cell next to the strip is about
 * 475px wide, too narrow for 448px plus both offsets, and the card ran 73px
 * past its right offset into the cell's clipped edge. Off the Duo the card
 * keeps main's layout.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { page } from 'vitest/browser';

import '@/styles/globals.css';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: true, hasSafeAreaInset: true } }),
}));
vi.mock('@/store/readerStore', async () => {
  const c = await import('@/services/constants');
  const state = {
    hoveredBookKey: '',
    bottomBarTab: '',
    setHoveredBookKey: () => {},
    getViewSettings: () => ({
      ...c.DEFAULT_VIEW_CONFIG,
      ...c.DEFAULT_BOOK_LAYOUT,
      ...c.DEFAULT_TTS_CONFIG,
    }),
  };
  return { useReaderStore: () => state };
});
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ sectionLabel: 'Chapter 5' }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: { title: 'Alice in Wonderland', coverImageUrl: null } }),
  }),
}));

import TTSMiniPlayer from '@/app/reader/components/tts/TTSMiniPlayer';
import { useThemeStore } from '@/store/themeStore';
import type { Insets } from '@/types/misc';

// max-w-md, and the 16px inset-x-4 margin the card keeps from each edge.
const CARD_MAX = 448;
const MARGIN = 16;
const STRIP = 84;

const renderCard = (width: number, height: number, gridInsets: Insets) => {
  const { container } = render(
    <div style={{ position: 'fixed', left: 0, top: 0, width, height }}>
      <TTSMiniPlayer
        bookKey='b1'
        isPlaying
        buffering={false}
        isEink={false}
        visible
        hasTimeline
        audioTransport={false}
        timeoutTimestamp={0}
        chapterRemainingSec={null}
        gridInsets={gridInsets}
        onTogglePlay={() => {}}
        onBackward={() => {}}
        onForward={() => {}}
        onStop={() => {}}
        onExpand={() => {}}
        onGetPlaybackInfo={() => ({ position: 10, duration: 100, measuredFraction: 0.4 })}
      />
    </div>,
  );
  return container.querySelector<HTMLElement>('[role="status"]')!.getBoundingClientRect();
};

const insets = (left: number, right: number): Insets => ({ top: 0, right, bottom: 0, left });

beforeEach(() => {
  useThemeStore.setState({ isIPhoneDuo: false });
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ isIPhoneDuo: false });
});

describe('TTS mini player on the iPhone Duo inner display (951x669)', () => {
  beforeEach(async () => {
    await page.viewport(951, 669);
  });

  test.each([
    ['left', insets(STRIP, 0)],
    ['right', insets(0, STRIP)],
  ])('stays between the %s strip and the far edge, centred at max-w-md', (_side, gi) => {
    useThemeStore.setState({ isIPhoneDuo: true });
    const card = renderCard(951, 669, gi);
    const lo = gi.left + MARGIN;
    const hi = 951 - gi.right - MARGIN;
    expect(card.left).toBeGreaterThanOrEqual(lo);
    expect(card.right).toBeLessThanOrEqual(hi);
    expect(card.width).toBe(CARD_MAX);
    expect(card.left - lo).toBeCloseTo(hi - card.right, 1);
  });

  // Two books side by side: the card sits in one book's cell (position:
  // relative), about half the display wide.
  test('in the book cell next to the strip, it fits between the offsets', () => {
    useThemeStore.setState({ isIPhoneDuo: true });
    const card = renderCard(475, 669, insets(STRIP, 0));
    expect(card.left).toBe(STRIP + MARGIN);
    expect(card.right).toBe(475 - MARGIN);
  });

  test('off the Duo the card is centred on the full width, as on main', () => {
    const card = renderCard(951, 669, insets(STRIP, 0));
    expect(card.width).toBe(CARD_MAX);
    expect(card.left).toBeCloseTo((951 - CARD_MAX) / 2, 1);
  });
});

describe('TTS mini player below the sm breakpoint', () => {
  test('on the Duo cover display (466x678) it spans from the strip to the margin', async () => {
    await page.viewport(466, 678);
    useThemeStore.setState({ isIPhoneDuo: true });
    const card = renderCard(466, 678, insets(STRIP, 0));
    expect(card.left).toBe(STRIP + MARGIN);
    expect(card.right).toBe(466 - MARGIN);
  });

  test('off the Duo (393x852) it keeps the inset-x-4 margins, as on main', async () => {
    await page.viewport(393, 852);
    const card = renderCard(393, 852, insets(0, 0));
    expect(card.left).toBe(MARGIN);
    expect(card.right).toBe(393 - MARGIN);
  });
});
