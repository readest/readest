import type { Renderer } from '@/types/view';
import { CapturedPageTurn, type CapturedTurnHost, type CapturedTurnStyle } from './capturedTurn';

export interface NativePaperCommand {
  op:
    | 'capture'
    | 'abortCapture'
    | 'cover'
    | 'idle'
    | 'start'
    | 'move'
    | 'animate'
    | 'complete'
    | 'cancel'
    | 'finish'
    | 'invalidate'
    | 'dispose';
  owner: number;
  generation: number;
  key?: string;
  requestId?: number;
  turnId?: number;
  released?: boolean;
  destination?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  forward?: boolean;
  rtl?: boolean;
  progress?: number;
  grabY?: number;
  commit?: boolean;
  velocity?: number;
  columns?: number;
}
export interface NativePaperResult {
  ready?: boolean;
  touchTracked?: boolean;
  cancelled?: boolean;
  keys?: string[];
}
type Rect = { x: number; y: number; width: number; height: number };
type Session = { id: number; released: boolean; progress: number; grabY: number };
type Scene = { session: Session; forward: boolean; navigated: boolean; touchTracked: boolean };
// The native scene outlives a page reload. Start each page load at its own
// owner, or a reloaded reader inherits the old page's generation and every
// capture is refused. Kept within a 32-bit Int for the Kotlin side.
let nextOwner = Math.floor(Math.random() * 0x40000000);
let nativeOwner: NativePageTurn | null = null;

/** Android and iOS own pixels, texture residency, finger tracking and frame delivery.
 * The web side only prepares page positions and commits reading progress. */
export class NativePageTurn extends CapturedPageTurn {
  #owner = ++nextOwner;
  #generation = 0;
  #keys = new Set<string>();
  #dead = false;
  #session: Session | null = null;
  #scene: Scene | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #warming: Promise<boolean> | null = null;
  #abort: AbortController | null = null;
  #moveRaf = 0;
  #request = 0;
  #turn = 0;
  #cancellations = new Set<Promise<unknown>>();
  #invalidations: Promise<unknown> = Promise.resolve();

  constructor(
    private host: CapturedTurnHost,
    private native: {
      renderer: Renderer;
      enabled: () => boolean;
      call: (command: NativePaperCommand) => Promise<NativePaperResult>;
    },
  ) {
    super(host);
  }

  /** Require Curl, an enabled native layout, and page identities. Without
   * previews (fixed layout), each new page is captured after navigating under the cover. */
  #eligible(style: CapturedTurnStyle) {
    return style === 'curl' && this.native.enabled() && !!this.native.renderer.getPageTurnKey;
  }
  /** Report whether this turn uses the native queue rather than captured-page fallback. */
  canQueueNativeTurn(style: CapturedTurnStyle | null) {
    return style !== null && this.#eligible(style);
  }
  /** Tag each bridge command with the reader owner and current pixel generation. */
  #call(args: Omit<NativePaperCommand, 'owner' | 'generation'>) {
    return this.native.call({ ...args, owner: this.#owner, generation: this.#generation });
  }
  /** Read the current content bounds, rejecting empty capture regions. */
  #rect(): Rect | null {
    const rect = this.host.getContentRect();
    return rect && rect.width > 0 && rect.height > 0
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : null;
  }
  /** Resolve a page identity within the current paginator layout. */
  #key(delta = 0) {
    return this.native.renderer.getPageTurnKey?.(delta) ?? null;
  }
  /** Reject capture after disposal or while the host blocks interaction. */
  #allowed() {
    return !this.#dead && this.host.isCaptureAllowed?.() !== false;
  }
  /** Commit the reading position while bypassing the native path's redundant unlock delay. */
  async #navigate(forward: boolean) {
    this.native.renderer.setAttribute('data-native-paper-commit', '');
    try {
      await this.host.navigate(forward);
    } finally {
      this.native.renderer.removeAttribute('data-native-paper-commit');
    }
  }
  /** Invalidate the previous reader's native page identities before taking ownership. */
  #claim() {
    if (nativeOwner && nativeOwner !== this) nativeOwner.invalidateNativePages();
    nativeOwner = this;
  }
  /** Abort idle previews so input can restore and use the live paginator. */
  #stopWarm() {
    if (this.#abort && !this.#abort.signal.aborted) {
      this.#keys.clear();
      this.#abort.abort();
    }
  }

  /** Capture one keyed native texture, restoring temporary host chrome after completion. */
  async #capture(key: string, rect: Rect, signal?: AbortSignal) {
    await this.#invalidations;
    if (this.#keys.has(key)) return true;
    if (!this.#allowed() || signal?.aborted) return false;
    const generation = this.#generation;
    const requestId = ++this.#request;
    const cancel = () => {
      const ack = this.#call({ op: 'abortCapture', requestId }).catch(() => {});
      this.#cancellations.add(ack);
      void ack.finally(() => this.#cancellations.delete(ack));
    };
    signal?.addEventListener('abort', cancel, { once: true });
    let restore: void | (() => void | Promise<void>) = undefined;
    try {
      restore = await this.host.preparePixelCapture?.();
      if (signal?.aborted || generation !== this.#generation || !this.#allowed()) return false;
      const result = await this.#call({ op: 'capture', key, requestId, ...rect });
      if (
        generation !== this.#generation ||
        signal?.aborted ||
        !this.#allowed() ||
        result.ready === false
      )
        return false;
      if (result.keys) this.#keys = new Set(result.keys);
      else this.#keys.add(key);
      while (this.#keys.size > 3) this.#keys.delete(this.#keys.values().next().value!);
      return true;
    } finally {
      signal?.removeEventListener('abort', cancel);
      await restore?.();
    }
  }

  override get active() {
    return !!this.#scene || super.active;
  }

  /** Warm the current and adjacent native sheets under a cover without committing navigation. */
  override prepareCapture(style: CapturedTurnStyle = 'curl'): Promise<boolean> {
    if (!this.#eligible(style)) return super.prepareCapture(style);
    this.#claim();
    if (this.#dead || this.#scene || this.#session) return Promise.resolve(false);
    if (this.#warming) return this.#warming;
    const rect = this.#rect();
    const key = this.#key();
    if (!rect || !key || !this.#allowed()) return Promise.resolve(false);
    const abort = new AbortController();
    this.#abort = abort;
    const run = (async () => {
      if (!(await this.#capture(key, rect, abort.signal))) return false;
      if (abort.signal.aborted) return false;
      await this.#call({ op: 'cover', key, ...rect });
      try {
        for (const forward of this.native.renderer.previewPage ? [true, false] : []) {
          if (abort.signal.aborted || !this.#allowed()) break;
          const adjacent = this.#key(forward ? 1 : -1);
          if (!adjacent || this.#keys.has(adjacent)) continue;
          await this.native.renderer.previewPage!(
            forward,
            () => this.#capture(adjacent, rect, abort.signal),
            abort.signal,
          );
        }
      } finally {
        await Promise.allSettled([...this.#cancellations]);
        await this.#call({ op: 'idle' });
      }
      return !abort.signal.aborted;
    })()
      .catch(() => {
        this.#keys.clear();
        return false;
      })
      .finally(() => {
        if (this.#warming === run) this.#warming = null;
        if (this.#abort === abort) this.#abort = null;
      });
    this.#warming = run;
    return run;
  }

  /** Stop native warm-up when a gesture leases the prepared surface. */
  override retainPreparedCapture() {
    this.#stopWarm();
    super.retainPreparedCapture();
  }
  /** Cancel incomplete preparation while retaining reusable settled captures. */
  override invalidatePendingPreparedCapture() {
    this.#stopWarm();
    super.invalidatePendingPreparedCapture();
  }
  /** Invalidate preparation and cancel an active scene when interaction becomes blocked. */
  override invalidatePreparedCapture() {
    this.#stopWarm();
    if (this.#scene && !this.#allowed())
      void this.#call({ op: 'cancel', turnId: this.#scene.session.id }).catch(() => {});
    super.invalidatePreparedCapture();
  }
  /** Advance the pixel generation and serialize invalidation of resident native textures. */
  invalidateNativePages() {
    this.#abort?.abort();
    this.#generation++;
    this.#keys.clear();
    if (!this.#dead) {
      this.#invalidations = Promise.allSettled([
        this.#invalidations,
        this.#call({ op: 'invalidate' }),
      ]);
    }
  }

  /** Queue a scene, preparing missing sheets and rechecking boundaries before navigation. */
  override beginDrag(
    forward: boolean,
    rtl: boolean,
    style: CapturedTurnStyle = 'curl',
  ): Promise<boolean> {
    if (!this.#eligible(style)) return super.beginDrag(forward, rtl, style);
    this.#claim();
    this.#stopWarm();
    if (this.#scene && !this.#session)
      void this.#call({ op: 'complete', turnId: this.#scene.session.id }).catch(() => {});
    if (this.#session) void this.endDrag(false).catch(() => {});
    const session: Session = { id: ++this.#turn, released: false, progress: 0, grabY: 0.5 };
    this.#session = session;
    const run = this.#queue.then(async () => {
      await this.#warming;
      if (!this.#allowed()) return false;
      if (forward ? this.native.renderer.atEnd : this.native.renderer.atStart) return false;
      const rect = this.#rect();
      const key = this.#key();
      if (!rect || !key) return false;
      const scene: Scene = { session, forward, navigated: false, touchTracked: false };
      this.#scene = scene;
      try {
        await this.host.onBeforeCapture?.('curl');
        let destination = this.#key(forward ? 1 : -1);
        const resident = !!destination && this.#keys.has(key) && this.#keys.has(destination);
        if (!(await this.#capture(key, rect))) return false;
        if (!resident) {
          const covered = await this.#call({ op: 'cover', key, turnId: session.id, ...rect });
          if (covered.ready === false) throw new Error('Native paper ownership changed');
          await this.host.onCovered?.('curl', true);
        }
        if (!this.#allowed()) return false;
        if (destination && !this.#keys.has(destination) && this.native.renderer.previewPage) {
          const target = destination;
          await this.native.renderer.previewPage(forward, () => this.#capture(target, rect));
        }
        if (!destination || !this.#keys.has(destination)) {
          // A not-yet-loaded section is prepared under the native current sheet.
          await this.#navigate(forward);
          scene.navigated = true;
          destination = this.#key();
          if (destination === key) {
            // A boundary clamp is not a page turn. In particular, do not
            // roll a cancelled no-op forwards or cache a fictitious sheet.
            scene.navigated = false;
            return false;
          }
          if (destination) await this.#capture(destination, rect);
        }
        if (!destination || !this.#keys.has(destination) || !this.#allowed()) return false;
        const result = await this.#call({
          op: 'start',
          turnId: session.id,
          released: session.released,
          key,
          destination,
          forward,
          rtl,
          progress: session.progress,
          grabY: session.grabY,
          // A spread turns its outer column as a leaf hinged at the spine.
          columns: this.host.getColumnCount?.() ?? 1,
        });
        if (result.ready === false) throw new Error('Native paper scene was not started');
        scene.touchTracked = result.touchTracked === true;
        if (resident) await this.host.onCovered?.('curl', true);
        return true;
      } catch (error) {
        await this.#restore(scene);
        throw error;
      } finally {
        if (this.#scene === scene && (!this.#allowed() || !this.#keys.size))
          await this.#restore(scene);
      }
    });
    const ready = run.then(
      async (started) => {
        if (!started && this.#scene?.session === session) await this.#restore(this.#scene);
        if (!started && this.#session === session) this.#session = null;
        return started;
      },
      (error) => {
        if (this.#session === session) this.#session = null;
        throw error;
      },
    );
    this.#queue = ready.catch(() => {});
    return ready;
  }

  /** Coalesce JavaScript drag poses only when native touch tracking is unavailable. */
  override moveDrag(progress: number, grabY: number) {
    const session = this.#session;
    if (!session) {
      super.moveDrag(progress, grabY);
      return;
    }
    session.progress = Math.max(0, Math.min(1, progress));
    session.grabY = grabY;
    const scene = this.#scene;
    if (!scene || scene.session !== session || scene.touchTracked || this.#moveRaf) return;
    this.#moveRaf = requestAnimationFrame(() => {
      this.#moveRaf = 0;
      if (this.#scene === scene)
        void this.#call({
          op: 'move',
          turnId: session.id,
          progress: session.progress,
          grabY: session.grabY,
        }).catch(() => {});
    });
  }

  /** Serialize settlement, commit or roll back navigation, then await native handoff. */
  override endDrag(commit: boolean, velocity = 0): Promise<void> {
    const session = this.#session;
    if (!session) return super.endDrag(commit, velocity);
    session.released = true;
    this.#session = null;
    const run = this.#queue.then(async () => {
      const scene = this.#scene;
      if (!scene || scene.session !== session || this.#dead) return;
      cancelAnimationFrame(this.#moveRaf);
      this.#moveRaf = 0;
      try {
        const settling = this.#call({
          op: 'animate',
          turnId: session.id,
          commit,
          velocity,
          progress: session.progress,
          grabY: session.grabY,
        });
        // Input can already be queued while this scene is still preparing.
        // Shorten that scene's tail too, preserving a visible native animation.
        if (this.#turn > session.id)
          void this.#call({ op: 'complete', turnId: session.id }).catch(() => {});
        const result = await settling;
        const confirmed = commit && !result.cancelled && this.#allowed();
        if (confirmed && !scene.navigated) await this.#navigate(scene.forward);
        if (!confirmed && scene.navigated) await this.#navigate(!scene.forward);
        // The final reading position is settled. A later presentation error
        // must not undo a committed turn or repeat an already completed rollback.
        scene.navigated = false;
        if (!confirmed) await this.host.onCancelled?.('curl');
        // Native visual-state/frame-commit synchronization happens before hide.
        await this.#call({ op: 'finish', turnId: session.id });
      } catch (error) {
        await this.#restore(scene);
        throw error;
      } finally {
        if (this.#scene === scene) this.#scene = null;
      }
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  /** Roll back a failed cold turn and release its cover without reusing stale texture keys. */
  async #restore(scene: Scene) {
    if (this.#scene !== scene) return;
    this.#scene = null;
    // A native failure can destroy the EGL context and its whole texture bank.
    this.#keys.clear();
    try {
      if (scene.navigated && !this.#dead) await this.#navigate(!scene.forward);
      await this.host.onCancelled?.('curl');
    } finally {
      await this.#call({ op: 'finish', turnId: scene.session.id }).catch(() => {});
    }
  }

  /** Enqueue a complete tap begin/end pair before subsequent input can overtake it. */
  override async turn(forward: boolean, rtl: boolean, style: CapturedTurnStyle = 'curl') {
    if (!this.#eligible(style)) return super.turn(forward, rtl, style);
    if (this.#dead) return false;
    // Enqueue the whole tap before yielding. A later tap/swipe must follow
    // this begin/end pair rather than cancel its still-preparing session.
    const beginning = this.beginDrag(forward, rtl, style);
    const [started] = await Promise.all([beginning, this.endDrag(true)]);
    return started;
  }

  /** Abort captures and release this reader's native scene and fallback resources. */
  override dispose() {
    if (this.#dead) return;
    this.#dead = true;
    if (nativeOwner === this) nativeOwner = null;
    this.#abort?.abort();
    cancelAnimationFrame(this.#moveRaf);
    this.#keys.clear();
    this.#scene = null;
    this.#session = null;
    void this.#call({ op: 'dispose' }).catch(() => {});
    super.dispose();
  }
}
