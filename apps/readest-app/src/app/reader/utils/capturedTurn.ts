import { CurlGrab, PageCurlRenderer } from '@/utils/pageCurl';
import { PageSlideRenderer, type PageSlideSettleOptions } from '@/utils/pageSlide';

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
 * flat slide. Mobile Tauri keeps both here so the decoded outgoing page can
 * be prepared before a gesture; web and desktop builds can use browser View
 * Transitions for the slide.
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
  /** Native webview snapshot of `rect`, as compressed image bytes. */
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
  animateSettle?(options: PageSlideSettleOptions): Animation | null;
  dispose(): void;
}

interface DragSession {
  progress: number;
  grabY: number;
}

interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PreparedCapture {
  bitmap: ImageBitmap;
  rect: CaptureRect;
  hostElement: HTMLElement;
  dpr: number;
  /** `undefined` means the warm-up did not request curl paper. */
  backdrop: TexImageSource | null | undefined;
}

interface PreparingCapture {
  epoch: number;
  rect: CaptureRect;
  hostElement: HTMLElement;
  dpr: number;
  promise: Promise<PreparedCapture | null>;
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
  animation: Animation | null;
  /** Resolves when the play-out animation finishes or is interrupted. */
  finish: (() => void) | null;
}

const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (1 - t) * (1 - t) * 2);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const RELEASE_SETTLE_CONFIG = {
  slide: { minSpeed: 0.2, maxSpeed: 1, maxPlaybackRate: 2 },
  curl: { minSpeed: 0.3, maxSpeed: 1.5, maxPlaybackRate: 1.5 },
} as const satisfies Record<
  CapturedTurnStyle,
  { minSpeed: number; maxSpeed: number; maxPlaybackRate: number }
>;
const MIN_BOOSTED_SETTLE_MS = 90;
// easeOutCubic starts with a normalized slope of 3. Limit its blend so a
// maximum flick starts near the settle's average speed instead of shooting
// forward at three times that already-boosted rate.
const MAX_RELEASE_EASE_OUT_BLEND = 1 / 3;

const captureRectFrom = (rect: DOMRect): CaptureRect => ({
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height,
});

const sameCaptureRect = (a: CaptureRect, b: CaptureRect) =>
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5;

const currentDpr = () => globalThis.devicePixelRatio || 1;

export class CapturedPageTurn {
  #host: CapturedTurnHost;
  #duration: number;
  #active: ActiveTurn | null = null;
  /** Latest sample and identity for the currently open finger drag. */
  #dragSession: DragSession | null = null;
  /** Drag lifetimes, including capture/settle after touchend cleared #dragSession. */
  #busyDragSessions = new Set<DragSession>();
  #disposed = false;
  /** Serializes drag setup/settle and accepted programmatic turns. */
  #pending: Promise<unknown> = Promise.resolve();
  /** True while a programmatic `turn()` is running, gating concurrent ones. */
  #running = false;
  /** One decoded, idle-time snapshot of the currently visible reader cell. */
  #preparedCapture: PreparedCapture | null = null;
  /** Native capture already in flight; a turn can reuse it instead of restarting. */
  #preparingCapture: PreparingCapture | null = null;
  /** Invalidates both completed and in-flight prepared captures. */
  #captureEpoch = 0;

  constructor(host: CapturedTurnHost, options: { duration?: number } = {}) {
    this.#host = host;
    this.#duration = options.duration ?? 450;
  }

  get active(): boolean {
    return this.#active !== null;
  }

  /**
   * Decode the current reader cell ahead of the next turn. This intentionally
   * stops at an ImageBitmap: keeping a full WebGL renderer resident for every
   * open book costs considerably more GPU memory and risks context eviction.
   *
   * Warm-up failures are non-fatal. A later turn simply runs the established
   * capture path and reports a real platform failure through that path.
   */
  async prepareCapture(style: CapturedTurnStyle = 'curl'): Promise<boolean> {
    if (this.#disposed || this.#active || this.#running || this.#busyDragSessions.size) {
      return false;
    }
    const hostElement = this.#host.getHostElement();
    const rect = this.#host.getContentRect();
    if (!hostElement || !rect || rect.width <= 0 || rect.height <= 0) return false;
    try {
      return !!(await this.#ensurePreparedCapture(
        hostElement,
        captureRectFrom(rect),
        currentDpr(),
        style,
      ));
    } catch {
      return false;
    }
  }

  /** Drop a stale idle snapshot; an in-flight result is discarded on arrival. */
  invalidatePreparedCapture() {
    this.#captureEpoch++;
    this.#closePreparedCapture();
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
    // A finger that lands while a programmatic capture is running belongs to
    // that navigation epoch. Do not queue a fresh captured turn behind it;
    // the hook latches the touch until the next touchstart as well.
    if (this.#running) return false;
    // A replacement drag can arrive when a platform drops the previous
    // touchend. Cancel that specific request before queueing the new one;
    // token matching keeps the synthesized cancellation on its own overlay.
    this.#cancelOpenDrag();
    const session: DragSession = { progress: 0, grabY: 0.5 };
    this.#dragSession = session;
    this.#busyDragSessions.add(session);
    const run = this.#pending.then(async () => {
      if (this.#disposed) {
        if (this.#dragSession === session) this.#dragSession = null;
        this.#busyDragSessions.delete(session);
        return false;
      }
      this.#finishActive();
      try {
        const active = await this.#setUp(forward, rtl, style, session);
        if (!active) {
          if (this.#dragSession === session) this.#dragSession = null;
          this.#busyDragSessions.delete(session);
          return false;
        }
        // A sample may have arrived before native capture produced an active
        // overlay. Apply it before beginDrag resolves, so a queued endDrag
        // always settles from the latest finger position rather than zero.
        this.#applyDragSession(active, session);
        return true;
      } catch (error) {
        if (this.#dragSession === session) this.#dragSession = null;
        this.#busyDragSessions.delete(session);
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
   * flashes. `releaseVelocity` is the recent signed finger velocity in
   * CSS px/ms; it only accelerates a settle when it points toward the target.
   *
   * Serialized on the same chain as beginDrag: the release can arrive while
   * the drag's async capture is still in flight (after an instant-highlight
   * release, the gesture's queued trailing touchmoves race the unlock and can
   * start a drag milliseconds before the touchend). A direct no-op here left
   * that drag stranded — overlay frozen at progress 0 over an already-turned
   * live view, making every following turn off by one page.
   */
  async endDrag(commit: boolean, releaseVelocity = 0) {
    const session = this.#dragSession;
    if (!session) return;
    // Seal the released sample immediately. Late touchmoves cannot mutate a
    // page that has already started committing or returning, while a new
    // beginDrag can safely install its own independent input buffer.
    this.#dragSession = null;
    return this.#endDrag(session, commit, releaseVelocity);
  }

  #endDrag(session: DragSession, commit: boolean, releaseVelocity = 0) {
    const run = this.#pending.then(async () => {
      if (this.#disposed) {
        this.#busyDragSessions.delete(session);
        return;
      }
      const active = this.#active;
      if (!active || active.dragSession !== session) {
        this.#busyDragSessions.delete(session);
        return;
      }
      try {
        this.#applyDragSession(active, session);
        if (commit) {
          await this.#playTo(active, 1, releaseVelocity);
        } else {
          await this.#playTo(active, 0, releaseVelocity);
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
        this.#busyDragSessions.delete(session);
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
    this.#busyDragSessions.clear();
    this.invalidatePreparedCapture();
  }

  async #setUp(
    forward: boolean,
    rtl: boolean,
    style: CapturedTurnStyle,
    dragSession: DragSession | null = null,
  ): Promise<ActiveTurn | null> {
    if (this.#disposed) return null;
    let hostElement = this.#host.getHostElement();
    let rect = this.#host.getContentRect();
    if (!hostElement || !rect || rect.width <= 0 || rect.height <= 0) return null;

    await this.#host.onBeforeCapture?.(style);
    if (this.#disposed) return null;
    hostElement = this.#host.getHostElement();
    rect = this.#host.getContentRect();
    if (!hostElement || !rect || rect.width <= 0 || rect.height <= 0) return null;
    let captureRect = captureRectFrom(rect);
    let dpr = currentDpr();
    let prepared = this.#takePreparedCapture(hostElement, captureRect, dpr);
    if (
      !prepared &&
      this.#preparingCapture?.epoch === this.#captureEpoch &&
      this.#preparingCapture.hostElement === hostElement &&
      this.#preparingCapture.dpr === dpr &&
      sameCaptureRect(this.#preparingCapture.rect, captureRect)
    ) {
      try {
        await this.#preparingCapture.promise;
      } catch {
        // A speculative warm-up must never prevent the normal capture path.
      }
      if (this.#disposed) return null;
      const currentHostElement = this.#host.getHostElement();
      const currentRect = this.#host.getContentRect();
      const currentCaptureRect = currentRect ? captureRectFrom(currentRect) : null;
      const currentCaptureDpr = currentDpr();
      if (
        !currentHostElement ||
        !currentRect ||
        !currentCaptureRect ||
        currentRect.width <= 0 ||
        currentRect.height <= 0
      ) {
        return null;
      }
      if (
        currentHostElement !== hostElement ||
        currentCaptureDpr !== dpr ||
        !sameCaptureRect(currentCaptureRect, captureRect)
      ) {
        // The prepared frame finished after a rotation or layout change. It
        // is no longer safe to position over the live reader; recapture the
        // current target instead of using either the old bitmap or old rect.
        this.invalidatePreparedCapture();
        hostElement = currentHostElement;
        rect = currentRect;
        captureRect = currentCaptureRect;
        dpr = currentCaptureDpr;
      } else {
        prepared = this.#takePreparedCapture(hostElement, captureRect, dpr);
      }
    }
    if (!prepared) {
      prepared = await this.#capturePrepared(
        hostElement,
        captureRect,
        dpr,
        style,
        this.#captureEpoch,
        false,
      );
    }
    if (!prepared || this.#disposed) {
      prepared?.bitmap.close();
      return null;
    }
    const bitmap = prepared.bitmap;
    const backdrop =
      style === 'curl'
        ? prepared.backdrop !== undefined
          ? prepared.backdrop
          : await this.#getBackdrop()
        : null;
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
      animation: null,
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

  async #ensurePreparedCapture(
    hostElement: HTMLElement,
    rect: CaptureRect,
    dpr: number,
    style: CapturedTurnStyle,
  ): Promise<PreparedCapture | null> {
    const cached = this.#preparedCapture;
    if (
      cached &&
      cached.hostElement === hostElement &&
      cached.dpr === dpr &&
      sameCaptureRect(cached.rect, rect)
    ) {
      if (style !== 'curl' || cached.backdrop !== undefined) return cached;
      cached.backdrop = await this.#getBackdrop();
      return this.#preparedCapture === cached ? cached : null;
    }
    if (cached) this.#closePreparedCapture();

    const epoch = this.#captureEpoch;
    const pending = this.#preparingCapture;
    if (pending) {
      if (
        pending.epoch === epoch &&
        pending.hostElement === hostElement &&
        pending.dpr === dpr &&
        sameCaptureRect(pending.rect, rect)
      ) {
        const result = await pending.promise;
        if (result && style === 'curl' && result.backdrop === undefined) {
          result.backdrop = await this.#getBackdrop();
        }
        return this.#preparedCapture === result ? result : null;
      }
      try {
        await pending.promise;
      } catch {
        // Its epoch or geometry is stale; create the requested frame below.
      }
      if (this.#disposed || epoch !== this.#captureEpoch) return null;
    }

    const promise = this.#capturePrepared(hostElement, rect, dpr, style, epoch).then((result) => {
      if (!result) return null;
      if (this.#disposed || epoch !== this.#captureEpoch) {
        result.bitmap.close();
        return null;
      }
      this.#closePreparedCapture();
      this.#preparedCapture = result;
      return result;
    });
    const preparing: PreparingCapture = { epoch, rect, hostElement, dpr, promise };
    this.#preparingCapture = preparing;
    try {
      return await promise;
    } finally {
      if (this.#preparingCapture === preparing) this.#preparingCapture = null;
    }
  }

  async #capturePrepared(
    hostElement: HTMLElement,
    rect: CaptureRect,
    dpr: number,
    style: CapturedTurnStyle,
    epoch: number,
    discardWhenStale = true,
  ): Promise<PreparedCapture | null> {
    const backdropPromise = style === 'curl' ? this.#getBackdrop() : Promise.resolve(undefined);
    const image = await this.#host.capture(rect);
    if (this.#disposed || (discardWhenStale && epoch !== this.#captureEpoch)) return null;
    // No mime: the platforms return different formats (PNG on macOS,
    // JPEG on iOS/Android) and the decoder sniffs the bytes.
    const bitmap = await createImageBitmap(new Blob([image]));
    const backdrop = await backdropPromise;
    if (this.#disposed || (discardWhenStale && epoch !== this.#captureEpoch)) {
      bitmap.close();
      return null;
    }
    return { bitmap, rect, hostElement, dpr, backdrop };
  }

  #getBackdrop(): Promise<TexImageSource | null> {
    if (!this.#host.getBackdrop) return Promise.resolve(null);
    return Promise.resolve()
      .then(() => this.#host.getBackdrop!())
      .catch(() => null);
  }

  #takePreparedCapture(
    hostElement: HTMLElement,
    rect: CaptureRect,
    dpr: number,
  ): PreparedCapture | null {
    const prepared = this.#preparedCapture;
    if (!prepared) return null;
    if (
      prepared.hostElement !== hostElement ||
      prepared.dpr !== dpr ||
      !sameCaptureRect(prepared.rect, rect)
    ) {
      this.#closePreparedCapture();
      return null;
    }
    this.#preparedCapture = null;
    return prepared;
  }

  #closePreparedCapture() {
    this.#preparedCapture?.bitmap.close();
    this.#preparedCapture = null;
  }

  /** Animate the active turn from its current progress to `target`. */
  #playTo(active: ActiveTurn, target: number, releaseVelocity = 0): Promise<void> {
    return new Promise((resolve) => {
      const from = active.progress;
      const span = target - from;
      if (span === 0) return resolve();
      const towardTarget = releaseVelocity * span > 0;
      const { minSpeed, maxSpeed, maxPlaybackRate } = RELEASE_SETTLE_CONFIG[active.style];
      const speedRange = maxSpeed - minSpeed;
      const releaseBoost = towardTarget
        ? Math.max(0, Math.min(1, (Math.abs(releaseVelocity) - minSpeed) / speedRange))
        : 0;
      const playbackRate = 1 + (maxPlaybackRate - 1) * releaseBoost;
      const baseDuration = Math.max(1, this.#duration * Math.abs(span));
      const duration =
        releaseBoost > 0
          ? Math.max(Math.min(MIN_BOOSTED_SETTLE_MS, baseDuration), baseDuration / playbackRate)
          : baseDuration;
      const easeOutBlend = releaseBoost * MAX_RELEASE_EASE_OUT_BLEND;
      const easing = (t: number) =>
        easeInOutQuad(t) * (1 - easeOutBlend) + easeOutCubic(t) * easeOutBlend;
      active.finish = resolve;

      const runRafFallback = () => {
        const start = performance.now();
        const step = (now: number) => {
          if (this.#active !== active) return resolve();
          const t = Math.min(1, (now - start) / duration);
          active.progress = from + span * easing(t);
          active.renderer.render(active.progress, this.#grab(active), active.rendererRtl);
          if (t < 1) {
            active.raf = requestAnimationFrame(step);
          } else {
            active.finish = null;
            resolve();
          }
        };
        active.raf = requestAnimationFrame(step);
      };

      let animation: Animation | null = null;
      try {
        animation =
          active.renderer.animateSettle?.({
            from,
            target,
            rtl: active.rendererRtl,
            duration,
            easing,
          }) ?? null;
      } catch {
        // A partial/buggy WAAPI implementation falls back to the established
        // requestAnimationFrame path instead of breaking the turn.
      }
      if (!animation) return runRafFallback();

      const settleAnimation = animation;
      active.animation = settleAnimation;
      let settled = false;
      const clearHandlers = () => {
        settleAnimation.onfinish = null;
        settleAnimation.oncancel = null;
      };
      const finishSettle = () => {
        if (settled) return;
        settled = true;
        if (this.#active !== active || active.animation !== settleAnimation) return resolve();
        // Persist the terminal transform before removing the fill effect. This
        // is essential on cancellation: the old page must remain flat while
        // the live paginator and toolbar are restored underneath it.
        active.progress = target;
        active.renderer.render(target, this.#grab(active), active.rendererRtl);
        active.animation = null;
        active.finish = null;
        clearHandlers();
        settleAnimation.cancel();
        resolve();
      };
      const cancelSettle = () => {
        if (settled) return;
        settled = true;
        if (this.#active !== active || active.animation !== settleAnimation) return resolve();
        active.animation = null;
        clearHandlers();
        runRafFallback();
      };
      settleAnimation.onfinish = finishSettle;
      settleAnimation.oncancel = cancelSettle;
      // Some older WebViews have dropped finish events while still resolving
      // Animation.finished. Listen to both channels through the same idempotent
      // handlers; partial implementations can keep using the event callbacks.
      try {
        void settleAnimation.finished.then(finishSettle, cancelSettle);
      } catch {
        // `finished` is not essential when onfinish/oncancel are available.
      }
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
    const finish = active.finish;
    active.finish = null;
    if (active.animation) {
      active.animation.onfinish = null;
      active.animation.oncancel = null;
      active.animation.cancel();
      active.animation = null;
    }
    cancelAnimationFrame(active.raf);
    finish?.();
    active.renderer.dispose();
    active.overlay.remove();
  }

  #disposeActive() {
    this.#finishActive();
  }
}
