import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}));

import {
  acquireSlot,
  releaseSlot,
  setSlotJob,
  SLOT_TTL_SECONDS,
} from '@/libs/readestVoice/admission';

beforeEach(() => {
  rpcMock.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('acquireSlot', () => {
  it('calls tts_acquire_slot and maps the row', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ acquired: true, previous_job_id: 'old-job' }],
      error: null,
    });
    await expect(acquireSlot('u1', 'listen', 'tok')).resolves.toEqual({
      acquired: true,
      previousJobId: 'old-job',
    });
    expect(rpcMock).toHaveBeenCalledWith('tts_acquire_slot', {
      p_user_id: 'u1',
      p_lane: 'listen',
      p_token: 'tok',
      p_ttl_seconds: SLOT_TTL_SECONDS,
    });
  });

  it('reports a refused download', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ acquired: false, previous_job_id: null }],
      error: null,
    });
    await expect(acquireSlot('u1', 'download', 'tok')).resolves.toEqual({
      acquired: false,
      previousJobId: null,
    });
  });

  it('fails open on an RPC error or a throw', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await expect(acquireSlot('u1', 'download', 'tok')).resolves.toEqual({
      acquired: true,
      previousJobId: null,
    });
    rpcMock.mockRejectedValueOnce(new Error('network'));
    await expect(acquireSlot('u1', 'download', 'tok')).resolves.toEqual({
      acquired: true,
      previousJobId: null,
    });
  });
});

describe('setSlotJob', () => {
  it('returns whether this request still owns the slot', async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    await expect(setSlotJob('u1', 'listen', 'tok', 'job')).resolves.toBe(false);
    expect(rpcMock).toHaveBeenCalledWith('tts_set_slot_job', {
      p_user_id: 'u1',
      p_lane: 'listen',
      p_token: 'tok',
      p_job_id: 'job',
    });
  });

  it('fails open', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await expect(setSlotJob('u1', 'listen', 'tok', 'job')).resolves.toBe(true);
  });
});

describe('releaseSlot', () => {
  it('calls tts_release_slot and never throws', async () => {
    rpcMock.mockRejectedValueOnce(new Error('network'));
    await expect(releaseSlot('u1', 'download', 'tok')).resolves.toBeUndefined();
    expect(rpcMock).toHaveBeenCalledWith('tts_release_slot', {
      p_user_id: 'u1',
      p_lane: 'download',
      p_token: 'tok',
    });
  });
});
