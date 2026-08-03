import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

import ImageViewer from '@/app/reader/components/ImageViewer';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

// useKeyDownActions pulls in EnvContext + device store; not under test here.
vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => {},
}));

// ImageViewer reads appService (for the save button) via useEnv; stub it.
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

// ZoomControls reaches into the theme store and Tauri window APIs; stub it out.
vi.mock('@/app/reader/components/ZoomControls', () => ({
  __esModule: true,
  default: () => null,
}));

afterEach(cleanup);

const gridInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('ImageViewer', () => {
  it('suppresses the native image callout on the zoomed image', () => {
    // The WebView's native long-press image callout collides with the
    // viewer's own pinch/pan handlers on Android and freezes the app. The
    // zoomed <img> must live under a `.no-context-menu` ancestor so the
    // global `.no-context-menu img { -webkit-touch-callout: none }` rule
    // disables that callout. Mirrors the book-cover fix (PR #4345).
    const { container } = render(
      <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
    );

    const calloutSafeImage = container.querySelector('.no-context-menu img');
    expect(calloutSafeImage).toBeTruthy();
  });

  // Desktop-only flicker (#4451): the drag pan must keep tracking the pointer
  // even after it leaves the (moving) image, mirroring how the touch path
  // tracks on the full-screen container. Binding the move/up handlers to the
  // <img> meant the pointer crossing the image boundary aborted/restarted the
  // drag, producing the flicker. The drag now tracks on `window`.
  const zoomIn = (img: Element) => {
    // Double-click on a fresh viewer zooms to scale=2 so panning is enabled.
    fireEvent.doubleClick(img);
  };

  it('keeps panning when the pointer leaves the image (tracks on window)', () => {
    const { container } = render(
      <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
    );
    const img = container.querySelector('img')!;
    zoomIn(img);

    fireEvent.mouseDown(img, { clientX: 100, clientY: 100 });
    // Pointer moves while no longer over the image element — handled on window.
    fireEvent.mouseMove(window, { clientX: 160, clientY: 130 });

    // position = (60, 30); transform divides the translate by scale (2).
    expect(img.style.transform).toContain('scale(2)');
    expect(img.style.transform).toContain('translate(30px, 15px)');
  });

  it('disables the transform transition while dragging to avoid lag flicker', () => {
    const { container } = render(
      <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
    );
    const img = container.querySelector('img')!;
    zoomIn(img);

    expect(img.style.transition).not.toBe('none');

    fireEvent.mouseDown(img, { clientX: 100, clientY: 100 });
    expect(img.style.transition).toBe('none');

    fireEvent.mouseUp(window);
    expect(img.style.transition).not.toBe('none');
  });

  // Zoom percentage is relative to the image's own resolution (#5362).
  //
  // `scale` is relative to the fit-to-screen size, so on its own it says
  // nothing about how much of the image's detail is actually on screen: fitting
  // a 1600px illustration into an 800-device-pixel box paints it at half its
  // resolution while the badge claimed "100%". Because the fit size and the
  // device pixel ratio differ per device, the same book showed a different
  // amount of detail on every device at the same reported zoom, and always less
  // than the extracted file in an external viewer. 100% now means one image
  // pixel per device pixel — no interpolation, identical detail everywhere.
  const measuredViewer = ({
    naturalWidth,
    offsetWidth,
    dpr,
  }: {
    naturalWidth: number;
    offsetWidth: number;
    dpr: number;
  }) => {
    Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
    const { container } = render(
      <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
    );
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: naturalWidth, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: naturalWidth, configurable: true });
    // `offsetWidth` is the laid-out (untransformed) width, so it stays the
    // fit-to-screen size at any zoom level.
    Object.defineProperty(img, 'offsetWidth', { value: offsetWidth, configurable: true });
    act(() => {
      fireEvent.load(img);
    });
    return { container, img };
  };

  const zoomPercent = (container: HTMLElement) =>
    Number(container.querySelector('[aria-label="Zoom level"]')!.textContent!.replace('%', ''));

  it('reports the fraction of the image resolution actually shown when fit to screen', () => {
    // 1600 image px painted across 400 CSS px * dpr 2 = 800 device px: half the
    // image's detail is on screen, so the badge must not claim 100%.
    const { container } = measuredViewer({ naturalWidth: 1600, offsetWidth: 400, dpr: 2 });

    expect(zoomPercent(container)).toBe(50);
  });

  it('double-click zooms to exactly 1:1 (100% = one image pixel per device pixel)', () => {
    // Pixel-perfect needs scale 1200 / (400 * 1) = 3, which the old fixed 2x
    // double-click could never land on.
    const { container, img } = measuredViewer({ naturalWidth: 1200, offsetWidth: 400, dpr: 1 });

    act(() => {
      fireEvent.doubleClick(img);
    });

    expect(img.style.transform).toContain('scale(3)');
    expect(zoomPercent(container)).toBe(100);
  });

  it('keeps 1:1 reachable for images larger than the old zoom ceiling', () => {
    // 1:1 needs scale 50 here, far past the old MAX_SCALE of 8 — the full
    // resolution of a large illustration was simply unreachable.
    const { img } = measuredViewer({ naturalWidth: 20000, offsetWidth: 400, dpr: 1 });

    act(() => {
      fireEvent.wheel(img, { deltaY: -20000, ctrlKey: true, clientX: 100, clientY: 100 });
    });

    const reachedScale = Number(/scale\(([\d.]+)\)/.exec(img.style.transform)![1]);
    expect(reachedScale).toBeGreaterThanOrEqual(50);
  });

  // #5232: EPUBs often keep the caption or table description of an
  // illustration in the image's `alt` attribute, which was invisible once the
  // image was opened full screen.
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
      // The zoomed image carries the book's own description too, instead of the
      // placeholder used when the book provides none.
      expect(container.querySelector('img')!.getAttribute('alt')).toBe(caption);
    });

    it('renders nothing when the image has no description', () => {
      const { container } = render(
        <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
      );

      expect(container.querySelector('.image-caption')).toBeNull();
    });

    // The caption sits over the bottom of the image, so tapping the image must
    // get it out of the way (and bring it back).
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

  // Trackpad pinch flicker (#4742): on macOS a trackpad pinch-to-zoom arrives
  // as a rapid stream of ctrl+wheel events. With the 0.05s transition left on,
  // each event restarts the in-flight transition from its interpolated
  // mid-point, so the image lags and flickers — the same root cause as the
  // #4451 pan flicker. The transition must be off while the wheel-zoom gesture
  // is streaming, then return for discrete zoom once the gesture settles.
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

      // After the gesture settles the smoothing returns for discrete zoom.
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(img.style.transition).not.toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });
});
