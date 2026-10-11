import type { TTSLane } from '@/services/tts/providers/types';
import { type AdmissionResult, getDispatcher } from './bindings';

// Admission of Readest Voice windows through the TTSDispatcher Durable Object
// (worker.ts, scheduling in dispatchQueue.ts): one global queue that runs at
// most READEST_VOICE_MAX_JOBS windows, one per user and lane, and serves
// waiting users in turn. Every call fails open: an unbound dispatcher (Node
// dev, self-hosting) or a failed call admits the window, and the RunPod
// max-workers cap plus the account spend limit stay the hard ceiling.

export type { AdmissionResult, TTSLane };

// Matches the route's window deadline: a slot never outlives its request.
export const SLOT_TTL_SECONDS = 180;
// Longer than a window usually runs, shorter than proxies wait for a reply.
export const SLOT_WAIT_SECONDS = 60;

const ADMITTED: AdmissionResult = { acquired: true, previousJobId: null, pendingChars: 0 };

// Resolves once the window may start (possibly after waiting its turn), or
// with acquired false when it was refused, timed out or withdrawn.
// pendingChars: the user's unfinished download jobs, to count against quota.
export const acquireSlot = async (
  userId: string,
  clientId: string,
  lane: TTSLane,
  token: string,
): Promise<AdmissionResult> => {
  const dispatcher = getDispatcher();
  if (!dispatcher) return ADMITTED;
  try {
    return await dispatcher.acquire({ userId, clientId, lane, token });
  } catch (error) {
    console.warn('TTS slot acquire failed, admitting:', error);
    return ADMITTED;
  }
};

// False when another window of this client took the slot meanwhile.
export const setSlotJob = async (token: string, jobId: string): Promise<boolean> => {
  const dispatcher = getDispatcher();
  if (!dispatcher) return true;
  try {
    return await dispatcher.setJob(token, jobId);
  } catch (error) {
    console.warn('TTS slot update failed, keeping the job:', error);
    return true;
  }
};

// Ends a running window, or withdraws a waiting one.
export const releaseSlot = async (token: string): Promise<void> => {
  const dispatcher = getDispatcher();
  if (!dispatcher) return;
  try {
    await dispatcher.release(token);
  } catch (error) {
    // The lease expires on its own (SLOT_TTL_SECONDS).
    console.warn('TTS slot release failed:', error);
  }
};
