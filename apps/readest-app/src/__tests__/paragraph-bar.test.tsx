import { act, cleanup, render } from '@testing-library/react';
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

const renderBar = (bookKey = 'book-1') =>
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
