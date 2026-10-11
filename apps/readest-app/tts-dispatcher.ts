// Readest Voice dispatcher: one global Durable Object that admits windows to
// the shared RunPod endpoint fairly across users (scheduling rules in
// src/libs/readestVoice/dispatchQueue.ts; the route reaches it through
// src/libs/readestVoice/admission.ts). Re-exported by worker.ts, bound as
// TTS_DISPATCHER in wrangler.toml.
//
// Running leases are persisted, so an evicted or restarted instance keeps
// counting the jobs still on the GPU. Waiting requests are not: each one holds
// an open call, which keeps the instance alive, and a restart fails those calls
// (the route then admits, failing open). An alarm expires leases and waits.
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

interface DispatcherEnv {
  // Most windows running at once: RunPod max workers x TTS_CONCURRENCY.
  READEST_VOICE_MAX_JOBS?: string;
}

interface DispatcherState {
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
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

export class TTSDispatcher extends DurableObject<DispatcherEnv> {
  #state: DispatcherState;
  #queue: DispatchQueue;

  constructor(state: DispatcherState, env: DispatcherEnv) {
    super(state, env);
    this.#state = state;
    this.#queue = new DispatchQueue({
      capacity: Number(env.READEST_VOICE_MAX_JOBS) || DEFAULT_MAX_JOBS,
      leaseMs: LEASE_MS,
      waitMs: WAIT_MS,
      maxWaiting: MAX_WAITING_PER_LANE,
    });
    void state.blockConcurrencyWhile(async () => {
      this.#queue.restore((await state.storage.get<Lease[]>(LEASES_KEY)) ?? []);
    });
  }

  acquire(request: SlotRequest): Promise<SlotResult> {
    const result = this.#queue.acquire(request);
    this.#changed();
    return result;
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

  alarm(): void {
    this.#queue.sweep();
    this.#changed();
  }

  // Every grant, release and expiry happens inside one of the calls above,
  // so persisting after each keeps storage and the alarm in step.
  #changed() {
    const { storage } = this.#state;
    void storage.put(LEASES_KEY, this.#queue.snapshot());
    const next = this.#queue.nextDeadline();
    void (next === null ? storage.deleteAlarm() : storage.setAlarm(next));
  }
}
