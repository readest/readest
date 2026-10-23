import { CurlGrab, PageCurlRenderer } from '@/utils/pageCurl';
import { PagePushRenderer } from '@/utils/pagePush';
import { PageSlideRenderer, type PageSlideSettleOptions } from '@/utils/pageSlide';
import { measurePageTurn, type PageTurnMeasurement } from './pageTurnDiagnostics';

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
 * A backward curl returns the previous sheet around the same book spine.
 * It captures that sheet underneath the outgoing cover before reversing the
 * deformation. Slide and push keep their mirrored outgoing-page motion.
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
  /** Native webview snapshot of `rect`, as compressed image bytes or a decoded bitmap. */
  capture: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<ArrayBuffer | ImageBitmap>;
  prepareAdjacent?: (
    rect: CaptureRect,
    signal: AbortSignal,
  ) => Promise<[ImageBitmap | null, ImageBitmap | null]>;
  /**
   * Temporarily remove non-interactive chrome from a native pixel capture.
   * Returns a cleanup that restores it after the platform snapshot resolves.
   */
  preparePixelCapture?: () =>
    | void
    | (() => void | Promise<void>)
    | Promise<void | (() => void | Promise<void>)>;
  /** Whether a freshly captured frame is still safe to reveal and navigate. */
  isCaptureAllowed?: () => boolean;
  /**
   * Legacy host hook. The neutral paper renderer does not request a separate
   * theme image: decoding one would unnecessarily delay capture readiness.
   */
  getBackdrop?: () => Promise<TexImageSource | null> | TexImageSource | null;
  /** Records live UI state before the native snapshot starts. */
  onBeforeCapture?: (style: CapturedTurnStyle) => void | Promise<void>;
  /**
   * Called once the flat captured frame covers the live reader. A prepared
   * surface has already spent a painted frame in the real host, so its reveal
   * can be synchronized with the live chrome without another conservative
   * compositor wait.
   */
  onCovered?: (style: CapturedTurnStyle, surfaceAlreadyPainted: boolean) => void | Promise<void>;
  /** Called under the restored flat frame before a cancelled turn is removed. */
  onCancelled?: (style: CapturedTurnStyle) => void | Promise<void>;
  /** Instant (animation-less) page turn of the live view. */
  navigate: (forward: boolean) => Promise<void>;
  /**
   * How many page columns the reader cell shows (1 when unknown). With two,
   * the curl turns only the outer column, hinged at the spine like a book
   * leaf, and lands it on the inner column (readest#6106).
   */
  getColumnCount?: () => number;
  /**
   * Freeze the on-screen pixels of `rect` (viewport CSS px) behind a native
   * layer that `capture` does not see. The two-column curl uses it to capture
   * the incoming inner column under the overlay without ever showing it.
   * Resolves to the function that removes the layer again.
   */
  coverRegion?: (rect: CaptureRect) => Promise<() => Promise<void>>;
  /**
   * The live element a push turn translates in beside the outgoing capture
   * (readest#6239): the reader view, already showing the incoming page
   * underneath the overlay. Resolved per frame, so a replaced view is never
   * left shifted.
   */
  getPushTarget?: () => HTMLElement | null;
}

export type CapturedTurnStyle = 'curl' | 'slide' | 'push';

/** What the overlay draws each frame; PageCurlRenderer and PageSlideRenderer. */
interface TurnRenderer {
  attach(container: HTMLElement, width: number, height: number, dpr?: number): void;
  setTexture(source: ImageBitmap): void;
  setBackdrop?(source: TexImageSource): void;
  /** Page columns in the captured bitmap; 2 turns one leaf hinged at the spine. */
  setColumns?(columns: number): void;
  /** The incoming inner column shown on the back of a two-column leaf. */
  setIncoming?(source: TexImageSource | null): void;
  setReturning?(source: TexImageSource): void;
  prepareAdjacent?(previous: TexImageSource | null, next: TexImageSource | null): void;
  selectAdjacent?(forward: boolean): boolean;
  /** Whether an idle GPU surface survived context eviction. */
  isUsable?(): boolean;
  render(progress: number, grab: CurlGrab, rtl: boolean): void;
  animateSettle?(options: PageSlideSettleOptions): Animation | null;
  /** Cancel active work and release prepared surfaces, captures, and animation resources. */
  dispose(): void;
}

interface DragSession {
  startedAt: number;
  progress: number;
  grabY: number;
}

interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CaptureTarget {
  hostElement: HTMLElement;
  rect: CaptureRect;
  dpr: number;
}

interface PreparedSurface {
  /** Renderer initialized, texture-uploaded, and mounted in the real host. */
  renderer: TurnRenderer;
  /** Low-alpha layer kept in the compositor tree until a turn consumes it. */
  overlay: HTMLDivElement;
  style: CapturedTurnStyle;
  rect: CaptureRect;
  hostElement: HTMLElement;
  dpr: number;
  renderDpr: number;
  /** True after the low-alpha layer has survived a complete paint. */
  surfaceAlreadyPainted: boolean;
  /** Nested paint-tracking RAF, cancelled when the surface is consumed. */
  paintRaf: number;
  adjacentAbort: AbortController | null;
}

interface PreparingSurface {
  captureEpoch: number;
  preparedEpoch: number;
  rect: CaptureRect;
  hostElement: HTMLElement;
  dpr: number;
  style: CapturedTurnStyle;
  promise: Promise<PreparedSurface | null>;
}

interface ActiveTurn {
  measurement: PageTurnMeasurement | null;
  surface: PreparedSurface;
  overlay: HTMLElement;
  renderer: TurnRenderer;
  style: CapturedTurnStyle;
  forward: boolean;
  /** Renderer-space mirror flag (spine side of the turn), not book direction. */
  rendererRtl: boolean;
  waitingForReturning: boolean;
  /** Resident sheets can animate without changing the live EPUB until commit. */
  deferredNavigation: boolean;
  /** Page columns in the captured bitmap (2 = one leaf hinged at the spine). */
  columns: number;
  /** In-flight capture of the incoming column for the leaf's back, if any. */
  incoming: Promise<void> | null;
  progress: number;
  grabY: number;
  /** Buffered input and identity token, absent for programmatic turns. */
  dragSession: DragSession | null;
  settleTarget: number | null;
  dragRaf: number;
  raf: number;
  animation: Animation | null;
  /** Resolves when the play-out animation finishes or is interrupted. */
  finish: (() => void) | null;
}

const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (1 - t) * (1 - t) * 2);
const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
// A programmatic two-column turn gives the incoming column this long to
// arrive before the leaf's back would show; a slow capture must not stall it.
const INCOMING_WAIT_MS = 120;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const RELEASE_SETTLE_CONFIG = {
  // Keep a visible momentum lift without compressing a half-page tail into
  // the ~90ms range, which looks choppy even when every display frame lands.
  slide: { minSpeed: 0.2, maxSpeed: 1, maxPlaybackRate: 2 },
  push: { minSpeed: 0.2, maxSpeed: 1, maxPlaybackRate: 2 },
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

// No mime: the platforms return different formats (PNG on macOS, JPEG
// elsewhere) and the decoder sniffs the bytes.
const decodeCapture = (image: ArrayBuffer | ImageBitmap) =>
  image instanceof ArrayBuffer ? createImageBitmap(new Blob([image])) : Promise.resolve(image);
const discardCapture = (image: ArrayBuffer | ImageBitmap | null) => {
  if (image && !(image instanceof ArrayBuffer)) image.close();
};
const currentDpr = () => globalThis.devicePixelRatio || 1;

// A strictly zero-opacity layer can be skipped by mobile compositors. Keep the
// prepared surface imperceptibly present so its canvas/WebGL backing store and
// texture upload are promoted before the gesture reveals it.
const PREPARED_SURFACE_WARM_OPACITY = '0.004';

// A full-screen high-DPR canvas or WebGL surface can occupy tens of megabytes.
// Several reader cells may stay mounted, so keep one speculative idle surface
// process-wide and stop creating more while any full-screen turn is active.
let preparedSurfaceOwner: CapturedPageTurn | null = null;
/** One speculative idle warm-up may allocate at a time across reader cells. */
let idlePreparingOwner: CapturedPageTurn | null = null;
/** All controllers with prepared native capture work currently in flight. */
const preparingSurfaceOwners = new Set<CapturedPageTurn>();
/** A touch lease protects completed and replacement surfaces until claim/end. */
let preparedSurfaceLeaseOwner: CapturedPageTurn | null = null;
/** Active surfaces also consume the process-wide full-screen surface budget. */
const activeSurfaceOwners = new Set<CapturedPageTurn>();
// Retain one detached Curl context between pages. Its old texture is never
// a prepared capture: the next capture overwrites it before reveal.
let recycledCurl: { owner: CapturedPageTurn; surface: PreparedSurface } | null = null;

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
  /** One renderer-ready, idle-time surface of the visible reader cell. */
  #preparedSurface: PreparedSurface | null = null;
  /** Prevents another reader cell from evicting this touch's warm surface. */
  #preparedSurfaceRetained = false;
  /** Native capture/surface construction already in flight. */
  #preparingSurface: PreparingSurface | null = null;
  /** Invalidates both completed and in-flight prepared surfaces. */
  #captureEpoch = 0;
  /** Invalidates only speculative/touch warm-up work, never an active cold turn. */
  #preparedEpoch = 0;

  constructor(host: CapturedTurnHost, options: { duration?: number } = {}) {
    this.#host = host;
    this.#duration = options.duration ?? 450;
  }

  get active(): boolean {
    return this.#active !== null;
  }

  /**
   * Build the current reader cell into a renderer-ready surface ahead of the
   * next turn. Capture, decode, canvas/WebGL creation, texture upload, mounting,
   * and the first flat draw all happen outside the gesture's critical path.
   * A module-level one-surface budget bounds idle GPU memory across open books.
   *
   * Warm-up failures are non-fatal. A later turn simply runs the established
   * capture path and reports a real platform failure through that path.
   */
  async prepareCapture(style: CapturedTurnStyle = 'curl'): Promise<boolean> {
    if (this.#disposed || this.#active || this.#running || this.#busyDragSessions.size) {
      return false;
    }
    if (preparedSurfaceLeaseOwner && preparedSurfaceLeaseOwner !== this) {
      return false;
    }
    if ([...activeSurfaceOwners].some((owner) => owner !== this)) return false;
    const target = this.#readCaptureTarget();
    if (!target) return false;
    const idlePreparation = !this.#preparedSurfaceRetained;
    if (idlePreparation) {
      // All mounted BookCells schedule the same idle work. Serializing the
      // speculative path prevents a burst of native snapshots and full-screen
      // GPU uploads; a real touch lease is latency-sensitive and may bypass it.
      if (
        activeSurfaceOwners.size > 0 ||
        (preparedSurfaceOwner && preparedSurfaceOwner !== this) ||
        (idlePreparingOwner && idlePreparingOwner !== this) ||
        [...preparingSurfaceOwners].some((owner) => owner !== this)
      ) {
        return false;
      }
      idlePreparingOwner = this;
    } else {
      // A real touch takes the idle budget before it allocates another
      // full-screen surface. Late results from the previous owner stop before
      // decode/upload, and its completed low-alpha layer is removed now.
      for (const owner of preparingSurfaceOwners) {
        if (owner !== this) owner.invalidatePendingPreparedCapture();
      }
      if (idlePreparingOwner && idlePreparingOwner !== this) {
        idlePreparingOwner.invalidatePendingPreparedCapture();
      }
      if (preparedSurfaceOwner && preparedSurfaceOwner !== this) {
        preparedSurfaceOwner.#closePreparedSurface();
      }
    }
    try {
      const surface = await this.#ensurePreparedSurface(
        target.hostElement,
        target.rect,
        target.dpr,
        style,
      );
      if (surface && style === 'curl' && this.#host.prepareAdjacent && !surface.adjacentAbort) {
        const abort = new AbortController();
        surface.adjacentAbort = abort;
        // Hide the idle outgoing texture during off-screen page previews.
        // The live page underneath is still the same settled page.
        surface.overlay.style.opacity = '0';
        try {
          const [previous, next] = await this.#host.prepareAdjacent(surface.rect, abort.signal);
          try {
            if (!abort.signal.aborted && this.#preparedSurface === surface) {
              surface.renderer.prepareAdjacent?.(previous, next);
              surface.renderer.render(0, { x: 1, y: 0.5 }, false);
            }
          } finally {
            previous?.close();
            next?.close();
          }
        } catch {
          // An unloaded or invalidated neighbour uses the normal cold path.
        } finally {
          if (this.#preparedSurface === surface)
            surface.overlay.style.opacity = PREPARED_SURFACE_WARM_OPACITY;
        }
      }
      return !!surface;
    } catch {
      return false;
    } finally {
      if (idlePreparation && idlePreparingOwner === this) idlePreparingOwner = null;
    }
  }

  /** Hold this controller's current or in-flight surface until claim/release. */
  retainPreparedCapture() {
    if (this.#disposed) return;
    // Stop speculative previews on contact, before the gesture is claimed.
    // An in-flight native read restores the real viewport in its finally.
    this.#preparedSurface?.adjacentAbort?.abort();
    if (preparedSurfaceLeaseOwner && preparedSurfaceLeaseOwner !== this) {
      preparedSurfaceLeaseOwner.#preparedSurfaceRetained = false;
    }
    preparedSurfaceLeaseOwner = this;
    this.#preparedSurfaceRetained = true;
  }

  /** Release a touch that ended without consuming the prepared surface. */
  releasePreparedCapture() {
    this.#preparedSurfaceRetained = false;
    if (preparedSurfaceLeaseOwner === this) preparedSurfaceLeaseOwner = null;
  }

  /** Drop a stale idle snapshot; an in-flight result is discarded on arrival. */
  invalidatePreparedCapture() {
    this.releasePreparedCapture();
    this.#captureEpoch++;
    this.#preparedEpoch++;
    this.#closePreparedSurface(false);
  }

  /** Cancel only warm-up work while preserving a clean completed surface. */
  invalidatePendingPreparedCapture() {
    this.#preparedEpoch++;
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
        if (!this.#reserveActiveSurface()) return false;
        let active: ActiveTurn | null;
        try {
          active = await this.#setUp(forward, rtl, style);
        } catch (error) {
          activeSurfaceOwners.delete(this);
          throw error;
        }
        if (!active) {
          activeSurfaceOwners.delete(this);
          return false;
        }
        try {
          if (active.incoming) {
            await Promise.race([
              active.incoming,
              new Promise<void>((resolve) => setTimeout(resolve, INCOMING_WAIT_MS)),
            ]);
          }
          await this.#playTo(active, 1);
          await this.#commitDeferredNavigation(active);
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
    // A new swipe can finish a released, committed sheet immediately: the
    // destination is already underneath it. Do not interrupt cancellation,
    // which still has to restore the original page under its flat cover.
    if (!this.#dragSession && this.#active?.settleTarget === 1) {
      const active = this.#active;
      if (active.deferredNavigation) {
        // Keep the destination covering the real page until its commit paints.
        cancelAnimationFrame(active.raf);
        active.progress = 1;
        this.#draw(active, 1);
        const finish = active.finish;
        active.finish = null;
        finish?.();
      } else this.#finishActive();
    }
    // A replacement drag can arrive when a platform drops the previous
    // touchend. Cancel that specific request before queueing the new one;
    // token matching keeps the synthesized cancellation on its own overlay.
    this.#cancelOpenDrag();
    const session: DragSession = { progress: 0, grabY: 0.5, startedAt: performance.now() };
    this.#dragSession = session;
    this.#busyDragSessions.add(session);
    const run = this.#pending.then(async () => {
      if (this.#disposed) {
        if (this.#dragSession === session) this.#dragSession = null;
        this.#busyDragSessions.delete(session);
        return false;
      }
      this.#finishActive();
      if (!this.#reserveActiveSurface()) {
        if (this.#dragSession === session) this.#dragSession = null;
        this.#busyDragSessions.delete(session);
        return false;
      }
      try {
        const active = await this.#setUp(forward, rtl, style, session);
        if (!active) {
          activeSurfaceOwners.delete(this);
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
        activeSurfaceOwners.delete(this);
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
    if (active.style !== 'curl') {
      this.#applyDragSession(active, session);
      return;
    }
    // WebView can deliver several forwarded touch samples between paints.
    // Buffer the latest pose and submit one mesh per display frame instead
    // of making the GPU draw every intermediate, already obsolete position.
    active.progress = session.progress;
    active.grabY = session.grabY;
    if (active.waitingForReturning || active.dragRaf) return;
    active.dragRaf = requestAnimationFrame(() => {
      active.dragRaf = 0;
      if (this.#active === active) this.#applyDragSession(active, session);
    });
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

  /** Settle one drag session and restore navigation when the user cancels. */
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
          await this.#commitDeferredNavigation(active);
        } else {
          await this.#playTo(active, 0, releaseVelocity);
          active.measurement?.endMotion();
          if (this.#active === active) {
            let navigationError: unknown;
            try {
              if (!active.deferredNavigation) await this.#host.navigate(!active.forward);
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

  /** Cancel an unfinished gesture before accepting a replacement session. */
  #cancelOpenDrag() {
    const session = this.#dragSession;
    if (!session) return;
    this.#dragSession = null;
    this.#endDrag(session, false).catch(() => {});
  }

  /** Commit navigation after a resident captured sheet reaches its destination. */
  async #commitDeferredNavigation(active: ActiveTurn) {
    active.measurement?.endMotion();
    if (!active.deferredNavigation || this.#disposed) return;
    // The entire moving scene is resident. Reflow/relocation and React updates
    // run only after the sheet has reached its flat destination.
    await this.#host.navigate(active.forward);
    await waitForPaint();
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
    if (recycledCurl?.owner === this) {
      this.#disposeSurface(recycledCurl.surface);
      recycledCurl = null;
    }
    preparingSurfaceOwners.delete(this);
    if (idlePreparingOwner === this) idlePreparingOwner = null;
    this.#dragSession = null;
    this.#busyDragSessions.clear();
    this.invalidatePreparedCapture();
  }

  /** Resolve a nonempty content rectangle and its current rendering host. */
  #readCaptureTarget(): CaptureTarget | null {
    const hostElement = this.#host.getHostElement();
    const rect = this.#host.getContentRect();
    if (!hostElement?.isConnected || !rect || rect.width <= 0 || rect.height <= 0) return null;
    return { hostElement, rect: captureRectFrom(rect), dpr: currentDpr() };
  }

  /** Capture and cover a turn, preparing the incoming sheet before animation begins. */
  async #setUp(
    forward: boolean,
    rtl: boolean,
    style: CapturedTurnStyle,
    dragSession: DragSession | null = null,
  ): Promise<ActiveTurn | null> {
    if (this.#disposed) return null;
    let target = this.#readCaptureTarget();
    if (!target) {
      this.releasePreparedCapture();
      return null;
    }

    await this.#host.onBeforeCapture?.(style);
    if (this.#disposed) {
      this.releasePreparedCapture();
      return null;
    }
    target = this.#readCaptureTarget();
    if (!target) {
      this.releasePreparedCapture();
      return null;
    }
    let { hostElement, rect: captureRect, dpr } = target;
    let surface = this.#takePreparedSurface(hostElement, captureRect, dpr, style);
    let surfaceAlreadyPainted = surface?.surfaceAlreadyPainted ?? false;
    const preparing = this.#preparingSurface;
    const preparingMatches =
      !!preparing &&
      preparing.captureEpoch === this.#captureEpoch &&
      preparing.preparedEpoch === this.#preparedEpoch &&
      preparing.hostElement === hostElement &&
      preparing.dpr === dpr &&
      preparing.style === style &&
      sameCaptureRect(preparing.rect, captureRect);
    if (!surface && preparing && !preparingMatches) {
      // Never let an old style/geometry warm-up finish after this turn and
      // cache the outgoing page as the next page's prepared surface.
      this.invalidatePreparedCapture();
    }
    if (!surface && preparing && preparingMatches) {
      try {
        await preparing.promise;
      } catch {
        // A speculative warm-up must never prevent the normal capture path.
      }
      if (this.#disposed) return null;
      const currentTarget = this.#readCaptureTarget();
      if (!currentTarget) {
        this.invalidatePreparedCapture();
        return null;
      }
      if (
        currentTarget.hostElement !== hostElement ||
        currentTarget.dpr !== dpr ||
        !sameCaptureRect(currentTarget.rect, captureRect)
      ) {
        // The prepared frame finished after a rotation or layout change. It
        // is no longer safe to position over the live reader; recapture the
        // current target instead of using either the old surface or old rect.
        this.invalidatePreparedCapture();
        hostElement = currentTarget.hostElement;
        captureRect = currentTarget.rect;
        dpr = currentTarget.dpr;
      } else {
        surface = this.#takePreparedSurface(hostElement, captureRect, dpr, style);
        surfaceAlreadyPainted = surface?.surfaceAlreadyPainted ?? false;
      }
    }
    if (!surface) {
      // No prepared surface remains to protect. A cold live capture does not
      // participate in the global idle-surface budget.
      this.releasePreparedCapture();
      const coldCaptureEpoch = this.#captureEpoch;
      surface = await this.#captureSurface(
        hostElement,
        captureRect,
        dpr,
        style,
        coldCaptureEpoch,
        true,
        false,
      );
      if (this.#disposed) {
        if (surface) this.#disposeSurface(surface);
        return null;
      }

      // Native capture can span a rotation, resize, or grid-cell replacement.
      // Never mount the old pixels at new geometry: retry the current target
      // once, then abort if layout is still moving.
      let currentTarget = this.#readCaptureTarget();
      if (!currentTarget) {
        if (surface) this.#disposeSurface(surface);
        return null;
      }
      if (
        currentTarget.hostElement !== hostElement ||
        currentTarget.dpr !== dpr ||
        !sameCaptureRect(currentTarget.rect, captureRect)
      ) {
        if (surface) this.#disposeSurface(surface);
        hostElement = currentTarget.hostElement;
        captureRect = currentTarget.rect;
        dpr = currentTarget.dpr;
        surface = await this.#captureSurface(
          hostElement,
          captureRect,
          dpr,
          style,
          this.#captureEpoch,
          true,
          false,
        );
        currentTarget = this.#readCaptureTarget();
        if (
          !currentTarget ||
          currentTarget.hostElement !== hostElement ||
          currentTarget.dpr !== dpr ||
          !sameCaptureRect(currentTarget.rect, captureRect)
        ) {
          if (surface) this.#disposeSurface(surface);
          return null;
        }
      }
    }
    if (!surface || this.#disposed) {
      if (surface) this.#disposeSurface(surface);
      return null;
    }
    if (this.#host.isCaptureAllowed?.() === false) {
      this.#disposeSurface(surface);
      return null;
    }
    const { overlay, renderer } = surface;
    this.#positionOverlay(overlay, hostElement, captureRect);
    overlay.dataset['capturedTurnPrepared'] = 'false';
    overlay.style.opacity = '1';

    const active: ActiveTurn = {
      measurement: null,
      surface,
      overlay,
      renderer,
      style,
      forward,
      // Book direction fixes the curl's spine. Backward changes the sheet
      // and reverses its deformation, rather than mirroring the book.
      rendererRtl: style === 'curl' ? rtl : forward ? rtl : !rtl,
      waitingForReturning: style === 'curl' && !forward,
      deferredNavigation: false,
      columns: style === 'curl' && (this.#host.getColumnCount?.() ?? 1) >= 2 ? 2 : 1,
      incoming: null,
      progress: 0,
      grabY: 0.5,
      dragSession,
      settleTarget: null,
      dragRaf: 0,
      raf: 0,
      animation: null,
      finish: null,
    };
    this.#active = active;

    // First frame draws the captured page exactly covering the content box,
    // hiding the instant page swap happening underneath.
    try {
      renderer.setColumns?.(active.columns);
      const adjacentReady = style === 'curl' && renderer.selectAdjacent?.(forward) === true;
      if (adjacentReady) active.waitingForReturning = false;
      active.deferredNavigation = adjacentReady;
      if (style === 'curl')
        active.measurement = measurePageTurn(
          dragSession?.startedAt ?? performance.now(),
          adjacentReady,
        );
      this.#draw(active, 0);
      if (renderer.isUsable?.() === false) {
        throw new Error('Captured page-turn renderer became unavailable before navigation');
      }
      await this.#host.onCovered?.(style, surfaceAlreadyPainted);
      if (this.#disposed || this.#active !== active) return null;
      if (this.#host.isCaptureAllowed?.() === false) {
        try {
          await this.#host.onCancelled?.(style);
        } finally {
          if (this.#active === active) this.#disposeActive();
        }
        return null;
      }
      if (renderer.isUsable?.() === false) {
        throw new Error('Captured page-turn renderer became unavailable before navigation');
      }
      const currentTarget = this.#readCaptureTarget();
      if (
        !currentTarget ||
        currentTarget.hostElement !== hostElement ||
        currentTarget.dpr !== dpr ||
        !sameCaptureRect(currentTarget.rect, captureRect)
      ) {
        try {
          await this.#host.onCancelled?.(style);
        } catch {
          // Target loss still has to remove the stale full-screen surface.
        }
        if (this.#active === active) this.#disposeActive();
        return null;
      }
      if (adjacentReady) {
        if (dragSession) this.#applyDragSession(active, dragSession);
        return active;
      }
      await this.#host.navigate(forward);
      if (this.#disposed || this.#active !== active) return null;
      if (active.waitingForReturning) {
        try {
          await this.#captureReturning(active, captureRect);
        } catch (error) {
          if (this.#active === active) await this.#host.navigate(!forward);
          throw error;
        }
      } else if (active.columns === 2 && this.#host.coverRegion) {
        // Runs alongside the turn; a failure simply leaves the paper back.
        active.incoming = this.#captureIncoming(active, captureRect).catch(() => {});
      }
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

  /** Convert the active turn's vertical grip to renderer grab coordinates. */
  #grab(active: ActiveTurn) {
    return { x: active.rendererRtl ? 0 : 1, y: active.grabY };
  }

  /** Render the current sheet pose using the turn's reading direction. */
  #draw(active: ActiveTurn, progress = active.progress) {
    active.measurement?.draw(progress);
    active.renderer.render(progress, this.#grab(active), active.rendererRtl);
  }

  /** Capture the previous sheet under the cover for backward navigation. */
  async #captureReturning(active: ActiveTurn, rect: CaptureRect) {
    const uncover = await this.#host.coverRegion?.(rect);
    let image: ArrayBuffer | ImageBitmap | null = null;
    const check = () => {
      if (this.#active !== active || this.#host.isCaptureAllowed?.() === false) {
        throw new Error('Previous page capture was invalidated');
      }
    };
    try {
      check();
      active.overlay.style.visibility = 'hidden';
      await waitForPaint();
      const restorePixels = await this.#host.preparePixelCapture?.();
      try {
        check();
        image = await this.#host.capture(rect);
      } finally {
        await restorePixels?.();
      }
      check();
      const bitmap = await decodeCapture(image);
      image = null;
      try {
        check();
        active.renderer.setReturning?.(bitmap);
        active.waitingForReturning = false;
        this.#draw(active);
      } finally {
        bitmap.close();
      }
    } finally {
      discardCapture(image);
      active.overlay.style.visibility = '';
      await waitForPaint();
      await uncover?.();
    }
    if (this.#active === active && active.waitingForReturning) {
      throw new Error('Previous page capture was invalidated');
    }
  }

  /**
   * Two-column curl: capture the inner column of the spread the live view has
   * just turned to, for the back of the leaf, so the landed leaf matches the
   * live page pixel for pixel when the overlay comes off. The overlay hides
   * that column behind the old page, so the host first freezes the region's
   * on-screen pixels natively, the overlay is clipped to the leaf side to
   * expose the live column to the platform snapshot, and both are restored
   * in order before the native cover comes down. The turn keeps animating
   * throughout; the texture is swapped in as soon as it arrives.
   */
  async #captureIncoming(active: ActiveTurn, rect: CaptureRect) {
    const half = rect.width / 2;
    // The leaf lands on the column opposite its grabbed edge.
    const inner: CaptureRect = {
      x: active.rendererRtl ? rect.x + half : rect.x,
      y: rect.y,
      width: half,
      height: rect.height,
    };
    const uncover = await this.#host.coverRegion!(inner);
    let image: ArrayBuffer | ImageBitmap | null = null;
    try {
      if (this.#active !== active || this.#host.isCaptureAllowed?.() === false) return;
      active.overlay.style.clipPath = active.rendererRtl ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)';
      await waitForPaint();
      if (this.#active !== active) return;
      const restorePixels = await this.#host.preparePixelCapture?.();
      try {
        // A modal can open during any of these awaits, and the platform
        // snapshot would include its composited pixels. Re-check the gate at
        // every step, as the outgoing capture does, so a dialog never ends up
        // on the back of the leaf.
        if (this.#active !== active || this.#host.isCaptureAllowed?.() === false) return;
        image = await this.#host.capture(inner);
      } finally {
        await restorePixels?.();
      }
    } finally {
      active.overlay.style.clipPath = '';
      await waitForPaint();
      await uncover();
    }
    if (!image || this.#active !== active || this.#host.isCaptureAllowed?.() === false) {
      discardCapture(image);
      return;
    }
    const bitmap = await decodeCapture(image);
    try {
      if (this.#active !== active || this.#host.isCaptureAllowed?.() === false) return;
      active.renderer.setIncoming?.(bitmap);
      this.#draw(active);
    } finally {
      bitmap.close();
    }
  }

  /** Apply the newest buffered gesture pose to a newly ready surface. */
  #applyDragSession(active: ActiveTurn, session: DragSession) {
    cancelAnimationFrame(active.dragRaf);
    active.dragRaf = 0;
    active.progress = session.progress;
    active.grabY = session.grabY;
    if (!active.waitingForReturning) {
      this.#draw(active);
    }
  }

  /** Reuse or produce a valid surface for the requested host and layout generation. */
  async #ensurePreparedSurface(
    hostElement: HTMLElement,
    rect: CaptureRect,
    dpr: number,
    style: CapturedTurnStyle,
  ): Promise<PreparedSurface | null> {
    const cached = this.#preparedSurface;
    if (
      cached &&
      cached.hostElement === hostElement &&
      cached.overlay.parentElement === hostElement &&
      hostElement.isConnected &&
      cached.dpr === dpr &&
      cached.style === style &&
      cached.renderer.isUsable?.() !== false &&
      sameCaptureRect(cached.rect, rect)
    ) {
      return cached;
    }
    // Internal replacement must not drop the touchstart lease while the new
    // style/geometry/context is still being prepared.
    if (cached) this.#closePreparedSurface(false);

    const captureEpoch = this.#captureEpoch;
    const preparedEpoch = this.#preparedEpoch;
    const pending = this.#preparingSurface;
    if (pending) {
      if (
        pending.captureEpoch === captureEpoch &&
        pending.preparedEpoch === preparedEpoch &&
        pending.hostElement === hostElement &&
        pending.dpr === dpr &&
        pending.style === style &&
        sameCaptureRect(pending.rect, rect)
      ) {
        const result = await pending.promise;
        return this.#preparedSurface === result ? result : null;
      }
      try {
        await pending.promise;
      } catch {
        // Its epoch or geometry is stale; create the requested frame below.
      }
      if (
        this.#disposed ||
        captureEpoch !== this.#captureEpoch ||
        preparedEpoch !== this.#preparedEpoch
      ) {
        return null;
      }
      // Re-read both the cached surface and in-flight request after waiting.
      // Multiple callers can be queued behind the same mismatched warm-up;
      // recursion lets the first caller install the replacement and every
      // later caller join it instead of allocating duplicate GPU surfaces.
      return this.#ensurePreparedSurface(hostElement, rect, dpr, style);
    }

    preparingSurfaceOwners.add(this);
    const promise = this.#captureSurface(
      hostElement,
      rect,
      dpr,
      style,
      captureEpoch,
      true,
      true,
      () => preparedEpoch === this.#preparedEpoch,
    ).then((result) => {
      if (!result) return null;
      if (
        this.#disposed ||
        captureEpoch !== this.#captureEpoch ||
        preparedEpoch !== this.#preparedEpoch
      ) {
        this.#disposeSurface(result);
        return null;
      }
      return this.#storePreparedSurface(result) ? result : null;
    });
    const preparing: PreparingSurface = {
      captureEpoch,
      preparedEpoch,
      rect,
      hostElement,
      dpr,
      style,
      promise,
    };
    this.#preparingSurface = preparing;
    try {
      return await promise;
    } finally {
      if (this.#preparingSurface === preparing) this.#preparingSurface = null;
      if (!this.#preparingSurface) preparingSurfaceOwners.delete(this);
    }
  }

  /** Capture platform pixels and attach an overlay while respecting cancellation. */
  async #captureSurface(
    hostElement: HTMLElement,
    rect: CaptureRect,
    dpr: number,
    style: CapturedTurnStyle,
    epoch: number,
    discardWhenStale = true,
    preMount = true,
    isStillValid: () => boolean = () => true,
  ): Promise<PreparedSurface | null> {
    const restorePixels = await this.#host.preparePixelCapture?.();
    if (
      this.#disposed ||
      this.#host.isCaptureAllowed?.() === false ||
      !isStillValid() ||
      (discardWhenStale && epoch !== this.#captureEpoch)
    ) {
      await restorePixels?.();
      return null;
    }
    let image: ArrayBuffer | ImageBitmap;
    try {
      image = await this.#host.capture(rect);
    } finally {
      await restorePixels?.();
    }
    if (
      this.#disposed ||
      this.#host.isCaptureAllowed?.() === false ||
      !isStillValid() ||
      (discardWhenStale && epoch !== this.#captureEpoch)
    ) {
      discardCapture(image);
      return null;
    }
    const bitmap = await decodeCapture(image);
    if (
      this.#disposed ||
      this.#host.isCaptureAllowed?.() === false ||
      !isStillValid() ||
      (discardWhenStale && epoch !== this.#captureEpoch)
    ) {
      bitmap.close();
      return null;
    }
    if (!hostElement.isConnected) {
      bitmap.close();
      return null;
    }
    // Android/iOS snapshots are capped at 2x. Rasterizing a 2x texture into
    // a 2.75x framebuffer adds 89% more pixels without more page detail.
    const renderDpr =
      style === 'curl'
        ? Math.min(dpr, bitmap.width / rect.width, bitmap.height / rect.height)
        : dpr;
    const recycled = recycledCurl;
    recycledCurl = null;
    const reuse =
      recycled &&
      style === 'curl' &&
      recycled.surface.rect.width === rect.width &&
      recycled.surface.rect.height === rect.height &&
      recycled.surface.renderDpr === renderDpr &&
      recycled.surface.renderer.isUsable?.() !== false
        ? recycled.surface
        : null;
    if (recycled && !reuse) this.#disposeSurface(recycled.surface);
    const overlay = reuse?.overlay ?? document.createElement('div');
    const renderer: TurnRenderer =
      reuse?.renderer ??
      (style === 'slide'
        ? new PageSlideRenderer()
        : style === 'push'
          ? new PagePushRenderer(() => this.#host.getPushTarget?.() ?? null)
          : new PageCurlRenderer({ preserveDrawingBuffer: false }));
    overlay.setAttribute('aria-hidden', 'true');
    overlay.dataset['capturedTurnPrepared'] = String(preMount);
    Object.assign(overlay.style, {
      position: 'absolute',
      pointerEvents: 'none',
      zIndex: '50',
      opacity: preMount ? PREPARED_SURFACE_WARM_OPACITY : '1',
      overflow: 'hidden',
      transform: 'translateZ(0)',
      willChange: 'opacity',
    });
    this.#positionOverlay(overlay, hostElement, rect);
    hostElement.appendChild(overlay);
    try {
      if (!reuse) renderer.attach(overlay, rect.width, rect.height, renderDpr);
      renderer.setTexture(bitmap);
      // At progress zero both directions are the same flat page. Claim redraws
      // once with the actual spine direction without reallocating or uploading.
      renderer.render(0, { x: 1, y: 0.5 }, false);
    } catch (error) {
      renderer.dispose();
      overlay.remove();
      throw error;
    } finally {
      bitmap.close();
    }
    if (
      this.#disposed ||
      this.#host.isCaptureAllowed?.() === false ||
      !isStillValid() ||
      (discardWhenStale && epoch !== this.#captureEpoch)
    ) {
      renderer.dispose();
      overlay.remove();
      return null;
    }
    const surface: PreparedSurface = {
      renderer,
      overlay,
      style,
      rect,
      hostElement,
      dpr,
      renderDpr,
      surfaceAlreadyPainted: false,
      paintRaf: 0,
      adjacentAbort: null,
    };
    if (preMount) this.#trackPreparedSurfacePaint(surface);
    return surface;
  }

  /** Transfer ownership of a compatible prepared surface to an active turn. */
  #takePreparedSurface(
    hostElement: HTMLElement,
    rect: CaptureRect,
    dpr: number,
    style: CapturedTurnStyle,
  ): PreparedSurface | null {
    const prepared = this.#preparedSurface;
    if (!prepared) return null;
    if (
      prepared.hostElement !== hostElement ||
      prepared.overlay.parentElement !== hostElement ||
      !hostElement.isConnected ||
      prepared.dpr !== dpr ||
      prepared.style !== style ||
      prepared.renderer.isUsable?.() === false ||
      !sameCaptureRect(prepared.rect, rect)
    ) {
      this.#closePreparedSurface();
      return null;
    }
    this.#preparedSurface = null;
    prepared.adjacentAbort?.abort();
    if (preparedSurfaceOwner === this) preparedSurfaceOwner = null;
    this.releasePreparedCapture();
    this.#stopPreparedSurfacePaint(prepared);
    return prepared;
  }

  /** Retain an idle surface and discard the previously cached one. */
  #storePreparedSurface(surface: PreparedSurface) {
    // Decide against current ownership, not the request's start state: a touch
    // can release while native capture is pending, or another cell can claim
    // the global surface budget before this result arrives.
    if (
      surface.renderer.isUsable?.() === false ||
      this.#active ||
      [...activeSurfaceOwners].some((owner) => owner !== this)
    ) {
      this.#disposeSurface(surface);
      return false;
    }
    const currentTarget = this.#readCaptureTarget();
    if (
      !currentTarget ||
      currentTarget.hostElement !== surface.hostElement ||
      currentTarget.dpr !== surface.dpr ||
      !sameCaptureRect(currentTarget.rect, surface.rect)
    ) {
      this.#disposeSurface(surface);
      return false;
    }
    if (preparedSurfaceOwner && preparedSurfaceOwner !== this) {
      if (preparedSurfaceOwner.#preparedSurfaceRetained) {
        this.#disposeSurface(surface);
        return false;
      }
      preparedSurfaceOwner.#closePreparedSurface();
    }
    this.#closePreparedSurface(false);
    if (this.#disposed) {
      this.#disposeSurface(surface);
      return false;
    }
    this.#preparedSurface = surface;
    preparedSurfaceOwner = this;
    return true;
  }

  /** Reserve the one-full-screen-surface budget for setup and active playback. */
  #reserveActiveSurface() {
    if ([...activeSurfaceOwners].some((owner) => owner !== this)) return false;
    for (const owner of preparingSurfaceOwners) {
      if (owner !== this) owner.invalidatePreparedCapture();
    }
    if (idlePreparingOwner && idlePreparingOwner !== this) {
      idlePreparingOwner.invalidatePreparedCapture();
    }
    if (preparedSurfaceOwner && preparedSurfaceOwner !== this) {
      // An accepted turn takes priority over another cell's idle frame. Any
      // in-flight frame from that cell is rejected by #storePreparedSurface.
      preparedSurfaceOwner.#closePreparedSurface();
    }
    activeSurfaceOwners.add(this);
    return true;
  }

  /** Track whether the prepared overlay has reached a browser paint. */
  #trackPreparedSurfacePaint(surface: PreparedSurface) {
    this.#stopPreparedSurfacePaint(surface);
    surface.surfaceAlreadyPainted = false;
    surface.paintRaf = requestAnimationFrame(() => {
      surface.paintRaf = requestAnimationFrame(() => {
        surface.paintRaf = 0;
        if (
          !this.#disposed &&
          this.#preparedSurface === surface &&
          surface.overlay.parentElement === surface.hostElement &&
          surface.overlay.isConnected
        ) {
          surface.surfaceAlreadyPainted = true;
        }
      });
    });
  }

  /** Cancel outstanding paint tracking before a surface is released. */
  #stopPreparedSurfacePaint(surface: PreparedSurface) {
    if (!surface.paintRaf) return;
    cancelAnimationFrame(surface.paintRaf);
    surface.paintRaf = 0;
  }

  /** Align the captured overlay with the host's content rectangle. */
  #positionOverlay(overlay: HTMLElement, hostElement: HTMLElement, rect: CaptureRect) {
    const hostRect = hostElement.getBoundingClientRect();
    Object.assign(overlay.style, {
      left: `${rect.x - hostRect.left}px`,
      top: `${rect.y - hostRect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  /** Release one surface's overlay, textures, and capture bitmaps. */
  #disposeSurface(surface: PreparedSurface) {
    surface.adjacentAbort?.abort();
    this.#stopPreparedSurfacePaint(surface);
    surface.renderer.dispose();
    surface.overlay.remove();
  }

  /** Release the cached surface and optionally its gesture retention. */
  #closePreparedSurface(releaseRetention = true) {
    const surface = this.#preparedSurface;
    this.#preparedSurface = null;
    if (releaseRetention) this.releasePreparedCapture();
    if (preparedSurfaceOwner === this) preparedSurfaceOwner = null;
    if (surface) this.#disposeSurface(surface);
  }

  /** Animate the active turn from its current progress to `target`. */
  #playTo(active: ActiveTurn, target: number, releaseVelocity = 0): Promise<void> {
    active.settleTarget = target;
    // When another gesture is already waiting on capture/navigation, keep
    // each requested page turn but skip obsolete animation tails. Otherwise
    // every quick swipe adds another full-duration settle to the queue.
    if (active.dragSession && this.#busyDragSessions.size > 1) {
      active.progress = target;
      this.#draw(active, target);
      return Promise.resolve();
    }
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
          this.#draw(active);
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
        this.#draw(active, target);
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
    if (!active) {
      activeSurfaceOwners.delete(this);
      return;
    }
    active.measurement?.finish();
    this.#active = null;
    activeSurfaceOwners.delete(this);
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
    cancelAnimationFrame(active.dragRaf);
    finish?.();
    active.overlay.remove();
    if (
      !this.#disposed &&
      active.style === 'curl' &&
      !active.incoming &&
      active.renderer.isUsable?.() !== false
    ) {
      if (recycledCurl) this.#disposeSurface(recycledCurl.surface);
      recycledCurl = { owner: this, surface: active.surface };
    } else {
      active.renderer.dispose();
    }
  }

  /** Release active overlay resources and any in-flight animation. */
  #disposeActive() {
    this.#finishActive();
  }
}
