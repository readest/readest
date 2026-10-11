// Fair admission of Readest Voice windows to the shared RunPod endpoint, run
// inside the TTSDispatcher Durable Object (worker.ts). Pure and clock-injected
// so it can be tested; no path aliases, since wrangler bundles it from
// worker.ts.
//
// - At most `capacity` windows run at once across all users.
// - Each user runs at most one window per lane; more wait in that user's
//   queue (up to `maxWaiting` per lane, then refused).
// - A free slot goes to listening before downloads, except that downloads
//   always get a quarter of the capacity (at least one slot) when they wait.
//   Within a lane, the waiting user served least recently goes first, which
//   stays fair across the gap between a reader's back-to-back windows.
// - A client asking for listening again replaces its own waiting or running
//   listen window (a seek or voice change made it stale), without queueing.
// - Waits end after `waitMs`, leases after `leaseMs` (the route's window
//   deadline), so a crashed request never holds a slot for long.

export type DispatchLane = 'listen' | 'download';

export interface SlotRequest {
  userId: string;
  // One per app instance (device or window), so a user's own windows can
  // replace each other while other devices of the user queue.
  clientId: string;
  lane: DispatchLane;
  token: string;
}

export interface SlotResult {
  acquired: boolean;
  // A replaced running listen window's job, for the caller to cancel.
  previousJobId: string | null;
}

export interface Lease extends SlotRequest {
  jobId: string | null;
  expiresAt: number;
}

interface Waiter extends SlotRequest {
  deadline: number;
  resolve: (result: SlotResult) => void;
}

export interface DispatchOptions {
  capacity: number;
  leaseMs: number;
  waitMs: number;
  maxWaiting: number;
}

const MAX_REMEMBERED_USERS = 1000;
const REFUSED: SlotResult = { acquired: false, previousJobId: null };

export class DispatchQueue {
  #leases = new Map<string, Lease>();
  #waiting: Waiter[] = [];
  // Order in which users were last granted a slot.
  #served = new Map<string, number>();
  #grants = 0;

  constructor(
    private readonly options: DispatchOptions,
    private readonly now: () => number = Date.now,
  ) {}

  acquire(request: SlotRequest): Promise<SlotResult> {
    if (request.lane === 'listen') {
      const same = (s: SlotRequest) =>
        s.lane === 'listen' && s.userId === request.userId && s.clientId === request.clientId;
      const stale = this.#waiting.find(same);
      if (stale) this.#drop(stale, REFUSED);
      const running = [...this.#leases.values()].find(same);
      if (running) {
        this.#leases.delete(running.token);
        this.#grant(request);
        return Promise.resolve({ acquired: true, previousJobId: running.jobId });
      }
    }
    const waiting = this.#waiting.filter(
      (w) => w.userId === request.userId && w.lane === request.lane,
    ).length;
    if (waiting >= this.options.maxWaiting) return Promise.resolve(REFUSED);
    const result = new Promise<SlotResult>((resolve) => {
      this.#waiting.push({ ...request, deadline: this.now() + this.options.waitMs, resolve });
    });
    this.#pump();
    return result;
  }

  // Admits a download now or never (the download job bridge, whose jobs wait
  // in the job queue instead): a free slot, and no waiting listen window due
  // it first.
  tryAcquire(request: SlotRequest): boolean {
    if (this.#leases.size >= this.options.capacity) return false;
    const downloads = [...this.#leases.values()].filter((l) => l.lane === 'download').length;
    if (downloads >= this.#downloadReserve() && this.#waiting.some((w) => w.lane === 'listen')) {
      return false;
    }
    this.#grant(request);
    return true;
  }

  // Keeps a lease that legitimately runs longer than `leaseMs` (a bridged
  // download job whose worker still reports in).
  renew(token: string): boolean {
    const lease = this.#leases.get(token);
    if (!lease) return false;
    lease.expiresAt = this.now() + this.options.leaseMs;
    return true;
  }

  // False when the lease is gone (replaced or expired): the caller cancels
  // its job.
  setJob(token: string, jobId: string): boolean {
    const lease = this.#leases.get(token);
    if (!lease) return false;
    lease.jobId = jobId;
    return true;
  }

  // Ends a running window, or withdraws a waiting one.
  release(token: string): void {
    const waiter = this.#waiting.find((w) => w.token === token);
    if (waiter) this.#drop(waiter, REFUSED);
    if (this.#leases.delete(token)) this.#pump();
  }

  sweep(): void {
    const now = this.now();
    for (const lease of [...this.#leases.values()]) {
      if (lease.expiresAt <= now) this.#leases.delete(lease.token);
    }
    this.#pump();
    for (const waiter of this.#waiting.filter((w) => w.deadline <= now)) {
      this.#drop(waiter, REFUSED);
    }
    // Turn order only matters while a user competes; forget idle users once
    // the map grows, so it stays bounded.
    if (this.#served.size > MAX_REMEMBERED_USERS) {
      const active = new Set([
        ...this.#waiting.map((w) => w.userId),
        ...[...this.#leases.values()].map((l) => l.userId),
      ]);
      for (const user of this.#served.keys()) {
        if (!active.has(user)) this.#served.delete(user);
      }
    }
  }

  nextDeadline(): number | null {
    const times = [
      ...[...this.#leases.values()].map((l) => l.expiresAt),
      ...this.#waiting.map((w) => w.deadline),
    ];
    return times.length ? Math.min(...times) : null;
  }

  snapshot(): Lease[] {
    return [...this.#leases.values()].map((lease) => ({ ...lease }));
  }

  restore(leases: Lease[]): void {
    for (const lease of leases) this.#leases.set(lease.token, { ...lease });
  }

  #drop(waiter: Waiter, result: SlotResult) {
    this.#waiting = this.#waiting.filter((w) => w !== waiter);
    waiter.resolve(result);
  }

  #grant(request: SlotRequest) {
    const { userId, clientId, lane, token } = request;
    this.#leases.set(token, {
      userId,
      clientId,
      lane,
      token,
      jobId: null,
      expiresAt: this.now() + this.options.leaseMs,
    });
    this.#served.set(userId, ++this.#grants);
  }

  #pump() {
    while (this.#leases.size < this.options.capacity) {
      const next = this.#next();
      if (!next) return;
      this.#waiting = this.#waiting.filter((w) => w !== next);
      this.#grant(next);
      next.resolve({ acquired: true, previousJobId: null });
    }
  }

  #next(): Waiter | undefined {
    const running = [...this.#leases.values()];
    const downloads = running.filter((l) => l.lane === 'download').length;
    const lanes: DispatchLane[] =
      downloads < this.#downloadReserve() ? ['download', 'listen'] : ['listen', 'download'];
    for (const lane of lanes) {
      let best: Waiter | undefined;
      for (const waiter of this.#waiting) {
        if (waiter.lane !== lane) continue;
        if (running.some((l) => l.userId === waiter.userId && l.lane === lane)) continue;
        // Waiters are in arrival order, so the first per user is its oldest.
        if (!best || this.#turn(waiter.userId) < this.#turn(best.userId)) best = waiter;
      }
      if (best) return best;
    }
    return undefined;
  }

  #downloadReserve(): number {
    return Math.max(1, Math.floor(this.options.capacity / 4));
  }

  #turn(userId: string): number {
    return this.#served.get(userId) ?? 0;
  }
}
