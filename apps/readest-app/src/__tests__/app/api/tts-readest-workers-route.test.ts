import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  trackUsage: vi.fn(),
  dispatcher: {
    leaseJob: vi.fn(),
    leasedJob: vi.fn(),
    heartbeat: vi.fn(),
    completeJob: vi.fn(),
  },
  bucket: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
  bound: true,
}));

vi.mock('@/libs/readestVoice/bindings', async (orig) => ({
  ...(await orig<typeof import('@/libs/readestVoice/bindings')>()),
  getDispatcher: () => (m.bound ? m.dispatcher : null),
  getResultBucket: () => (m.bound ? m.bucket : null),
}));
vi.mock('@/utils/usage', async (orig) => ({
  ...(await orig<typeof import('@/utils/usage')>()),
  UsageStatsManager: { trackUsage: m.trackUsage },
}));

import { POST } from '@/app/api/tts/readest/workers/route';

const JOB = {
  jobId: 'a'.repeat(32),
  lease: 'lease-1',
  lang: 'en-US',
  segments: [
    { id: 's0', text: 'Hello world.', voice: 'kokoro:af_heart' },
    { id: 's1', text: 'Bye.', voice: 'kokoro:af_heart' },
  ],
};
const B = [{ offset: 0, duration: 5_000_000, text: 'Hello' }];

const post = (body: unknown, token?: string) =>
  new NextRequest('https://web.readest.com/api/tts/readest/workers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  for (const fn of [m.trackUsage, ...Object.values(m.dispatcher), ...Object.values(m.bucket)]) {
    fn.mockReset();
  }
  m.bound = true;
  vi.stubEnv('READEST_VOICE_WORKER_TOKENS', 'gpu-box:secret-1,lab:secret-2');
  vi.stubEnv('READEST_VOICE_WORKER_VERSION', '2.3.0');
  m.bucket.put.mockResolvedValue(undefined);
  m.bucket.delete.mockResolvedValue(undefined);
  m.trackUsage.mockResolvedValue(0);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('lease', () => {
  const lease = { action: 'lease', engines: ['kokoro', 'omnivoice'], version: '2.3.0' };

  it('long-polls the dispatcher under the worker name its token maps to', async () => {
    m.dispatcher.leaseJob.mockResolvedValueOnce(JOB);
    const res = await POST(post(lease, 'secret-2'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(JOB);
    expect(m.dispatcher.leaseJob).toHaveBeenCalledWith(
      'lab',
      ['kokoro', 'omnivoice'],
      expect.any(Number),
    );
  });

  it('answers 204 when no job came', async () => {
    m.dispatcher.leaseJob.mockResolvedValueOnce(null);
    expect((await POST(post(lease, 'secret-1'))).status).toBe(204);
  });

  it('refuses unknown tokens and other worker versions', async () => {
    let res = await POST(post(lease, 'guess'));
    expect(res.status).toBe(401);
    res = await POST(post(lease));
    expect(res.status).toBe(401);
    res = await POST(post({ ...lease, version: '2.2.0' }, 'secret-1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'VERSION_MISMATCH' });
    expect(m.dispatcher.leaseJob).not.toHaveBeenCalled();
  });

  it('refuses every worker when no tokens are configured', async () => {
    vi.stubEnv('READEST_VOICE_WORKER_TOKENS', '');
    expect((await POST(post(lease, ''))).status).toBe(401);
  });

  it('400s on malformed engines', async () => {
    const res = await POST(post({ ...lease, engines: 'kokoro' }, 'secret-1'));
    expect(res.status).toBe(400);
  });
});

describe('lease holders', () => {
  it('fetch their window by lease alone (a bridged RunPod job)', async () => {
    m.dispatcher.leasedJob.mockResolvedValueOnce(JOB).mockResolvedValueOnce(null);
    let res = await POST(post({ action: 'job', lease: 'lease-1' }));
    expect(await res.json()).toEqual(JOB);
    res = await POST(post({ action: 'job', lease: 'lease-1' }));
    expect(res.status).toBe(410);
  });

  it('renew the lease and learn when to stop', async () => {
    m.dispatcher.heartbeat.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await (await POST(post({ action: 'heartbeat', lease: 'lease-1' }))).json()).toEqual({
      live: true,
    });
    expect(await (await POST(post({ action: 'heartbeat', lease: 'lease-1' }))).json()).toEqual({
      live: false,
    });
  });
});

describe('complete', () => {
  const frames = [
    { id: 's0', audio: 'AAA', boundaries: B },
    { id: 's1', failed: true },
  ];

  it('stores the result as the app reads it and charges what was delivered', async () => {
    m.dispatcher.leasedJob.mockResolvedValueOnce(JOB);
    m.dispatcher.completeJob.mockResolvedValueOnce({ userId: 'user-1', plan: 'pro' });
    const res = await POST(post({ action: 'complete', lease: 'lease-1', frames }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ charged: 12 });
    expect(m.bucket.put).toHaveBeenCalledWith(
      `tts-jobs/${JOB.jobId}`,
      [
        JSON.stringify({ id: 's0', audio: 'AAA', boundaries: B }),
        JSON.stringify({ id: 's1', error: 'synthesis failed' }),
        JSON.stringify({ done: true, charged: 12 }),
        '',
      ].join('\n'),
    );
    expect(m.trackUsage).toHaveBeenCalledWith('user-1', 'tts_chars', 12, {
      plan: 'pro',
      lane: 'download',
      segments: 2,
    });
  });

  it('drops the result of a lease that is no longer live', async () => {
    m.dispatcher.leasedJob.mockResolvedValueOnce(null);
    let res = await POST(post({ action: 'complete', lease: 'lease-1', frames }));
    expect(res.status).toBe(410);
    expect(m.bucket.put).not.toHaveBeenCalled();

    // Cancelled while the result uploaded.
    m.dispatcher.leasedJob.mockResolvedValueOnce(JOB);
    m.dispatcher.completeJob.mockResolvedValueOnce(null);
    res = await POST(post({ action: 'complete', lease: 'lease-1', frames }));
    expect(res.status).toBe(410);
    expect(m.bucket.delete).toHaveBeenCalledWith(`tts-jobs/${JOB.jobId}`);
    expect(m.trackUsage).not.toHaveBeenCalled();
  });
});

it('503s off Workers and 400s on unknown actions', async () => {
  expect((await POST(post({ action: 'dance' }))).status).toBe(400);
  m.bound = false;
  expect((await POST(post({ action: 'job', lease: 'x' }))).status).toBe(503);
});
