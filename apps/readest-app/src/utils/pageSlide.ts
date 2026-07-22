import { CurlGrab } from '@/utils/pageCurl';

const EDGE_SHADOW_WIDTH_PX = 28;
const SETTLE_KEYFRAME_STEPS = 32;

export interface PageSlideSettleOptions {
  from: number;
  target: number;
  rtl: boolean;
  duration: number;
  easing: (progress: number) => number;
}

/**
 * Slide renderer for the captured page-turn pipeline (readest#555). Draws
 * the captured outgoing page on a plain 2D canvas and translates it
 * horizontally out of the reader cell — the flat sibling of the WebGL
 * `PageCurlRenderer`, used by mobile Tauri so the outgoing page can be
 * captured and decoded ahead of the gesture (and as the fallback where View
 * Transitions are unavailable).
 *
 * Mirrors the paginator's VT slide choreography: the moving page exits
 * toward the spine side on forward turns with a soft edge shadow, while the
 * overlay clips the moving sheet to its original reader cell.
 */
export class PageSlideRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private sheet: HTMLDivElement | null = null;
  private edgeShadow: HTMLDivElement | null = null;
  private shadowRtl: boolean | null = null;
  private width = 0;

  /** Mount the overlay canvas covering `rect` (CSS px) inside `container`. */
  attach(container: HTMLElement, width: number, height: number, dpr = window.devicePixelRatio) {
    this.width = width;
    // The page slides past the container edge; clip it like the VT version
    // clips its transition group to the content box.
    container.style.overflow = 'hidden';

    // Move one compositor-friendly sheet containing both the page and its
    // trailing edge. A narrow static gradient replaces the full-canvas blur,
    // avoiding an oversized shadow raster around all four sides.
    const sheet = document.createElement('div');
    sheet.dataset['pageSlideSheet'] = '';
    Object.assign(sheet.style, {
      position: 'absolute',
      inset: '0',
      width: `${width}px`,
      height: `${height}px`,
      pointerEvents: 'none',
      willChange: 'transform',
      backfaceVisibility: 'hidden',
      transform: 'translate3d(0px, 0, 0)',
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: `${width}px`,
      height: `${height}px`,
      pointerEvents: 'none',
    });

    const edgeShadow = document.createElement('div');
    edgeShadow.dataset['pageSlideShadow'] = '';
    Object.assign(edgeShadow.style, {
      position: 'absolute',
      top: '0',
      bottom: '0',
      width: `${EDGE_SHADOW_WIDTH_PX}px`,
      pointerEvents: 'none',
    });

    sheet.append(canvas, edgeShadow);
    container.appendChild(sheet);
    this.canvas = canvas;
    this.sheet = sheet;
    this.edgeShadow = edgeShadow;
    this.updateShadowDirection(false);
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
    if (!this.sheet) return;
    this.updateShadowDirection(rtl);
    this.sheet.style.transform = this.transformAt(progress, rtl);
  }

  /**
   * Settle the flat page with compositor-owned transform keyframes. The
   * controller supplies its existing easing function, sampled here so old
   * WebViews do not need CSS linear() support.
   */
  animateSettle(options: PageSlideSettleOptions): Animation | null {
    const sheet = this.sheet;
    if (!sheet || typeof sheet.animate !== 'function') return null;
    this.updateShadowDirection(options.rtl);
    const span = options.target - options.from;
    const keyframes = Array.from({ length: SETTLE_KEYFRAME_STEPS + 1 }, (_, index) => {
      const offset = index / SETTLE_KEYFRAME_STEPS;
      const progress = options.from + span * options.easing(offset);
      return { offset, transform: this.transformAt(progress, options.rtl) };
    });
    try {
      return sheet.animate(keyframes, {
        duration: options.duration,
        easing: 'linear',
        fill: 'both',
      });
    } catch {
      return null;
    }
  }

  private transformAt(progress: number, rtl: boolean) {
    const shift = (rtl ? 1 : -1) * progress * this.width;
    return `translate3d(${shift}px, 0, 0)`;
  }

  private updateShadowDirection(rtl: boolean) {
    const shadow = this.edgeShadow;
    if (!shadow || this.shadowRtl === rtl) return;
    this.shadowRtl = rtl;
    if (rtl) {
      shadow.style.left = `${-EDGE_SHADOW_WIDTH_PX}px`;
      shadow.style.background = 'linear-gradient(to right, transparent, rgba(0, 0, 0, 0.35))';
    } else {
      shadow.style.left = '100%';
      shadow.style.background = 'linear-gradient(to right, rgba(0, 0, 0, 0.35), transparent)';
    }
  }

  dispose() {
    this.sheet?.remove();
    this.canvas = null;
    this.sheet = null;
    this.edgeShadow = null;
    this.shadowRtl = null;
  }
}
