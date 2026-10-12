// The admin methods of the TTSDispatcher Durable Object (tts-dispatcher.ts),
// called by the Readest Voice dashboard Worker (workers/voice-admin) through
// its own binding. Types only; no path aliases, since wrangler bundles this
// from both Workers.

import type { QueueSummary } from './jobQueue';
import type { CreateResult, WorkerView } from './workerRegistry';

// Counts and worker data only: no users, book text or job ids.
export interface AdminSnapshot {
  now: number;
  // The worker version download jobs need ('' accepts any).
  requiredVersion: string;
  workers: (WorkerView & { running: number; waiting: number })[];
  queue: Omit<QueueSummary, 'running' | 'waiting'>;
  // Windows on the RunPod endpoint: listening, and bridged downloads.
  slots: { capacity: number; listen: number; download: number };
  bridge: { configured: boolean; paused: boolean };
}

export interface DispatcherAdmin {
  adminSnapshot(): AdminSnapshot;
  // The token is returned once; only its hash is kept.
  adminCreateWorker(name: string): Promise<CreateResult & { token?: string }>;
  // Its jobs go back to the queue at once.
  adminRemoveWorker(name: string): boolean;
  // Pausing the bridge leaves downloads to the pull workers.
  adminSetPaused(name: string, paused: boolean): boolean;
}
