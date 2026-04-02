import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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

HTMLElement.prototype.setPointerCapture = vi.fn();
HTMLElement.prototype.releasePointerCapture = vi.fn();

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

    HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 1000,
      width: 800,
      height: 1000,
      toJSON: () => ({}),
    }));
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

    eventDispatcher.dispatchSync('reading-ruler-move', {
      bookKey: 'book-1',
      direction: 'forward',
    });

    await waitFor(() => {
      const ruler = container.querySelector('.ruler') as HTMLDivElement;
      const overlays = container.querySelectorAll('.bg-base-100');

      expect(ruler.style.top).toBe('37.8%');
      expect(ruler.style.transition).toContain('top 0.6s');
      expect(overlays[0]?.getAttribute('style')).toContain('transition: height 0.6s');
      expect(overlays[1]?.getAttribute('style')).toContain('transition: height 0.6s');
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

  it('keeps the drag handle anchored instead of snapping the ruler center to the pointer', () => {
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

    const ruler = container.querySelector('.ruler') as HTMLDivElement;
    const topHandle = container.querySelector('.cursor-row-resize') as HTMLDivElement;

    expect(ruler.style.top).toBe('33%');

    fireEvent.pointerDown(topHandle, { pointerId: 1, clientY: 306 });
    fireEvent.pointerMove(topHandle, { pointerId: 1, clientY: 316 });

    expect(ruler.style.top).toBe('34%');
  });

  it('does not consume ruler movement when already at the boundary', () => {
    render(
      <ReadingRuler
        bookKey='book-1'
        isVertical={false}
        rtl={false}
        lines={2}
        position={97.6}
        opacity={0.5}
        color='transparent'
        bookFormat='EPUB'
        viewSettings={viewSettings}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />,
    );

    const consumed = eventDispatcher.dispatchSync('reading-ruler-move', {
      bookKey: 'book-1',
      direction: 'forward',
    });

    expect(consumed).toBe(false);
    expect(saveViewSettings).not.toHaveBeenCalled();
  });
});
