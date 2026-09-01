import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

import ImageViewer from '@/app/reader/components/ImageViewer';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => {},
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/app/reader/components/ZoomControls', () => ({
  __esModule: true,
  default: () => null,
}));

afterEach(cleanup);

const gridInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('ImageViewer', () => {
  it('suppresses the native image callout on the zoomed image', () => {
    const { container } = render(
      <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
    );
    expect(container.querySelector('.no-context-menu img')).toBeTruthy();
  });

  const zoomIn = (img: Element) => fireEvent.doubleClick(img);

  it('tracks desktop pan from the stable viewport without pointer capture', () => {
    const { container } = render(
      <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
    );
    const img = container.querySelector('img')!;
    const surface = container.querySelector('.image-pan-surface')!;
    zoomIn(img);

    fireEvent.pointerDown(surface, {
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    });

    fireEvent.mouseMove(window, {
      buttons: 1,
      clientX: 160,
      clientY: 130,
    });

    expect(img.style.transform).toContain('scale(2)');
    expect(img.style.transform).toContain('translate(30px, 15px)');
    expect(surface).not.toBe(img);
  });

  it('disables the transform transition while viewport dragging', () => {
    const { container } = render(
      <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
    );
    const img = container.querySelector('img')!;
    const surface = container.querySelector('.image-pan-surface')!;
    zoomIn(img);

    expect(img.style.transition).not.toBe('none');
    fireEvent.pointerDown(surface, {
      pointerId: 8,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    });
    expect(img.style.transition).toBe('none');

    fireEvent.pointerUp(surface, {
      pointerId: 8,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
    });
    expect(img.style.transition).not.toBe('none');
  });

  it('ends the drag when the window loses focus', () => {
    const { container } = render(
      <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
    );
    const img = container.querySelector('img')!;
    const surface = container.querySelector('.image-pan-surface')!;
    zoomIn(img);

    fireEvent.pointerDown(surface, {
      pointerId: 9,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.mouseMove(window, {
      buttons: 1,
      clientX: 160,
      clientY: 130,
    });
    const positionAfterDrag = img.style.transform;
    expect(surface.getAttribute('style')).toContain('grabbing');

    fireEvent.blur(window);
    expect(surface.getAttribute('style')).toContain('grab');

    fireEvent.mouseMove(window, {
      buttons: 1,
      clientX: 260,
      clientY: 230,
    });
    expect(img.style.transform).toBe(positionAfterDrag);
  });

  it('recovers from a missed pointerup through the window pointermove fallback', () => {
    const { container } = render(
      <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
    );
    const img = container.querySelector('img')!;
    const surface = container.querySelector('.image-pan-surface')!;
    zoomIn(img);

    fireEvent.pointerDown(surface, {
      pointerId: 10,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, {
      pointerId: 10,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 160,
      clientY: 130,
    });
    const positionAfterDrag = img.style.transform;

    fireEvent.pointerMove(window, {
      pointerId: 10,
      pointerType: 'mouse',
      buttons: 0,
      clientX: 220,
      clientY: 180,
    });
    expect(surface.getAttribute('style')).toContain('grab');
    expect(img.style.transform).toBe(positionAfterDrag);
  });

  it('uses window mouseup as a redundant drag-end signal', () => {
    const { container } = render(
      <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
    );
    const img = container.querySelector('img')!;
    const surface = container.querySelector('.image-pan-surface')!;
    zoomIn(img);

    fireEvent.pointerDown(surface, {
      pointerId: 11,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    });
    expect(surface.getAttribute('style')).toContain('grabbing');
    fireEvent.mouseUp(window);
    expect(surface.getAttribute('style')).toContain('grab');
  });

  const measuredViewer = ({
    naturalWidth,
    fitWidth,
    dpr,
  }: {
    naturalWidth: number;
    fitWidth: number;
    dpr: number;
  }) => {
    Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
    const { container } = render(
      <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
    );
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: naturalWidth, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: naturalWidth, configurable: true });
    const viewer = container.querySelector('[aria-label="Image viewer"]') as HTMLElement;
    viewer.getBoundingClientRect = () =>
      ({
        width: fitWidth,
        height: fitWidth,
        top: 0,
        left: 0,
        right: fitWidth,
        bottom: fitWidth,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    act(() => fireEvent.load(img));
    return { container, img };
  };

  const zoomPercent = (container: HTMLElement) =>
    Number(container.querySelector('[aria-label="Zoom level"]')!.textContent!.replace('%', ''));

  it('reports the fraction of the image resolution actually shown when fit to screen', () => {
    const { container } = measuredViewer({ naturalWidth: 1600, fitWidth: 400, dpr: 2 });
    expect(zoomPercent(container)).toBe(50);
  });

  it('double-click zooms to exactly 1:1 (100% = one image pixel per device pixel)', () => {
    const { container, img } = measuredViewer({ naturalWidth: 1200, fitWidth: 400, dpr: 1 });
    act(() => fireEvent.doubleClick(img));
    expect(img.style.transform).toContain('scale(3)');
    expect(zoomPercent(container)).toBe(100);
  });

  it('keeps 1:1 reachable for images larger than the old zoom ceiling', () => {
    const { img } = measuredViewer({ naturalWidth: 20000, fitWidth: 400, dpr: 1 });
    act(() => {
      fireEvent.wheel(img, { deltaY: -20000, ctrlKey: true, clientX: 100, clientY: 100 });
    });
    const reachedScale = Number(/scale\(([\d.]+)\)/.exec(img.style.transform)![1]);
    expect(reachedScale).toBeGreaterThanOrEqual(50);
  });

  describe('committing zoom into the layout size (#5633)', () => {
    it('commits a settled discrete zoom into the layout size', () => {
      vi.useFakeTimers();
      try {
        const { img } = measuredViewer({ naturalWidth: 1600, fitWidth: 400, dpr: 2 });
        expect(img.style.width).toBe('400px');
        act(() => fireEvent.doubleClick(img));
        expect(img.style.transform).toContain('scale(2)');
        act(() => vi.advanceTimersByTime(1000));
        expect(img.style.width).toBe('800px');
        expect(img.style.transform).toContain('scale(1)');
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps a streaming wheel pinch on the transform, then commits up to 1:1', () => {
      vi.useFakeTimers();
      try {
        const { img } = measuredViewer({ naturalWidth: 1600, fitWidth: 400, dpr: 2 });
        act(() => {
          fireEvent.wheel(img, { deltaY: -20000, ctrlKey: true, clientX: 200, clientY: 200 });
        });
        expect(img.style.width).toBe('400px');
        expect(img.style.transform).toContain('scale(8)');
        act(() => vi.advanceTimersByTime(500));
        act(() => vi.advanceTimersByTime(500));
        expect(img.style.width).toBe('800px');
        expect(img.style.transform).toContain('scale(4)');
      } finally {
        vi.useRealTimers();
      }
    });

    it('caps the committed raster size for huge images', () => {
      vi.useFakeTimers();
      try {
        const { img } = measuredViewer({ naturalWidth: 20000, fitWidth: 400, dpr: 1 });
        act(() => {
          fireEvent.wheel(img, { deltaY: -20000, ctrlKey: true, clientX: 200, clientY: 200 });
        });
        act(() => vi.advanceTimersByTime(500));
        act(() => vi.advanceTimersByTime(500));
        expect(img.style.width).toBe('4096px');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('image description caption', () => {
    const caption = 'Tabella di come creare una buona abitudine';

    it('shows the image description over the zoomed image', () => {
      const { container } = render(
        <ImageViewer
          src='blob:test-image'
          caption={caption}
          onClose={vi.fn()}
          gridInsets={gridInsets}
        />,
      );
      expect(container.querySelector('.image-caption')?.textContent).toBe(caption);
      expect(container.querySelector('img')!.getAttribute('alt')).toBe(caption);
    });

    it('renders nothing when the image has no description', () => {
      const { container } = render(
        <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
      );
      expect(container.querySelector('.image-caption')).toBeNull();
    });

    it('toggles the caption when the image is tapped', () => {
      const { container } = render(
        <ImageViewer
          src='blob:test-image'
          caption={caption}
          onClose={vi.fn()}
          gridInsets={gridInsets}
        />,
      );
      const img = container.querySelector('img')!;
      fireEvent.click(img);
      expect(container.querySelector('.image-caption')).toBeNull();
      fireEvent.click(img);
      expect(container.querySelector('.image-caption')?.textContent).toBe(caption);
    });

    it('does not close the viewer when the caption itself is tapped', () => {
      const onClose = vi.fn();
      const { container } = render(
        <ImageViewer
          src='blob:test-image'
          caption={caption}
          onClose={onClose}
          gridInsets={gridInsets}
        />,
      );
      fireEvent.click(container.querySelector('.image-caption')!);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('disables the transform transition during ctrl+wheel (trackpad pinch) zoom', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
      );
      const img = container.querySelector('img')!;
      expect(img.style.transition).not.toBe('none');
      act(() => {
        fireEvent.wheel(img, { deltaY: -50, ctrlKey: true, clientX: 100, clientY: 100 });
      });
      expect(img.style.transition).toBe('none');
      act(() => vi.advanceTimersByTime(500));
      expect(img.style.transition).not.toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });
});
