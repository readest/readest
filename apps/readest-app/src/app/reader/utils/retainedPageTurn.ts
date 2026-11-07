import type { CapturedTurnHost, CapturedTurnStyle } from './capturedTurn';
import { NativePageTurn } from './nativePageTurn';

type PushSession = { progress: number; ready: boolean; raf: number };

/** Flat fixed-layout turns keep the real page views resident in the renderer.
 * Curl/flip retain their existing native renderer and texture bank. */
export class RetainedPageTurn extends NativePageTurn {
  private readonly renderer: ConstructorParameters<typeof NativePageTurn>[1]['renderer'];
  private push: PushSession | null = null;
  private readonly pushes = new Set<PushSession>();
  private queue: Promise<unknown> = Promise.resolve();
  private dead = false;

  constructor(
    private readonly pageHost: CapturedTurnHost,
    native: ConstructorParameters<typeof NativePageTurn>[1],
    private readonly onCommitted: () => void,
  ) {
    super(pageHost, native);
    this.renderer = native.renderer;
  }

  private supports(style: CapturedTurnStyle) {
    return style === 'push' && !!this.renderer.beginPageTurn;
  }

  override get active() {
    return this.pushes.size > 0 || super.active;
  }

  override prepareCapture(style: CapturedTurnStyle = 'curl'): Promise<boolean> {
    if (!this.supports(style)) return super.prepareCapture(style);
    if (this.dead || this.pageHost.isCaptureAllowed?.() === false) return Promise.resolve(false);
    return Promise.all([
      this.renderer.preparePageTurn!(true),
      this.renderer.preparePageTurn!(false),
    ]).then((results) => results.some(Boolean));
  }

  override beginDrag(
    forward: boolean,
    rtl: boolean,
    style: CapturedTurnStyle = 'curl',
  ): Promise<boolean> {
    if (!this.supports(style)) {
      if (this.push) void this.endDrag(false);
      return this.queue.then(() => super.beginDrag(forward, rtl, style));
    }
    if (this.push) void this.endDrag(false);
    const session: PushSession = { progress: 0, ready: false, raf: 0 };
    this.push = session;
    this.pushes.add(session);
    const started = this.queue.then(async () => {
      try {
        if (this.dead || this.pageHost.isCaptureAllowed?.() === false) return false;
        const ready = await this.renderer.beginPageTurn!(forward);
        if (this.dead) return false;
        if (this.pageHost.isCaptureAllowed?.() === false) {
          this.renderer.cancelPageTurn!();
          return false;
        }
        if (ready) this.renderer.movePageTurn!(session.progress);
        session.ready = ready;
        return ready;
      } catch (error) {
        if (!this.dead) this.renderer.cancelPageTurn!();
        throw error;
      } finally {
        if (!session.ready) {
          if (this.push === session) this.push = null;
          this.pushes.delete(session);
        }
      }
    });
    this.queue = started.catch(() => {});
    return started;
  }

  override moveDrag(progress: number, grabY: number) {
    const session = this.push;
    if (!session) return super.moveDrag(progress, grabY);
    session.progress = Math.max(0, Math.min(1, progress));
    if (!session.ready || session.raf) return;
    session.raf = requestAnimationFrame(() => {
      session.raf = 0;
      if (this.push === session) this.renderer.movePageTurn!(session.progress);
    });
  }

  override endDrag(commit: boolean, velocity = 0): Promise<void> {
    const session = this.push;
    if (!session) return super.endDrag(commit, velocity);
    this.push = null;
    cancelAnimationFrame(session.raf);
    const ended = this.queue
      .then(async () => {
        if (!session.ready || this.dead) return;
        this.renderer.movePageTurn!(session.progress);
        const distance = Math.abs((commit ? 1 : 0) - session.progress);
        const boost = Math.min(2, Math.max(1, Math.abs(velocity) / 0.3));
        const confirmed = await this.renderer.endPageTurn!(
          commit && this.pageHost.isCaptureAllowed?.() !== false,
          Math.max(60, (240 * distance) / boost),
        );
        if (confirmed && !this.dead) this.onCommitted();
      })
      .finally(() => {
        this.pushes.delete(session);
      });
    this.queue = ended.catch(() => {});
    return ended;
  }

  override async turn(
    forward: boolean,
    rtl: boolean,
    style: CapturedTurnStyle = 'curl',
  ): Promise<boolean> {
    if (!this.supports(style)) {
      if (this.push) await this.endDrag(false);
      await this.queue;
      return super.turn(forward, rtl, style);
    }
    if (!this.push && this.pushes.size) return false;
    if (!(await this.beginDrag(forward, rtl, style))) return false;
    await this.endDrag(true);
    return true;
  }

  override invalidatePreparedCapture() {
    this.renderer.cancelPageTurn?.();
    if (this.push) this.push.ready = false;
    super.invalidatePreparedCapture();
  }

  override dispose() {
    this.dead = true;
    for (const session of this.pushes) cancelAnimationFrame(session.raf);
    this.renderer.cancelPageTurn?.();
    this.push = null;
    this.pushes.clear();
    super.dispose();
  }
}
