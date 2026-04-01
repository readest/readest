import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingRuler from '@/app/reader/components/ReadingRuler';
import { ViewSettings } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

const saveViewSettings = vi.fn();

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getProgress: () => null,
  }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: (...args: unknown[]) => saveViewSettings(...args),
}));

global.ResizeObserver = class ResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
};

describe('ReadingRuler', () => {
  const viewSettings = {
    defaultFontSize: 16,
    lineHeight: 1.5,
  } as ViewSettings;

  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 1000,
    });

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 800,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the ruler body pass-through and exposes dedicated drag handles', () => {
    const { container } = render(
      <ReadingRuler
        bookKey='book-1'
        isVertical={false}
        rtl={false}
        lines={2}
        position={33}
        opacity={0.5}
        color='transparent'
        bookFormat='EPUB'
        viewSettings={viewSettings}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />,
    );

    const ruler = container.querySelector('.ruler');
    const dragHandles = container.querySelectorAll('.cursor-row-resize');

    expect(ruler?.className).toContain('pointer-events-none');
    expect(dragHandles).toHaveLength(2);
    dragHandles.forEach((handle) => {
      expect(handle.className).toContain('pointer-events-auto');
    });
  });

  it('moves and persists the ruler position when a ruler-step event is dispatched', async () => {
    const { container } = render(
      <ReadingRuler
        bookKey='book-1'
        isVertical={false}
        rtl={false}
        lines={2}
        position={33}
        opacity={0.5}
        color='transparent'
        bookFormat='EPUB'
        viewSettings={viewSettings}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />,
    );

    await eventDispatcher.dispatch('reading-ruler-move', {
      bookKey: 'book-1',
      direction: 'forward',
    });

    await waitFor(() => {
      const ruler = container.querySelector('.ruler') as HTMLDivElement;
      expect(ruler.style.top).toBe('37.8%');
      expect(saveViewSettings).toHaveBeenCalledWith(
        {},
        'book-1',
        'readingRulerPosition',
        37.8,
        false,
        false,
      );
    });
  });
});
