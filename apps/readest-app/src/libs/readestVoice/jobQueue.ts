// Durable download jobs for Readest Voice, run inside the TTSDispatcher
// Durable Object (tts-dispatcher.ts) beside the listen admission queue. Pure
// and clock-injected so it can be tested; no path aliases, since wrangler
// bundles it from worker.ts.
//
// - An app submits a window of sentences as a job; any worker that runs every
//   engine the job needs leases it, renews the lease while it works, and
//   completes it with the audio (stored by the route, not here).
// - The same window submitted again (same id) returns the existing job, so a
//   download resumed later picks up what finished meanwhile.
// - Fair order: the waiting user served least recently goes first. A user may
//   run several jobs at once only when nobody else waits.
// - A lease that runs out puts the job back in the queue; after `maxAttempts`
//   leases it fails.
// - Book text lives only until a job ends; ended jobs are forgotten after
//   `retainMs`, as is any job nobody touched for that long.

export type JobState = 'queued' | 'leased' | 'done' | 'failed' | 'cancelled';

export interface JobSegment {
  id: string;
  text: string;
  voice: string;
}

export interface JobSubmission {
  // Derived from the user and the window, so a resubmit finds its job.
  id: string;
  userId: string;
  plan: string;
  lang: string;
  segments: JobSegment[];
  // Engines a worker must run to synthesize every segment.
  engines: string[];
  // Characters the user may still use today; unfinished jobs count against it.
  quotaLeft: number;
}

export type SubmitResult =
  | { ok: true; state: JobState }
  | { ok: false; error: 'BUSY' | 'DAILY_QUOTA_EXCEEDED' };

export interface Job {
  id: string;
  userId: string;
  plan: string;
  lang: string;
  segments: JobSegment[];
  engines: string[];
  chars: number;
  state: JobState;
  attempts: number;
  lease: string | null;
  worker: string | null;
  leaseExpiresAt: number;
  updatedAt: number;
}

export interface LeasedJob {
  jobId: string;
  lease: string;
  lang: string;
  segments: JobSegment[];
}

export interface JobOptions {
  leaseMs: number;
  maxAttempts: number;
  maxQueuedPerUser: number;
  retainMs: number;
}

interface WorkerWaiter {
  worker: string;
  engines: string[];
  deadline: number;
  resolve: (job: LeasedJob | null) => void;
}

interface AppWaiter {
  jobId: string;
  deadline: number;
  resolve: (state: JobState | null) => void;
}

const MAX_REMEMBERED_USERS = 1000;
const ENDED: readonly JobState[] = ['done', 'failed', 'cancelled'];

export class JobQueue {
  #jobs = new Map<string, Job>();
  #workers: WorkerWaiter[] = [];
  #apps: AppWaiter[] = [];
  // Order in which users were last served a job.
  #served = new Map<string, number>();
  #leases = 0;
  #dirty = new Set<string>();

  constructor(
    private readonly options: JobOptions,
    private readonly now: () => number = Date.now,
  ) {}

  submit(submission: JobSubmission): SubmitResult {
    const { quotaLeft, ...fields } = submission;
    const existing = this.#jobs.get(fields.id);
    if (existing?.userId === fields.userId && !['failed', 'cancelled'].includes(existing.state)) {
      return { ok: true, state: existing.state };
    }
    const queued = [...this.#jobs.values()].filter(
      (job) => job.userId === fields.userId && job.state === 'queued',
    );
    if (queued.length >= this.options.maxQueuedPerUser) return { ok: false, error: 'BUSY' };
    const chars = fields.segments.reduce((sum, s) => sum + s.text.length, 0);
    if (this.pendingChars(fields.userId) + chars > quotaLeft) {
      return { ok: false, error: 'DAILY_QUOTA_EXCEEDED' };
    }
    // Re-inserted, so a resubmitted job queues behind the others.
    this.#jobs.delete(fields.id);
    this.#jobs.set(fields.id, {
      ...fields,
      chars,
      state: 'queued',
      attempts: 0,
      lease: null,
      worker: null,
      leaseExpiresAt: 0,
      updatedAt: this.now(),
    });
    this.#dirty.add(fields.id);
    this.#pump();
    return { ok: true, state: 'queued' };
  }

  // Characters of this user's unfinished jobs: not charged yet, but spoken
  // for. The listen route counts them against the quota too.
  pendingChars(userId: string): number {
    let chars = 0;
    for (const job of this.#jobs.values()) {
      if (job.userId === userId && (job.state === 'queued' || job.state === 'leased')) {
        chars += job.chars;
      }
    }
    return chars;
  }

  hasQueued(): boolean {
    return [...this.#jobs.values()].some((job) => job.state === 'queued');
  }

  // A job for this worker now, or null. `engines` null runs every engine;
  // `lease` lets the caller name the lease up front.
  leaseNow(
    worker: string,
    engines: string[] | null,
    lease: string = crypto.randomUUID(),
  ): LeasedJob | null {
    const job = this.#pick(engines);
    return job ? this.#grant(job, worker, lease) : null;
  }

  // Waits up to `waitMs` for a job (a worker's long poll).
  lease(worker: string, engines: string[], waitMs: number): Promise<LeasedJob | null> {
    const job = this.leaseNow(worker, engines);
    if (job) return Promise.resolve(job);
    return new Promise((resolve) => {
      this.#workers.push({ worker, engines, deadline: this.now() + waitMs, resolve });
    });
  }

  // The window a lease holder works on, while the lease is live.
  job(lease: string): LeasedJob | null {
    const job = this.#byLease(lease);
    return job ? this.#leased(job) : null;
  }

  isLeaseLive(lease: string): boolean {
    return !!this.#byLease(lease);
  }

  // Renews a live lease; false tells the worker to stop (cancelled, or the
  // lease ran out and the job went to someone else).
  heartbeat(lease: string): boolean {
    const job = this.#byLease(lease);
    if (!job) return false;
    job.leaseExpiresAt = this.now() + this.options.leaseMs;
    this.#dirty.add(job.id);
    return true;
  }

  // Null when the lease is no longer live: the result must be discarded.
  complete(lease: string): { userId: string; plan: string } | null {
    const job = this.#byLease(lease);
    if (!job) return null;
    this.#end(job, 'done');
    return { userId: job.userId, plan: job.plan };
  }

  cancel(jobId: string, userId: string): boolean {
    const job = this.#owned(jobId, userId);
    if (!job || ENDED.includes(job.state)) return false;
    this.#end(job, 'cancelled');
    return true;
  }

  status(jobId: string, userId: string): JobState | null {
    return this.#owned(jobId, userId)?.state ?? null;
  }

  // The job's state once it ends, or after `waitMs` (an app's long poll).
  wait(jobId: string, userId: string, waitMs: number): Promise<JobState | null> {
    const job = this.#owned(jobId, userId);
    if (!job || ENDED.includes(job.state)) return Promise.resolve(job?.state ?? null);
    return new Promise((resolve) => {
      this.#apps.push({ jobId, deadline: this.now() + waitMs, resolve });
    });
  }

  // The app has the result: nothing left to keep.
  forget(jobId: string, userId: string): void {
    if (!this.#owned(jobId, userId)) return;
    this.#jobs.delete(jobId);
    this.#dirty.add(jobId);
    this.#wake(jobId, null);
  }

  sweep(): void {
    const now = this.now();
    for (const job of [...this.#jobs.values()]) {
      if (job.state === 'leased' && job.leaseExpiresAt <= now) {
        if (job.attempts >= this.options.maxAttempts) {
          this.#end(job, 'failed');
        } else {
          job.state = 'queued';
          job.lease = null;
          job.worker = null;
          job.updatedAt = now;
          this.#dirty.add(job.id);
        }
      } else if (job.state !== 'leased' && job.updatedAt + this.options.retainMs <= now) {
        this.#jobs.delete(job.id);
        this.#dirty.add(job.id);
        this.#wake(job.id, null);
      }
    }
    this.#pump();
    for (const waiter of this.#workers.filter((w) => w.deadline <= now)) {
      this.#workers = this.#workers.filter((w) => w !== waiter);
      waiter.resolve(null);
    }
    for (const waiter of this.#apps.filter((w) => w.deadline <= now)) {
      this.#apps = this.#apps.filter((w) => w !== waiter);
      waiter.resolve(this.#jobs.get(waiter.jobId)?.state ?? null);
    }
    // Turn order only matters while a user waits; forget idle users once the
    // map grows, so it stays bounded.
    if (this.#served.size > MAX_REMEMBERED_USERS) {
      const active = new Set([...this.#jobs.values()].map((job) => job.userId));
      for (const user of this.#served.keys()) {
        if (!active.has(user)) this.#served.delete(user);
      }
    }
  }

  nextDeadline(): number | null {
    const times = [
      ...[...this.#jobs.values()].map((job) =>
        job.state === 'leased' ? job.leaseExpiresAt : job.updatedAt + this.options.retainMs,
      ),
      ...this.#workers.map((w) => w.deadline),
      ...this.#apps.map((w) => w.deadline),
    ];
    return times.length ? Math.min(...times) : null;
  }

  // Jobs changed (to store) and removed (to delete) since the last call.
  takeChanges(): { put: Job[]; deleted: string[] } {
    const put: Job[] = [];
    const deleted: string[] = [];
    for (const id of this.#dirty) {
      const job = this.#jobs.get(id);
      if (job) put.push({ ...job });
      else deleted.push(id);
    }
    this.#dirty.clear();
    return { put, deleted };
  }

  restore(jobs: Job[]): void {
    for (const job of jobs) this.#jobs.set(job.id, { ...job });
  }

  #owned(jobId: string, userId: string): Job | undefined {
    const job = this.#jobs.get(jobId);
    return job?.userId === userId ? job : undefined;
  }

  #byLease(lease: string): Job | undefined {
    for (const job of this.#jobs.values()) {
      if (job.state === 'leased' && job.lease === lease) return job;
    }
    return undefined;
  }

  #leased(job: Job): LeasedJob {
    return { jobId: job.id, lease: job.lease!, lang: job.lang, segments: job.segments };
  }

  #pick(engines: string[] | null): Job | undefined {
    let best: Job | undefined;
    for (const job of this.#jobs.values()) {
      if (job.state !== 'queued') continue;
      if (engines && !job.engines.every((engine) => engines.includes(engine))) continue;
      // Jobs are in arrival order, so the first per user is its oldest.
      if (!best || this.#turn(job.userId) < this.#turn(best.userId)) best = job;
    }
    return best;
  }

  #grant(job: Job, worker: string, lease: string = crypto.randomUUID()): LeasedJob {
    job.state = 'leased';
    job.lease = lease;
    job.worker = worker;
    job.attempts += 1;
    job.leaseExpiresAt = this.now() + this.options.leaseMs;
    job.updatedAt = this.now();
    this.#dirty.add(job.id);
    this.#served.set(job.userId, ++this.#leases);
    return this.#leased(job);
  }

  #pump() {
    for (const waiter of [...this.#workers]) {
      const job = this.#pick(waiter.engines);
      if (!job) continue;
      this.#workers = this.#workers.filter((w) => w !== waiter);
      waiter.resolve(this.#grant(job, waiter.worker));
    }
  }

  #end(job: Job, state: JobState) {
    job.state = state;
    job.segments = [];
    job.lease = null;
    job.updatedAt = this.now();
    this.#dirty.add(job.id);
    this.#wake(job.id, state);
  }

  #wake(jobId: string, state: JobState | null) {
    for (const waiter of this.#apps.filter((w) => w.jobId === jobId)) {
      this.#apps = this.#apps.filter((w) => w !== waiter);
      waiter.resolve(state);
    }
  }

  #turn(userId: string): number {
    return this.#served.get(userId) ?? 0;
  }
}
