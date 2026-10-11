import { beforeEach, describe, expect, it, vi } from 'vitest';

const stub = { acquire: vi.fn(), setJob: vi.fn(), release: vi.fn() };
const namespace = { idFromName: vi.fn(() => 'global-id'), get: vi.fn(() => stub) };
let env: Record<string, unknown> = {};
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env }),
}));

import { acquireSlot, releaseSlot, setSlotJob } from '@/libs/readestVoice/admission';

const ADMITTED = { acquired: true, previousJobId: null, pendingChars: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  env = { TTS_DISPATCHER: namespace };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('acquireSlot', () => {
  it('asks the global dispatcher and returns its answer', async () => {
    stub.acquire.mockResolvedValueOnce({
      acquired: true,
      previousJobId: 'old-job',
      pendingChars: 7,
    });
    await expect(acquireSlot('u1', 'phone', 'listen', 'tok')).resolves.toEqual({
      acquired: true,
      previousJobId: 'old-job',
      pendingChars: 7,
    });
    expect(namespace.idFromName).toHaveBeenCalledWith('global');
    expect(stub.acquire).toHaveBeenCalledWith({
      userId: 'u1',
      clientId: 'phone',
      lane: 'listen',
      token: 'tok',
    });
  });

  it('reports a refused window', async () => {
    stub.acquire.mockResolvedValueOnce({ acquired: false, previousJobId: null });
    await expect(acquireSlot('u1', 'phone', 'download', 'tok')).resolves.toEqual({
      acquired: false,
      previousJobId: null,
    });
  });

  it('admits when the dispatcher fails or is not bound', async () => {
    stub.acquire.mockRejectedValueOnce(new Error('reset'));
    await expect(acquireSlot('u1', 'phone', 'listen', 'tok')).resolves.toEqual(ADMITTED);
    env = {};
    await expect(acquireSlot('u1', 'phone', 'listen', 'tok')).resolves.toEqual(ADMITTED);
  });
});

describe('setSlotJob', () => {
  it('records the job, false when the slot is gone', async () => {
    stub.setJob.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(setSlotJob('tok', 'job-1')).resolves.toBe(true);
    await expect(setSlotJob('tok', 'job-1')).resolves.toBe(false);
    expect(stub.setJob).toHaveBeenCalledWith('tok', 'job-1');
  });

  it('keeps the job when the dispatcher fails', async () => {
    stub.setJob.mockRejectedValueOnce(new Error('reset'));
    await expect(setSlotJob('tok', 'job-1')).resolves.toBe(true);
  });
});

describe('releaseSlot', () => {
  it('releases by token and swallows failures', async () => {
    stub.release.mockRejectedValueOnce(new Error('reset'));
    await expect(releaseSlot('tok')).resolves.toBeUndefined();
    expect(stub.release).toHaveBeenCalledWith('tok');
  });
});
