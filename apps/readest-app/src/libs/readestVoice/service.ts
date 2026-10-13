// The Readest Voice service (the readest-voice Worker): the dispatcher,
// RunPod and the download workers live there; the routes here only gate,
// check quota and charge. Reached through the READEST_VOICE service binding
// (wrangler.toml); absent off Workers (Node dev, self-hosting), when the
// routes answer NOT_CONFIGURED / JOBS_UNAVAILABLE.
//
// The types below copy service/src/contract.ts in the readest-voice repo.
// Keep them identical: the service reports its CONTRACT_VERSION and a
// mismatch switches Readest Voice off here instead of misreading replies.

import { getCloudflareContext } from '@opennextjs/cloudflare';

export const CONTRACT_VERSION = 1;

export type Lane = 'listen' | 'download';

export interface Segment {
  id: string;
  text: string;
  voice: string;
}

export interface WindowAdmission {
  // A token the app makes; names this window in later calls.
  token: string;
  userId: string;
  // One device of the user: a new window replaces its previous one per lane.
  clientId: string;
  lane: Lane;
}

export interface Admitted {
  // False when refused, timed out or withdrawn: the app answers BUSY.
  acquired: boolean;
  // Characters of the user's download jobs not charged yet, for the quota.
  pendingChars: number;
}

// NDJSON, one line per sentence as it is ready, then a last {done} line:
//   {id, audio, boundaries} | {id, error} ... {done: true, error?}
// Cancelling the stream stops the job and frees the slot.
export type StreamResult =
  | { ok: true; stream: ReadableStream<Uint8Array> }
  | { ok: false; error: 'NOT_CONFIGURED' | 'UPSTREAM_FAILED' };

export interface JobRequest {
  userId: string;
  lang: string;
  segments: Segment[];
  // Engines a worker must run (from the voices, which the app checked).
  engines: string[];
  // Characters the user may still use today.
  quotaLeft: number;
}

export type JobState = 'queued' | 'leased' | 'done' | 'failed' | 'cancelled';

export type SubmitResult =
  | { ok: true; jobId: string; state: JobState }
  | { ok: false; error: 'BUSY' | 'DAILY_QUOTA_EXCEEDED' };

export interface JobResult {
  // NDJSON: the same sentence lines as a stream, then {done, charged}.
  body: string;
  // Characters delivered, for the app to charge.
  charged: number;
}

export interface ReadestVoiceService {
  contractVersion(): Promise<number>;
  // Boots a GPU worker so the first window is warm.
  warmup(): Promise<void>;

  // Listening: admit (may wait its turn), check quota, then stream.
  admitWindow(request: WindowAdmission): Promise<Admitted>;
  streamWindow(token: string, window: { lang: string; segments: Segment[] }): Promise<StreamResult>;
  // Ends a window: withdraws it if it waits, frees its slot, and stops its
  // synthesis if it streams. The app calls it whenever it gives a window up
  // (over quota, client gone, stream broken); harmless after the window ended.
  releaseWindow(token: string): Promise<void>;

  // Downloads.
  submitJob(request: JobRequest): Promise<SubmitResult>;
  // The job's state once it ends, or after waitMs.
  waitJob(jobId: string, userId: string, waitMs: number): Promise<JobState | null>;
  // A done job's result, once: it is gone afterwards.
  takeResult(jobId: string, userId: string): Promise<JobResult | null>;
  cancelJob(jobId: string, userId: string): Promise<void>;
}

let verified: Promise<boolean> | null = null;

const checkContract = (service: ReadestVoiceService): Promise<boolean> =>
  // Promise.resolve: under next dev the platform proxy answers RPC calls
  // with plain values.
  (verified ??= Promise.resolve(service.contractVersion()).then(
    (version) => {
      if (version === CONTRACT_VERSION) return true;
      console.error(
        `Readest Voice service speaks contract ${version}, this app ${CONTRACT_VERSION}`,
      );
      return false;
    },
    (error) => {
      console.error('Readest Voice service unreachable:', error);
      // Ask again next time.
      verified = null;
      return false;
    },
  ));

export const getVoiceService = async (): Promise<ReadestVoiceService | null> => {
  let service: ReadestVoiceService | undefined;
  try {
    service = (getCloudflareContext().env as { READEST_VOICE?: ReadestVoiceService }).READEST_VOICE;
  } catch {
    // Not on Workers.
    return null;
  }
  if (!service) return null;
  return (await checkContract(service)) ? service : null;
};

// Work that must finish after the response is gone (charging, releasing a
// slot, cleanup): on Workers it has to be registered with waitUntil or it
// may be dropped.
export const runAfterResponse = (task: Promise<unknown>) => {
  try {
    getCloudflareContext().ctx.waitUntil(task);
  } catch {
    // Not on Workers (tests, Node dev): the promise just runs.
  }
};
