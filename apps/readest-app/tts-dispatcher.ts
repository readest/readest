// Readest Voice dispatcher: one global Durable Object that
// - admits listen windows to the shared RunPod endpoint fairly across users
//   (src/libs/readestVoice/dispatchQueue.ts, reached through admission.ts);
// - holds the download job queue that workers pull from
//   (src/libs/readestVoice/jobQueue.ts, reached through jobs.ts), and starts
//   RunPod jobs for queued downloads within the downloads' share of the
//   endpoint (the bridge), so downloads run even with no other worker;
// - keeps track of those workers (src/libs/readestVoice/workerRegistry.ts)
//   for the admin dashboard, which reaches the admin* methods through its
//   own binding (script_name readest-web).
// Re-exported by worker.ts, bound as TTS_DISPATCHER in wrangler.toml.
//
// Running leases and every job are persisted, so an evicted or restarted
// instance keeps counting the work on GPUs and loses no download. Waiting
// calls are not: each one holds an open call, which keeps the instance alive,
// and a restart fails those calls (callers retry or fail open). An alarm
// expires leases, waits and old jobs.
//
// Like worker.ts, this file sits outside tsconfig's `include` and carries its
// own minimal types (the project does not depend on @cloudflare/workers-types).

import { DurableObject } from 'cloudflare:workers';
import {
  DispatchQueue,
  type Lease,
  type SlotRequest,
  type SlotResult,
} from './src/libs/readestVoice/dispatchQueue';
import {
  type Job,
  type JobState,
  type JobSubmission,
  JobQueue,
  type LeasedJob,
  type QueueSummary,
  type SubmitResult,
} from './src/libs/readestVoice/jobQueue';
import { getRunPodConfig, startJob } from './src/libs/readestVoice/runpod';
import {
  BRIDGE_WORKER,
  type CreateResult,
  parseWorkerTokens,
  type TokenSource,
  type WorkerInfo,
  WorkerRegistry,
  type WorkerRecord,
  type WorkerView,
  sha256Hex,
} from './src/libs/readestVoice/workerRegistry';

interface DispatcherEnv {
  // Most windows running at once: RunPod max workers x TTS_CONCURRENCY.
  READEST_VOICE_MAX_JOBS?: string;
  // The worker version download jobs need (shown on the dashboard).
  READEST_VOICE_WORKER_VERSION?: string;
}

export interface AdminSnapshot {
  now: number;
  requiredVersion: string;
  workers: (WorkerView & { running: number; waiting: number })[];
  queue: Omit<QueueSummary, 'running' | 'waiting'>;
  // Windows on the RunPod endpoint: listening, and bridged downloads.
  slots: { capacity: number; listen: number; download: number };
  bridge: { configured: boolean; paused: boolean };
}

interface DispatcherState {
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  waitUntil(promise: Promise<unknown>): void;
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    list<T>(options: { prefix: string }): Promise<Map<string, T>>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    setAlarm(time: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
}

const DEFAULT_MAX_JOBS = 8;
// The route's window deadline (SLOT_TTL_SECONDS in admission.ts).
const LEASE_MS = 180_000;
// SLOT_WAIT_SECONDS in admission.ts.
const WAIT_MS = 60_000;
const MAX_WAITING_PER_LANE = 4;
const LEASES_KEY = 'leases';
const JOB_PREFIX = 'job:';
const WORKER_PREFIX = 'worker:';
// A worker renews its job lease every 30 s (WORKER_HEARTBEAT in the worker).
const JOB_LEASE_MS = 120_000;
const JOB_MAX_ATTEMPTS = 3;
// A few sections of a chapter download ahead.
const MAX_QUEUED_JOBS_PER_USER = 32;
// Matches the result bucket's lifecycle rule.
const JOB_RETAIN_MS = 86_400_000;
// The bridge's name as a worker and as a user of the listen queue.
const BRIDGE = BRIDGE_WORKER;

export class TTSDispatcher extends DurableObject<DispatcherEnv> {
  #state: DispatcherState;
  #queue: DispatchQueue;
  #jobs: JobQueue;
  #workers = new WorkerRegistry();
  #capacity: number;
  #requiredVersion: string;

  constructor(state: DispatcherState, env: DispatcherEnv) {
    super(state, env);
    this.#state = state;
    this.#capacity = Number(env.READEST_VOICE_MAX_JOBS) || DEFAULT_MAX_JOBS;
    this.#requiredVersion = env.READEST_VOICE_WORKER_VERSION ?? '';
    this.#queue = new DispatchQueue({
      capacity: this.#capacity,
      leaseMs: LEASE_MS,
      waitMs: WAIT_MS,
      maxWaiting: MAX_WAITING_PER_LANE,
    });
    this.#jobs = new JobQueue({
      leaseMs: JOB_LEASE_MS,
      maxAttempts: JOB_MAX_ATTEMPTS,
      maxQueuedPerUser: MAX_QUEUED_JOBS_PER_USER,
      retainMs: JOB_RETAIN_MS,
    });
    void state.blockConcurrencyWhile(async () => {
      this.#queue.restore((await state.storage.get<Lease[]>(LEASES_KEY)) ?? []);
      const jobs = await state.storage.list<Job>({ prefix: JOB_PREFIX });
      this.#jobs.restore([...jobs.values()]);
      const workers = await state.storage.list<WorkerRecord>({ prefix: WORKER_PREFIX });
      this.#workers.restore([...workers.values()]);
      if (getRunPodConfig()) this.#workers.known(BRIDGE);
      for (const name of this.#workers.paused()) this.#jobs.setPaused(name, true);
    });
  }

  // Also reports the user's unfinished download characters, which the
  // listen route counts against the daily quota.
  async acquire(request: SlotRequest): Promise<SlotResult & { pendingChars: number }> {
    const result = this.#queue.acquire(request);
    this.#changed();
    return { ...(await result), pendingChars: this.#jobs.pendingChars(request.userId) };
  }

  setJob(token: string, jobId: string): boolean {
    const recorded = this.#queue.setJob(token, jobId);
    this.#changed();
    return recorded;
  }

  release(token: string): void {
    this.#queue.release(token);
    this.#changed();
  }

  submitJob(submission: JobSubmission): SubmitResult {
    const result = this.#jobs.submit(submission);
    this.#changed();
    return result;
  }

  waitJob(jobId: string, userId: string, waitMs: number): Promise<JobState | null> {
    const state = this.#jobs.wait(jobId, userId, waitMs);
    this.#changed();
    return state;
  }

  cancelJob(jobId: string, userId: string): boolean {
    const cancelled = this.#jobs.cancel(jobId, userId);
    this.#changed();
    return cancelled;
  }

  forgetJob(jobId: string, userId: string): void {
    this.#jobs.forget(jobId, userId);
    this.#changed();
  }

  leaseJob(
    worker: string,
    engines: string[],
    waitMs: number,
    version: string,
    via: TokenSource,
  ): Promise<LeasedJob | null> {
    if (!this.#workers.seen(worker, { engines, version }, via)) return Promise.resolve(null);
    const job = this.#jobs.lease(worker, engines, waitMs);
    this.#changed();
    return job;
  }

  // The name of the dashboard-made worker holding this token hash.
  authenticateWorker(tokenHash: string): string | null {
    return this.#workers.authenticate(tokenHash);
  }

  // A worker turned away for its version: shown as needing an upgrade.
  workerRejected(worker: string, info: WorkerInfo, via: TokenSource): void {
    this.#workers.rejected(worker, info, via);
    this.#changed();
  }

  leasedJob(lease: string): LeasedJob | null {
    return this.#jobs.job(lease);
  }

  heartbeat(lease: string): boolean {
    const worker = this.#jobs.workerOf(lease);
    const live = this.#jobs.heartbeat(lease);
    if (worker) this.#workers.touch(worker);
    // A bridged job also holds a slot of the listen queue.
    if (live) this.#queue.renew(lease);
    this.#changed();
    return live;
  }

  // `chars`: the characters the worker delivered (charged to the user).
  completeJob(lease: string, chars = 0): { userId: string; plan: string } | null {
    const owner = this.#jobs.complete(lease);
    if (owner) this.#workers.jobDone(owner.worker, chars);
    this.#changed();
    return owner && { userId: owner.userId, plan: owner.plan };
  }

  alarm(): void {
    this.#queue.sweep();
    for (const worker of this.#jobs.sweep()) this.#workers.jobLost(worker);
    this.#changed();
  }

  // Counts and worker data only: no users, book text or job ids.
  adminSnapshot(): AdminSnapshot {
    const { running, waiting, ...queue } = this.#jobs.summary();
    const leases = this.#queue.snapshot();
    return {
      now: Date.now(),
      requiredVersion: this.#requiredVersion,
      workers: this.#workers.list().map((worker) => ({
        ...worker,
        running: running[worker.name] ?? 0,
        waiting: waiting[worker.name] ?? 0,
      })),
      queue,
      slots: {
        capacity: this.#capacity,
        listen: leases.filter((lease) => lease.lane === 'listen').length,
        download: leases.filter((lease) => lease.lane === 'download').length,
      },
      bridge: { configured: !!getRunPodConfig(), paused: this.#workers.isPaused(BRIDGE) },
    };
  }

  // The token is returned once; only its hash is kept.
  async adminCreateWorker(name: string): Promise<CreateResult & { token?: string }> {
    // A name in the secret already belongs to that token.
    const configured = parseWorkerTokens(process.env['READEST_VOICE_WORKER_TOKENS']);
    if (configured.some((entry) => entry.name === name)) return { ok: false, error: 'NAME_TAKEN' };
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    const result = this.#workers.create(name, await sha256Hex(token));
    this.#changed();
    return result.ok ? { ...result, token } : result;
  }

  // Its jobs go back to the queue at once.
  adminRemoveWorker(name: string): boolean {
    const removed = this.#workers.remove(name);
    if (removed) {
      this.#jobs.requeueWorker(name);
      this.#jobs.setPaused(name, false);
    }
    this.#changed();
    return removed;
  }

  // Pausing the bridge leaves downloads to the pull workers.
  adminSetPaused(name: string, paused: boolean): boolean {
    const known = this.#workers.setPaused(name, paused);
    if (known) this.#jobs.setPaused(name, paused);
    this.#changed();
    return known;
  }

  // Every grant, release and expiry happens inside one of the calls above,
  // so settling bridged jobs and persisting after each keeps storage and the
  // alarm in step.
  #changed() {
    // A bridged job that ended (or lost its lease) frees its slot; free slots
    // may take more bridged jobs.
    for (const lease of this.#queue.snapshot()) {
      if (lease.userId === BRIDGE && !this.#jobs.isLeaseLive(lease.token)) {
        this.#queue.release(lease.token);
      }
    }
    this.#bridge();

    const { storage } = this.#state;
    void storage.put(LEASES_KEY, this.#queue.snapshot());
    const { put, deleted } = this.#jobs.takeChanges();
    for (const job of put) void storage.put(JOB_PREFIX + job.id, job);
    for (const id of deleted) void storage.delete(JOB_PREFIX + id);
    const workers = this.#workers.takeChanges();
    for (const record of workers.put) void storage.put(WORKER_PREFIX + record.name, record);
    for (const name of workers.deleted) void storage.delete(WORKER_PREFIX + name);
    const times = [this.#queue.nextDeadline(), this.#jobs.nextDeadline()].filter(
      (time): time is number => time !== null,
    );
    void (times.length ? storage.setAlarm(Math.min(...times)) : storage.deleteAlarm());
  }

  // Starts a RunPod job for each queued download the endpoint has room for.
  // The RunPod job carries only the lease: the worker fetches the window and
  // reports back like any other worker. A job that fails to start keeps its
  // lease until it runs out, then queues again.
  #bridge() {
    const config = getRunPodConfig();
    if (!config || this.#workers.isPaused(BRIDGE)) return;
    while (this.#jobs.hasQueued()) {
      const lease = crypto.randomUUID();
      const request = { userId: BRIDGE, clientId: BRIDGE, lane: 'download' as const, token: lease };
      if (!this.#queue.tryAcquire(request)) return;
      this.#jobs.leaseNow(BRIDGE, null, lease);
      this.#workers.touch(BRIDGE);
      this.#state.waitUntil(
        startJob(config, { lease }).catch((error) => {
          console.error('Readest Voice bridge job start failed:', error);
        }),
      );
    }
  }
}
