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
