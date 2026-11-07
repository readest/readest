import type { GenreMetadata } from './genre';

export interface XRayScheduledUpdate {
  readonly bookHash: string;
  readonly currentCfi: string;
  readonly metadata?: GenreMetadata;
}

export type XRayUpdateRunner = (update: XRayScheduledUpdate, signal: AbortSignal) => Promise<void>;

export interface XRaySchedulerOptions {
  readonly delayMs?: number;
  readonly onError?: (error: Error) => void;
}

export class XRayScheduler {
  private readonly delayMs: number;
  private readonly onError?: (error: Error) => void;
  private latest: XRayScheduledUpdate | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private activeController: AbortController | null = null;
  private disposed = false;

  constructor(
    private readonly run: XRayUpdateRunner,
    options: XRaySchedulerOptions = {},
  ) {
    this.delayMs = Math.max(0, options.delayMs ?? 3_000);
    this.onError = options.onError;
  }

  schedule(update: XRayScheduledUpdate): void {
    if (this.disposed) return;
    this.latest = update;
    if (this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.startDrain();
    }, this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.disposed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    do {
      await this.startDrain();
    } while (!this.disposed && this.latest);
  }

  dispose(): void {
    this.disposed = true;
    this.latest = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.activeController?.abort();
  }

  private startDrain(): Promise<void> {
    if (this.running) return this.running;
    const running = this.drain().finally(() => {
      if (this.running === running) this.running = null;
    });
    this.running = running;
    return running;
  }

  private async drain(): Promise<void> {
    while (!this.disposed && this.latest) {
      const update = this.latest;
      this.latest = null;
      const controller = new AbortController();
      this.activeController = controller;
      try {
        await this.run(update, controller.signal);
      } catch (error) {
        if (!this.disposed) {
          this.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        if (this.activeController === controller) this.activeController = null;
      }
    }
  }
}
