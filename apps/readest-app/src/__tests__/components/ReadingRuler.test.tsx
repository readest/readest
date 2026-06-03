import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingRuler from '@/app/reader/components/ReadingRuler';
import { BookFormat, ViewSettings } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

const saveViewSettings = vi.fn();

type RulerTestRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

// Mutable doubles read lazily by the store mock so individual tests can drive
// the progress range and the scrolled-mode visible contents.
let mockProgress: { range: unknown; pageinfo: { current: number } } | null = null;
let mockContents: Array<{ doc: unknown }> = [];

vi.mock('@/context/EnvContext', () => {
  // Stable envConfig ref; an unstable one would churn the throttled save → ruler
  // setter → applyBlock callbacks and make the cache effect re-run every render.
  const env = { envConfig: {} };
  return { useEnv: () => env };
});

vi.mock('@/store/readerStore', () => {
  // Stable store-method references (zustand returns the same selectors across
  // renders); the ReadingRuler cache effect lists getView as a dependency, so an
  // unstable ref would make it re-run on every render.
  const getProgress = () => mockProgress;
  const getView = () => ({ renderer: { columnCount: 1, getContents: () => mockContents } });
  const store = { getProgress, getView };
  return { useReaderStore: () => store };
});

// Evenly spaced single-column text lines in iframe-content coordinates.
const makeLineRects = (count: number, pitch: number, height: number): RulerTestRect[] =>
  Array.from({ length: count }, (_, i) => ({
    top: i * pitch,
    bottom: i * pitch + height,
    left: 50,
    right: 750,
    width: 700,
    height,
  }));

// A single visible section whose iframe is offset by `frameTop` along the scroll
// axis (negative = scrolled down). `buildScrolledLineBoxes` walks these contents.
const makeScrolledContents = (
  frameTop: number,
  lineRects: RulerTestRect[],
): Array<{ doc: unknown }> => {
  const doc: {
    body: object;
    createRange: () => unknown;
    defaultView: { frameElement: { getBoundingClientRect: () => DOMRect } };
  } = {
    body: {},
    createRange: () => ({
      startContainer: { ownerDocument: doc },
      selectNodeContents: () => {},
      getClientRects: () => lineRects,
    }),
    defaultView: {
      frameElement: {
        getBoundingClientRect: () =>
          ({
            x: 0,
            y: frameTop,
            top: frameTop,
            left: 0,
            right: 800,
            bottom: frameTop + 5000,
            width: 800,
            height: 5000,
            toJSON: () => ({}),
          }) as DOMRect,
      },
    },
  };
  return [{ doc }];
};

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
    mockProgress = null;
    mockContents = [];

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

      // With no progress range available the handler falls back to fixed
      // stepping; the fallback band size is base + 2*padding = 48 + 2*7 = 62,
      // so a 1000px viewport steps from 33% to (330 + 62) / 1000 = 39.2%.
      expect(parseFloat(ruler.style.top)).toBeCloseTo(39.2, 5);
      expect(ruler.style.transition).toContain('top 0.6s');
      expect(overlays[0]?.getAttribute('style')).toContain('transition: height 0.6s');
      expect(overlays[1]?.getAttribute('style')).toContain('transition: height 0.6s');
      expect(saveViewSettings).toHaveBeenCalledWith(
        {},
        'book-1',
        'readingRulerPosition',
        expect.closeTo(39.2),
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
        position={96.9}
        opacity={0.5}
        color='transparent'
        bookFormat='EPUB'
        viewSettings={viewSettings}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />,
    );

    // 96.9% is the clamp max for the fallback band of 62px in a 1000px viewport
    // (100 - (62 / 2 / 1000) * 100), so a forward step cannot advance further.
    const consumed = eventDispatcher.dispatchSync('reading-ruler-move', {
      bookKey: 'book-1',
      direction: 'forward',
    });

    expect(consumed).toBe(false);
    expect(saveViewSettings).not.toHaveBeenCalled();
  });

  // Regression: issue #4386 — in scrolled mode the ruler used to re-snap on every
  // relocate fired while scrolling, so its position crept down the page. It must
  // stay fixed on screen while scrolling; snapping only happens on click.
  it('keeps the ruler fixed on screen while scrolling in scrolled mode', () => {
    const lineRects = makeLineRects(50, 100, 40);
    mockProgress = { range: {}, pageinfo: { current: 0 } };
    mockContents = makeScrolledContents(0, lineRects);
    const scrolledSettings = { ...viewSettings, scrolled: true } as ViewSettings;

    const props = {
      bookKey: 'book-1',
      isVertical: false,
      rtl: false,
      lines: 2,
      position: 50,
      opacity: 0.5,
      color: 'transparent' as const,
      bookFormat: 'EPUB' as BookFormat,
      viewSettings: scrolledSettings,
      gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    };

    const { container, rerender } = render(<ReadingRuler {...props} />);
    const rulerTop = () =>
      parseFloat((container.querySelector('.ruler') as HTMLDivElement).style.top);

    // Initial mount snaps the band to a real line, moving it off the 50% prop.
    const initialTop = rulerTop();
    expect(initialTop).toBeGreaterThan(50);

    // Simulate scrolling: a new relocate range arrives with the content shifted
    // up, but the section/page is unchanged.
    mockProgress = { range: {}, pageinfo: { current: 0 } };
    mockContents = makeScrolledContents(-130, lineRects);
    rerender(<ReadingRuler {...props} />);

    // The band must not move on its own as the reader scrolls.
    expect(rulerTop()).toBeCloseTo(initialTop, 5);
  });

  it('still snaps the ruler to lines when advancing by click in scrolled mode', async () => {
    const lineRects = makeLineRects(50, 100, 40);
    mockProgress = { range: {}, pageinfo: { current: 0 } };
    mockContents = makeScrolledContents(0, lineRects);
    const scrolledSettings = { ...viewSettings, scrolled: true } as ViewSettings;

    const { container } = render(
      <ReadingRuler
        bookKey='book-1'
        isVertical={false}
        rtl={false}
        lines={2}
        position={50}
        opacity={0.5}
        color='transparent'
        bookFormat='EPUB'
        viewSettings={scrolledSettings}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />,
    );
    const rulerTop = () =>
      parseFloat((container.querySelector('.ruler') as HTMLDivElement).style.top);
    const before = rulerTop();

    const consumed = eventDispatcher.dispatchSync('reading-ruler-move', {
      bookKey: 'book-1',
      direction: 'forward',
    });

    expect(consumed).toBe(true);
    await waitFor(() => {
      expect(rulerTop()).toBeGreaterThan(before);
    });
  });
});
