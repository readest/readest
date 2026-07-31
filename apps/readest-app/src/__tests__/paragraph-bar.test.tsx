import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ParagraphBar from '@/app/reader/components/paragraph/ParagraphBar';
import { eventDispatcher } from '@/utils/event';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasSafeAreaInset: false } }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ hoveredBookKey: '' }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const renderBar = (bookKey = 'book-1', props: Record<string, unknown> = {}) =>
  render(
    <ParagraphBar
      bookKey={bookKey}
      currentIndex={0}
      totalParagraphs={10}
      onPrev={vi.fn()}
      onNext={vi.fn()}
      onClose={vi.fn()}
      viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: false } as never}
      gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      fontScaleIndex={0}
      onFontScaleIndexChange={vi.fn()}
      {...props}
    />,
  );

const getBarRoot = (container: HTMLElement) => container.querySelector('.z-50') as HTMLElement;

describe('ParagraphBar', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('is centered on the viewport (fixed), not the offset gridcell (absolute)', () => {
    const { container } = renderBar();
    const root = getBarRoot(container);

    expect(root.className).toContain('fixed');
    expect(root.className).not.toContain('absolute');
    expect(root.className).toContain('left-1/2');
    expect(root.className).toContain('-translate-x-1/2');
  });

  it('fades in and out only, with no slide, scale, or blur (#5275)', () => {
    vi.useFakeTimers();
    const { container } = renderBar();
    const root = getBarRoot(container);

    expect(root.className).toContain('transition-opacity');
    expect(root.className).toContain('opacity-100');

    act(() => {
      vi.advanceTimersByTime(2600);
    });

    expect(root.className).toContain('opacity-0');
    // The centering -translate-x-1/2 stays; the motion extras must not.
    expect(root.className).not.toMatch(/translate-y/);
    expect(root.className).not.toMatch(/scale-/);
    expect(root.className).not.toMatch(/blur/);
  });

  it('wears the TTS mini player card chrome: solid surface, no backdrop blur (#5275)', () => {
    const { container } = renderBar();
    const card = getBarRoot(container).firstElementChild as HTMLElement;

    expect(card.className).toContain('not-eink:bg-base-300');
    expect(card.className).toContain('eink-bordered');
    expect(card.className).toContain('rounded-2xl');
    expect(card.className).toContain('shadow-lg');
    expect(card.className).toContain('h-14');
    expect(card.className).not.toContain('backdrop-blur');
    expect(card.className).not.toMatch(/not-eink:border\b/);
  });

  it('renders the position as plain UI text without the per-digit animation (#5275)', () => {
    const { container } = renderBar();

    expect(container.textContent).toContain('1 / 10');
    expect(container.textContent).toContain('10%');
    expect(container.querySelector('style')).toBeNull();
    expect(container.innerHTML).not.toContain('subtle-slide-up');
  });

  describe('display settings panel (#5246)', () => {
    it('opens from the gear and steps the font scale', () => {
      const onChange = vi.fn();
      const { container, getByLabelText } = renderBar('book-1', {
        fontScaleIndex: 1,
        onFontScaleIndexChange: onChange,
      });

      // Panel is closed until the gear is pressed.
      expect(container.textContent).not.toContain('Font Size');

      fireEvent.click(getByLabelText('Settings'));
      expect(container.textContent).toContain('Font Size');
      expect(container.textContent).toContain('115%');

      fireEvent.click(getByLabelText('Increase font size'));
      expect(onChange).toHaveBeenCalledWith(2);
      fireEvent.click(getByLabelText('Decrease font size'));
      expect(onChange).toHaveBeenCalledWith(0);
    });

    it('keeps the bar visible while the panel is open', () => {
      vi.useFakeTimers();
      const { container, getByLabelText } = renderBar();
      fireEvent.click(getByLabelText('Settings'));

      act(() => {
        vi.advanceTimersByTime(2600);
      });

      expect(getBarRoot(container).className).toContain('pointer-events-auto');
    });
  });

  describe('show-controls event', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('reappears when paragraph-show-controls fires for its book', async () => {
      const { container } = renderBar('book-1');
      const root = getBarRoot(container);

      expect(root.className).toContain('pointer-events-auto');

      act(() => {
        vi.advanceTimersByTime(2600);
      });
      expect(root.className).toContain('pointer-events-none');

      await act(async () => {
        await eventDispatcher.dispatch('paragraph-show-controls', { bookKey: 'book-1' });
      });
      expect(root.className).toContain('pointer-events-auto');
    });

    it('ignores paragraph-show-controls for a different book', async () => {
      const { container } = renderBar('book-1');
      const root = getBarRoot(container);

      act(() => {
        vi.advanceTimersByTime(2600);
      });
      expect(root.className).toContain('pointer-events-none');

      await act(async () => {
        await eventDispatcher.dispatch('paragraph-show-controls', { bookKey: 'other-book' });
      });
      expect(root.className).toContain('pointer-events-none');
    });
  });
});
