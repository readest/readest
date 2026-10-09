import type { TTSLane } from '@/services/tts/providers/types';
import { createSupabaseAdminClient } from '@/utils/supabase';

// Per-user in-flight windows for Readest Voice (migration 026_tts_inflight):
// at most one listen and one download window per user. Every call fails open,
// like the usage counters: a store outage admits the window, and the RunPod
// max-workers cap plus the account spend limit stay the hard ceiling.

export type { TTSLane };

// Matches the route's window deadline: a slot never outlives its request.
export const SLOT_TTL_SECONDS = 180;

export interface SlotResult {
  acquired: boolean;
  previousJobId: string | null;
}

const ADMITTED: SlotResult = { acquired: true, previousJobId: null };

export const acquireSlot = async (
  userId: string,
  lane: TTSLane,
  token: string,
): Promise<SlotResult> => {
  try {
    const { data, error } = await createSupabaseAdminClient().rpc('tts_acquire_slot', {
      p_user_id: userId,
      p_lane: lane,
      p_token: token,
      p_ttl_seconds: SLOT_TTL_SECONDS,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as
      | { acquired?: boolean; previous_job_id?: string | null }
      | undefined;
    if (!row) return ADMITTED;
    return { acquired: row.acquired !== false, previousJobId: row.previous_job_id ?? null };
  } catch (error) {
    console.warn('TTS slot acquire failed, admitting:', error);
    return ADMITTED;
  }
};

// False when another request took the slot after we acquired it.
export const setSlotJob = async (
  userId: string,
  lane: TTSLane,
  token: string,
  jobId: string,
): Promise<boolean> => {
  try {
    const { data, error } = await createSupabaseAdminClient().rpc('tts_set_slot_job', {
      p_user_id: userId,
      p_lane: lane,
      p_token: token,
      p_job_id: jobId,
    });
    if (error) throw error;
    return data !== false;
  } catch (error) {
    console.warn('TTS slot update failed, keeping the job:', error);
    return true;
  }
};

export const releaseSlot = async (userId: string, lane: TTSLane, token: string): Promise<void> => {
  try {
    const { error } = await createSupabaseAdminClient().rpc('tts_release_slot', {
      p_user_id: userId,
      p_lane: lane,
      p_token: token,
    });
    if (error) throw error;
  } catch (error) {
    // The slot expires on its own (SLOT_TTL_SECONDS).
    console.warn('TTS slot release failed:', error);
  }
};
