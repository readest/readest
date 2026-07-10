import { CurlGrab } from '@/utils/pageCurl';

/**
 * Slide renderer for the captured page-turn pipeline (readest#555). Draws
 * the captured outgoing page on a plain 2D canvas and translates it
 * horizontally out of the content box — the flat sibling of the WebGL
 * `PageCurlRenderer`, used where the View Transitions slide is unavailable
 * (iOS 18 WebKit crashes on it; older engines lack the API).
 *
 * Mirrors the paginator's VT slide choreography: the moving page exits
 * toward the spine side on forward turns with a soft edge shadow, clipped
 * to the content box so the margins stay still.
 */
export class PageSlideRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private width = 0;

  /** Mount the overlay canvas covering `rect` (CSS px) inside `container`. */
  attach(container: HTMLElement, width: number, height: number, dpr = window.devicePixelRatio) {
    this.width = width;
    // The page slides past the container edge; clip it like the VT version
    // clips its transition group to the content box.
    container.style.overflow = 'hidden';
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: `${width}px`,
      height: `${height}px`,
      pointerEvents: 'none',
      boxShadow: '0 0 24px rgba(0, 0, 0, 0.35)',
    });
    container.appendChild(canvas);
    this.canvas = canvas;
  }

  /** Draw the captured page (at progress 0 it exactly covers). */
  setTexture(source: CanvasImageSource) {
    const canvas = this.canvas;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }

  /**
   * Slide the page at `progress` (0 = flat, 1 = fully out). `rtl` is the
   * renderer-space mirror flag shared with the curl: false exits left (the
   * spine side of a forward LTR turn), true exits right.
   */
  render(progress: number, _grab: CurlGrab = { x: 1, y: 0.5 }, rtl = false) {
    if (!this.canvas) return;
    const shift = (rtl ? 1 : -1) * progress * this.width;
    this.canvas.style.transform = `translateX(${shift}px)`;
  }

  dispose() {
    this.canvas?.remove();
    this.canvas = null;
  }
}
