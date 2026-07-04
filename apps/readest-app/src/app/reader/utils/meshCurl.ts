import { PageCurlRenderer } from '@/utils/pageCurl';

/**
 * Mesh page-curl orchestration (readest#555, Tauri platforms).
 *
 * A page turn cannot bend the live page — the page is a slice of one big
 * multi-column iframe. Instead the platform webview captures the outgoing
 * page as a bitmap, the live view turns instantly underneath, and a WebGL
 * overlay bends the captured bitmap over the (already turned) live page:
 *
 *   capture content box → mount overlay drawing the flat capture →
 *   navigate instantly under it → animate/scrub the curl → dispose.
 *
 * Backward turns run the same pipeline mirrored: the current page curls
 * away from the spine edge, revealing the previous page underneath — the
 * same "old page recedes" choreography the View Transitions curl uses.
 *
 * The controller only orchestrates DOM + GL; the host callbacks supply the
 * platform pieces (native capture, instant navigation, geometry), which
 * keeps it independent of stores and testable in a plain browser.
 */
export interface MeshCurlHost {
  /** Element the overlay mounts into (the reader grid cell). */
  getHostElement: () => HTMLElement | null;
  /**
   * Content-box rect (page margins excluded) in viewport CSS px. The
   * header/footer live in the margins, so capturing only the content box
   * keeps them static while the page turns, matching the layered VT turns.
   */
  getContentRect: () => DOMRect | null;
  /** Native webview snapshot of `rect`, as PNG bytes. */
  capture: (rect: { x: number; y: number; width: number; height: number }) => Promise<ArrayBuffer>;
  /** Instant (animation-less) page turn of the live view. */
  navigate: (forward: boolean) => Promise<void>;
}

interface ActiveCurl {
  overlay: HTMLElement;
  renderer: PageCurlRenderer;
  forward: boolean;
  /** Renderer-space mirror flag (spine side of the fold), not book direction. */
  rendererRtl: boolean;
  progress: number;
  grabY: number;
  raf: number;
  /** Resolves when the play-out animation finishes or is interrupted. */
  finish: (() => void) | null;
}

const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (1 - t) * (1 - t) * 2);

export class MeshCurlTurn {
  #host: MeshCurlHost;
  #duration: number;
  #active: ActiveCurl | null = null;
  /** Serializes turns: a new turn interrupts and awaits the previous one. */
  #pending: Promise<unknown> = Promise.resolve();

  constructor(host: MeshCurlHost, options: { duration?: number } = {}) {
    this.#host = host;
    this.#duration = options.duration ?? 450;
  }

  get active(): boolean {
    return this.#active !== null;
  }

  /**
   * Programmatic page turn: curls all the way through. Resolves true when
   * the mesh turn ran; rejects if the platform capture failed (the caller
   * should mark mesh curl unavailable and fall back). `rtl` is the book's
   * page progression direction.
   */
  async turn(forward: boolean, rtl: boolean): Promise<boolean> {
    const run = this.#pending.then(async () => {
      this.#finishActive();
      const active = await this.#setUp(forward, rtl);
      if (!active) return false;
      await this.#playTo(active, 1);
      this.#disposeActive();
      return true;
    });
    // Keep the chain alive after failures so later turns still run.
    this.#pending = run.catch(() => {});
    return run;
  }

  /**
   * Finger-tracked turn: captures, navigates instantly under the overlay,
   * and leaves the curl at progress 0 for `moveDrag` to scrub. Resolves
   * false when the mesh could not start (no host element/rect).
   */
  async beginDrag(forward: boolean, rtl: boolean): Promise<boolean> {
    const run = this.#pending.then(async () => {
      this.#finishActive();
      const active = await this.#setUp(forward, rtl);
      if (!active) return false;
      active.renderer.render(active.progress, this.#grab(active), active.rendererRtl);
      return true;
    });
    this.#pending = run.catch(() => {});
    return run;
  }

  /** Scrub the curl from the finger. Safe to call while beginDrag is pending. */
  moveDrag(progress: number, grabY: number) {
    const active = this.#active;
    if (!active) return;
    active.progress = Math.min(1, Math.max(0, progress));
    active.grabY = grabY;
    active.renderer.render(active.progress, this.#grab(active), active.rendererRtl);
  }

  /**
   * Release the drag: play out to the end (commit) or un-curl and instantly
   * turn the live view back (cancel) — the overlay shows the old page flat
   * while the view underneath returns, so no wrong page ever flashes.
   */
  async endDrag(commit: boolean) {
    const active = this.#active;
    if (!active) return;
    if (commit) {
      await this.#playTo(active, 1);
    } else {
      await this.#playTo(active, 0);
      if (this.#active === active) await this.#host.navigate(!active.forward);
    }
    this.#disposeActive();
  }

  dispose() {
    this.#finishActive();
  }

  async #setUp(forward: boolean, rtl: boolean): Promise<ActiveCurl | null> {
    const hostElement = this.#host.getHostElement();
    const rect = this.#host.getContentRect();
    if (!hostElement || !rect || rect.width <= 0 || rect.height <= 0) return null;

    const png = await this.#host.capture({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
    const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));

    // Position the overlay at the content box within the host element.
    const hostRect = hostElement.getBoundingClientRect();
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'absolute',
      left: `${rect.left - hostRect.left}px`,
      top: `${rect.top - hostRect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      pointerEvents: 'none',
      zIndex: '50',
    });
    hostElement.appendChild(overlay);

    const renderer = new PageCurlRenderer();
    try {
      renderer.attach(overlay, rect.width, rect.height);
      renderer.setTexture(bitmap);
    } catch (error) {
      renderer.dispose();
      overlay.remove();
      throw error;
    } finally {
      bitmap.close();
    }

    const active: ActiveCurl = {
      overlay,
      renderer,
      forward,
      // Forward: the page lifts from its outer edge (right for LTR books).
      // Backward: it lifts from the spine edge — the mirror image.
      rendererRtl: forward ? rtl : !rtl,
      progress: 0,
      grabY: 0.5,
      raf: 0,
      finish: null,
    };
    this.#active = active;

    // First frame draws the captured page exactly covering the content box,
    // hiding the instant page swap happening underneath.
    renderer.render(0, this.#grab(active), active.rendererRtl);
    await this.#host.navigate(forward);
    return active;
  }

  #grab(active: ActiveCurl) {
    return { x: active.rendererRtl ? 0 : 1, y: active.grabY };
  }

  /** Animate the active curl from its current progress to `target`. */
  #playTo(active: ActiveCurl, target: number): Promise<void> {
    return new Promise((resolve) => {
      const from = active.progress;
      const span = target - from;
      if (span === 0) return resolve();
      const duration = Math.max(1, this.#duration * Math.abs(span));
      const start = performance.now();
      active.finish = resolve;
      const step = (now: number) => {
        if (this.#active !== active) return resolve();
        const t = Math.min(1, (now - start) / duration);
        active.progress = from + span * easeInOutQuad(t);
        active.renderer.render(active.progress, this.#grab(active), active.rendererRtl);
        if (t < 1) {
          active.raf = requestAnimationFrame(step);
        } else {
          active.finish = null;
          resolve();
        }
      };
      active.raf = requestAnimationFrame(step);
    });
  }

  /** Tear down the current overlay, resolving any in-flight animation. */
  #finishActive() {
    const active = this.#active;
    if (!active) return;
    this.#active = null;
    cancelAnimationFrame(active.raf);
    active.finish?.();
    active.renderer.dispose();
    active.overlay.remove();
  }

  #disposeActive() {
    this.#finishActive();
  }
}
