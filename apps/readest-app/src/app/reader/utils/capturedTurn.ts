import { CurlGrab, PageCurlRenderer } from '@/utils/pageCurl';
import { PageSlideRenderer } from '@/utils/pageSlide';

/**
 * Captured page-turn orchestration (readest#555, Tauri platforms).
 *
 * A page turn cannot move the live page as a layer — the page is a slice of
 * one big multi-column iframe. Instead the platform webview captures the
 * outgoing page as a bitmap, the live view turns instantly underneath, and
 * an overlay animates the captured bitmap over the (already turned) live
 * page:
 *
 *   capture content box → mount overlay drawing the flat capture →
 *   navigate instantly under it → animate/scrub the turn → dispose.
 *
 * Two overlay renderers share the pipeline: the WebGL mesh curl, and the
 * flat slide for engines where the View Transitions slide is unavailable
 * (iOS 18 WebKit crashes on it; older engines lack the API).
 *
 * Backward turns run the same pipeline mirrored: the current page curls or
 * slides away from the spine edge, revealing the previous page underneath —
 * the same "old page recedes" choreography the View Transitions turns use.
 *
 * The controller only orchestrates DOM + rendering; the host callbacks
 * supply the platform pieces (native capture, instant navigation,
 * geometry), which keeps it independent of stores and testable in a plain
 * browser.
 */
export interface CapturedTurnHost {
  /** Element the overlay mounts into (the reader grid cell). */
  getHostElement: () => HTMLElement | null;
  /**
   * Rect of the page to capture and turn, in viewport CSS px. The whole
   * reader cell — running header, footer, and margins included — turns
   * like a physical sheet, matching Apple Books.
   */
  getContentRect: () => DOMRect | null;
  /** Native webview snapshot of `rect`, as PNG bytes. */
  capture: (rect: { x: number; y: number; width: number; height: number }) => Promise<ArrayBuffer>;
  /**
   * Theme paper (background color + texture) drawn on the back of the
   * curling page. Fetched concurrently with the capture; a missing or
   * failing backdrop falls back to the renderer's plain white back.
   */
  getBackdrop?: () => Promise<TexImageSource | null> | TexImageSource | null;
  /** Records live UI state before the native snapshot starts. */
  onBeforeCapture?: (style: CapturedTurnStyle) => void | Promise<void>;
  /** Called once the flat captured frame covers the live reader. */
  onCovered?: (style: CapturedTurnStyle) => void | Promise<void>;
  /** Called under the restored flat frame before a cancelled turn is removed. */
  onCancelled?: (style: CapturedTurnStyle) => void | Promise<void>;
  /** Instant (animation-less) page turn of the live view. */
  navigate: (forward: boolean) => Promise<void>;
}

export type CapturedTurnStyle = 'curl' | 'slide';

/** What the overlay draws each frame; PageCurlRenderer and PageSlideRenderer. */
interface TurnRenderer {
  attach(container: HTMLElement, width: number, height: number): void;
  setTexture(source: ImageBitmap): void;
  setBackdrop?(source: TexImageSource): void;
  render(progress: number, grab: CurlGrab, rtl: boolean): void;
  dispose(): void;
}

interface DragSession {
  progress: number;
  grabY: number;
}

interface ActiveTurn {
  overlay: HTMLElement;
  renderer: TurnRenderer;
  style: CapturedTurnStyle;
  forward: boolean;
  /** Renderer-space mirror flag (spine side of the turn), not book direction. */
  rendererRtl: boolean;
  progress: number;
  grabY: number;
  /** Buffered input and identity token, absent for programmatic turns. */
  dragSession: DragSession | null;
  raf: number;
  /** Resolves when the play-out animation finishes or is interrupted. */
  finish: (() => void) | null;
}

const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (1 - t) * (1 - t) * 2);

export class CapturedPageTurn {
  #host: CapturedTurnHost;
  #duration: number;
  #active: ActiveTurn | null = null;
  /** Latest sample and identity for the currently open finger drag. */
  #dragSession: DragSession | null = null;
  #disposed = false;
  /** Serializes drag setup/settle and accepted programmatic turns. */
  #pending: Promise<unknown> = Promise.resolve();
  /** True while a programmatic `turn()` is running, gating concurrent ones. */
  #running = false;

  constructor(host: CapturedTurnHost, options: { duration?: number } = {}) {
    this.#host = host;
    this.#duration = options.duration ?? 450;
  }

  get active(): boolean {
    return this.#active !== null;
  }

  /**
   * Programmatic page turn: animates all the way through. Resolves true
   * when the captured turn ran; rejects if the platform capture failed (the
   * caller should mark the capture unavailable and fall back). `rtl` is the
   * book's page progression direction.
   */
  async turn(forward: boolean, rtl: boolean, style: CapturedTurnStyle = 'curl'): Promise<boolean> {
    // Programmatic turns (keys, taps, wheel, hardware page-turner) mirror the
    // paginator's #locked push turn: while one is still running, drop the next
    // instead of queuing it. A finger drag carries its own gesture and uses the
    // begin/move/end path; a keyed turn has none, so without this gate a rapid
    // or spurious opposite key — e.g. the echo an iOS volume press emits when
    // the session volume is reset — queues behind the animation and turns the
    // page straight back the moment the first turn lands.
    if (this.#running) return false;
    this.#running = true;
    // An accepted keyboard/tap turn can also race a touch sequence whose end
    // event was dropped. Restore that drag before capturing the new turn.
    this.#cancelOpenDrag();
    const run = this.#pending.then(async () => {
      try {
        if (this.#disposed) return false;
        this.#finishActive();
        const active = await this.#setUp(forward, rtl, style);
        if (!active) return false;
        try {
          await this.#playTo(active, 1);
          return true;
        } finally {
          if (this.#active === active) this.#disposeActive();
        }
      } finally {
        // Release the gate as the turn settles, before the caller's awaiter
        // resumes, so a genuine sequential turn is never mistaken for a
        // concurrent one.
        this.#running = false;
      }
    });
    // Keep the chain alive after failures so later turns still run.
    this.#pending = run.catch(() => {});
    return run;
  }

  /**
   * Finger-tracked turn: captures, navigates instantly under the overlay,
   * then applies the latest `moveDrag` sample (including samples buffered
   * during capture). Resolves false when the turn could not start (no host
   * element/rect).
   */
  async beginDrag(
    forward: boolean,
    rtl: boolean,
    style: CapturedTurnStyle = 'curl',
  ): Promise<boolean> {
    // A replacement drag can arrive when a platform drops the previous
    // touchend. Cancel that specific request before queueing the new one;
    // token matching keeps the synthesized cancellation on its own overlay.
    this.#cancelOpenDrag();
    const session: DragSession = { progress: 0, grabY: 0.5 };
    this.#dragSession = session;
    const run = this.#pending.then(async () => {
      if (this.#disposed) {
        if (this.#dragSession === session) this.#dragSession = null;
        return false;
      }
      this.#finishActive();
      try {
        const active = await this.#setUp(forward, rtl, style, session);
        if (!active) {
          if (this.#dragSession === session) this.#dragSession = null;
          return false;
        }
        // A sample may have arrived before native capture produced an active
        // overlay. Apply it before beginDrag resolves, so a queued endDrag
        // always settles from the latest finger position rather than zero.
        this.#applyDragSession(active, session);
        return true;
      } catch (error) {
        if (this.#dragSession === session) this.#dragSession = null;
        throw error;
      }
    });
    this.#pending = run.catch(() => {});
    return run;
  }

  /** Scrub the turn from the finger. Safe to call while beginDrag is pending. */
  moveDrag(progress: number, grabY: number) {
    const session = this.#dragSession;
    if (!session) return;
    session.progress = Math.min(1, Math.max(0, progress));
    session.grabY = grabY;
    const active = this.#active;
    // A following drag can be queued while the previous overlay is settling.
    // Never paint the new gesture's sample onto that older page.
    if (!active || active.dragSession !== session) return;
    this.#applyDragSession(active, session);
  }

  /**
   * Release the drag: play out to the end (commit) or animate back flat and
   * instantly turn the live view back (cancel) — the overlay shows the old
   * page flat while the view underneath returns, so no wrong page ever
   * flashes.
   *
   * Serialized on the same chain as beginDrag: the release can arrive while
   * the drag's async capture is still in flight (after an instant-highlight
   * release, the gesture's queued trailing touchmoves race the unlock and can
   * start a drag milliseconds before the touchend). A direct no-op here left
   * that drag stranded — overlay frozen at progress 0 over an already-turned
   * live view, making every following turn off by one page.
   */
  async endDrag(commit: boolean) {
    const session = this.#dragSession;
    if (!session) return;
    // Seal the released sample immediately. Late touchmoves cannot mutate a
    // page that has already started committing or returning, while a new
    // beginDrag can safely install its own independent input buffer.
    this.#dragSession = null;
    return this.#endDrag(session, commit);
  }

  #endDrag(session: DragSession, commit: boolean) {
    const run = this.#pending.then(async () => {
      if (this.#disposed) return;
      const active = this.#active;
      if (!active || active.dragSession !== session) return;
      try {
        this.#applyDragSession(active, session);
        if (commit) {
          await this.#playTo(active, 1);
        } else {
          await this.#playTo(active, 0);
          if (this.#active === active) {
            let navigationError: unknown;
            try {
              await this.#host.navigate(!active.forward);
            } catch (error) {
              navigationError = error;
            }
            try {
              await this.#host.onCancelled?.(active.style);
            } catch (error) {
              if (navigationError === undefined) throw error;
            }
            if (navigationError !== undefined) throw navigationError;
          }
        }
      } finally {
        if (this.#active === active) this.#disposeActive();
      }
    });
    this.#pending = run.catch(() => {});
    return run;
  }

  #cancelOpenDrag() {
    const session = this.#dragSession;
    if (!session) return;
    this.#dragSession = null;
    this.#endDrag(session, false).catch(() => {});
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    const active = this.#active;
    if (active) {
      // Start restoration before invalidating the active frame. Async host
      // callbacks run synchronously through their first await, which lets the
      // hook recover toolbar state before its own cleanup clears that state.
      try {
        Promise.resolve(this.#host.onCancelled?.(active.style)).catch(() => {});
      } catch {
        // Disposal must still release the GPU renderer and overlay.
      }
    }
    this.#finishActive();
    this.#dragSession = null;
  }

  async #setUp(
    forward: boolean,
    rtl: boolean,
    style: CapturedTurnStyle,
    dragSession: DragSession | null = null,
  ): Promise<ActiveTurn | null> {
    if (this.#disposed) return null;
    const hostElement = this.#host.getHostElement();
    const rect = this.#host.getContentRect();
    if (!hostElement || !rect || rect.width <= 0 || rect.height <= 0) return null;

    await this.#host.onBeforeCapture?.(style);
    if (this.#disposed) return null;
    // Only the curl shows the back of the page; fetch its paper while the
    // native capture is in flight so it never delays the turn.
    const backdropPromise =
      style === 'curl' && this.#host.getBackdrop
        ? Promise.resolve()
            .then(() => this.#host.getBackdrop!())
            .catch(() => null)
        : null;
    const image = await this.#host.capture({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
    if (this.#disposed) return null;
    // No mime: the platforms return different formats (PNG on iOS/macOS,
    // JPEG on Android where PNG encoding took ~1.5s per turn) and the
    // decoder sniffs the actual format from the bytes.
    const bitmap = await createImageBitmap(new Blob([image]));
    const backdrop = backdropPromise ? await backdropPromise : null;
    if (this.#disposed) {
      bitmap.close();
      return null;
    }

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

    const renderer: TurnRenderer =
      style === 'slide' ? new PageSlideRenderer() : new PageCurlRenderer();
    try {
      renderer.attach(overlay, rect.width, rect.height);
      renderer.setTexture(bitmap);
      if (backdrop) renderer.setBackdrop?.(backdrop);
    } catch (error) {
      renderer.dispose();
      overlay.remove();
      throw error;
    } finally {
      bitmap.close();
    }

    const active: ActiveTurn = {
      overlay,
      renderer,
      style,
      forward,
      // Forward: the page moves out from its outer edge toward the spine
      // (left for LTR books). Backward: the mirror image — it recedes over
      // the outer edge, revealing the previous page.
      rendererRtl: forward ? rtl : !rtl,
      progress: 0,
      grabY: 0.5,
      dragSession,
      raf: 0,
      finish: null,
    };
    this.#active = active;

    // First frame draws the captured page exactly covering the content box,
    // hiding the instant page swap happening underneath.
    try {
      renderer.render(0, this.#grab(active), active.rendererRtl);
      await this.#host.onCovered?.(style);
      if (this.#disposed || this.#active !== active) return null;
      await this.#host.navigate(forward);
      if (this.#disposed || this.#active !== active) return null;
      return active;
    } catch (error) {
      if (this.#disposed) return null;
      // Once the covering frame is mounted, any later failure must restore
      // the pre-turn chrome and remove the overlay. Otherwise a failed instant
      // navigation can leave both the toolbar and the captured canvas stuck.
      if (this.#active === active) {
        try {
          await this.#host.onCancelled?.(style);
        } catch {
          // Preserve the setup/navigation failure as the caller-facing error.
        }
        this.#disposeActive();
      }
      throw error;
    }
  }

  #grab(active: ActiveTurn) {
    return { x: active.rendererRtl ? 0 : 1, y: active.grabY };
  }

  #applyDragSession(active: ActiveTurn, session: DragSession) {
    active.progress = session.progress;
    active.grabY = session.grabY;
    active.renderer.render(active.progress, this.#grab(active), active.rendererRtl);
  }

  /** Animate the active turn from its current progress to `target`. */
  #playTo(active: ActiveTurn, target: number): Promise<void> {
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
    if (active.dragSession && this.#dragSession === active.dragSession) {
      this.#dragSession = null;
    }
    cancelAnimationFrame(active.raf);
    active.finish?.();
    active.renderer.dispose();
    active.overlay.remove();
  }

  #disposeActive() {
    this.#finishActive();
  }
}
