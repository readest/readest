import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { SlotRequest, SlotResult } from './dispatchQueue';
import type { JobState, JobSubmission, LeasedJob, SubmitResult } from './jobQueue';

// Cloudflare bindings of the Readest Voice routes (wrangler.toml): the
// TTSDispatcher Durable Object (tts-dispatcher.ts) and the download result
// bucket. Both are null off Workers (Node dev, self-hosting).

export interface DispatcherStub {
  acquire(request: SlotRequest): Promise<SlotResult>;
  setJob(token: string, jobId: string): Promise<boolean>;
  release(token: string): Promise<void>;
  submitJob(submission: JobSubmission): Promise<SubmitResult>;
  waitJob(jobId: string, userId: string, waitMs: number): Promise<JobState | null>;
  cancelJob(jobId: string, userId: string): Promise<boolean>;
  forgetJob(jobId: string, userId: string): Promise<void>;
  leaseJob(worker: string, engines: string[], waitMs: number): Promise<LeasedJob | null>;
  leasedJob(lease: string): Promise<LeasedJob | null>;
  heartbeat(lease: string): Promise<boolean>;
  completeJob(lease: string): Promise<{ userId: string; plan: string } | null>;
}

export interface ResultBucket {
  put(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<void>;
}

interface DispatcherNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DispatcherStub;
}

interface Bindings {
  TTS_DISPATCHER?: DispatcherNamespace;
  TTS_JOBS_R2?: ResultBucket;
}

const getBindings = (): Bindings => {
  try {
    return getCloudflareContext().env as Bindings;
  } catch {
    // Not on Workers.
    return {};
  }
};

export const getDispatcher = (): DispatcherStub | null => {
  const namespace = getBindings().TTS_DISPATCHER;
  return namespace ? namespace.get(namespace.idFromName('global')) : null;
};

export const getResultBucket = (): ResultBucket | null => getBindings().TTS_JOBS_R2 ?? null;

// Where a finished download job's NDJSON lines wait for the app.
export const resultKey = (jobId: string) => `tts-jobs/${jobId}`;

// Work that must finish after the response is gone (charging, cancelling,
// cleanup): on Workers it has to be registered with waitUntil or it may be
// dropped.
export const runAfterResponse = (task: Promise<unknown>) => {
  try {
    getCloudflareContext().ctx.waitUntil(task);
  } catch {
    // Not on Workers (tests, Node dev): the promise just runs.
  }
};
