import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  validateUserAndToken: vi.fn(),
  getSubscriptionPlan: vi.fn(),
  getCatalog: vi.fn(),
  getRunPodConfig: vi.fn(),
  getCurrentUsage: vi.fn(),
  dispatcher: {
    submitJob: vi.fn(),
    waitJob: vi.fn(),
    cancelJob: vi.fn(),
    forgetJob: vi.fn(),
  },
  bucket: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
  bound: true,
}));

vi.mock('@/utils/access', async (orig) => ({
  ...(await orig<typeof import('@/utils/access')>()),
  validateUserAndToken: m.validateUserAndToken,
  getSubscriptionPlan: m.getSubscriptionPlan,
}));
vi.mock('@/libs/readestVoice/catalog', async (orig) => ({
  ...(await orig<typeof import('@/libs/readestVoice/catalog')>()),
  getCatalog: m.getCatalog,
}));
vi.mock('@/libs/readestVoice/runpod', () => ({ getRunPodConfig: m.getRunPodConfig }));
vi.mock('@/libs/readestVoice/bindings', async (orig) => ({
  ...(await orig<typeof import('@/libs/readestVoice/bindings')>()),
  getDispatcher: () => (m.bound ? m.dispatcher : null),
  getResultBucket: () => (m.bound ? m.bucket : null),
}));
vi.mock('@/utils/usage', async (orig) => ({
  ...(await orig<typeof import('@/utils/usage')>()),
  UsageStatsManager: { getCurrentUsage: m.getCurrentUsage },
}));

import { POST } from '@/app/api/tts/readest/jobs/route';
import { DELETE, GET } from '@/app/api/tts/readest/jobs/[id]/route';

const CATALOG = [
  { id: 'kokoro:af_heart', engine: 'kokoro', name: 'Heart', langs: ['en-US'] },
  { id: 'omnivoice:clara', engine: 'omnivoice', name: 'Clara', langs: ['en-US'] },
];
const JOB_ID = 'a'.repeat(32);

const seg = (id: string, text = 'Hello world.', voice = 'kokoro:af_heart') => ({ id, text, voice });
const download = (...segments: ReturnType<typeof seg>[]) => ({
  client: 'phone',
  lane: 'download',
  lang: 'en-US',
  segments,
});

const request = (method: string, path: string, body?: unknown) =>
  new NextRequest(`https://web.readest.com/api/tts/readest/jobs${path}`, {
    method,
    headers: { authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id = JOB_ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const fn of [
    m.validateUserAndToken,
    m.getSubscriptionPlan,
    m.getCatalog,
    m.getRunPodConfig,
    m.getCurrentUsage,
    ...Object.values(m.dispatcher),
    ...Object.values(m.bucket),
  ]) {
    fn.mockReset();
  }
  m.bound = true;
  m.validateUserAndToken.mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' });
  m.getSubscriptionPlan.mockReturnValue('pro');
  m.getCatalog.mockResolvedValue(CATALOG);
  m.getRunPodConfig.mockReturnValue({ apiKey: 'k', endpointId: 'ep', base: 'https://rp.test' });
  m.getCurrentUsage.mockResolvedValue(1_000);
  m.dispatcher.submitJob.mockResolvedValue({ ok: true, state: 'queued' });
  m.dispatcher.forgetJob.mockResolvedValue(undefined);
  m.bucket.delete.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('POST /jobs', () => {
  it('queues the window with its engines and the quota left, under a stable id', async () => {
    const body = download(seg('s0'), seg('s1', 'Hi there.', 'omnivoice:clara'));
    const res = await POST(request('POST', '', body));
    expect(res.status).toBe(200);
    const { jobId, state } = await res.json();
    expect(jobId).toMatch(/^[0-9a-f]{32}$/);
    expect(state).toBe('queued');
    expect(m.dispatcher.submitJob).toHaveBeenCalledWith({
      id: jobId,
      userId: 'user-1',
      plan: 'pro',
      lang: 'en-US',
      segments: body.segments,
      engines: ['kokoro', 'omnivoice'],
      quotaLeft: 300 * 1024 - 1_000,
    });

    // The same window gets the same id.
    const again = await POST(request('POST', '', body));
    expect((await again.json()).jobId).toBe(jobId);
  });

  it('keeps only the validated segment fields', async () => {
    const padded = { ...seg('s0'), notes: 'x'.repeat(100_000) };
    await POST(request('POST', '', { ...download(), segments: [padded] }));
    expect(m.dispatcher.submitJob).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [seg('s0')] }),
    );
  });

  it('refuses listen windows and plan-locked voices', async () => {
    let res = await POST(request('POST', '', { ...download(seg('s0')), lane: 'listen' }));
    expect(res.status).toBe(400);
    m.getSubscriptionPlan.mockReturnValue('plus');
    res = await POST(request('POST', '', download(seg('s0', 'Hi.', 'omnivoice:clara'))));
    expect(res.status).toBe(403);
    expect(m.dispatcher.submitJob).not.toHaveBeenCalled();
  });

  it('passes on BUSY with a retry hint and a spent quota', async () => {
    m.dispatcher.submitJob.mockResolvedValueOnce({ ok: false, error: 'BUSY' });
    let res = await POST(request('POST', '', download(seg('s0'))));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('5');
    expect(await res.json()).toEqual({ error: 'BUSY' });
    m.dispatcher.submitJob.mockResolvedValueOnce({ ok: false, error: 'DAILY_QUOTA_EXCEEDED' });
    res = await POST(request('POST', '', download(seg('s0'))));
    expect(await res.json()).toEqual({ error: 'DAILY_QUOTA_EXCEEDED' });
  });

  it('says jobs are unavailable off Workers or when the dispatcher fails', async () => {
    m.bound = false;
    let res = await POST(request('POST', '', download(seg('s0'))));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'JOBS_UNAVAILABLE' });
    m.bound = true;
    m.dispatcher.submitJob.mockRejectedValueOnce(new Error('reset'));
    res = await POST(request('POST', '', download(seg('s0'))));
    expect(await res.json()).toEqual({ error: 'JOBS_UNAVAILABLE' });
  });
});

describe('GET /jobs/:id', () => {
  it('answers 202 while the job runs', async () => {
    m.dispatcher.waitJob.mockResolvedValueOnce('leased');
    const res = await GET(request('GET', `/${JOB_ID}`), params());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ state: 'leased' });
    expect(m.dispatcher.waitJob).toHaveBeenCalledWith(JOB_ID, 'user-1', expect.any(Number));
  });

  it('hands over the result once, then drops it', async () => {
    m.dispatcher.waitJob.mockResolvedValueOnce('done');
    const result = '{"id":"s0","audio":"AAA","boundaries":[]}\n{"done":true,"charged":12}\n';
    m.bucket.get.mockResolvedValueOnce({ text: () => Promise.resolve(result) });
    const res = await GET(request('GET', `/${JOB_ID}`), params());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');
    expect(await res.text()).toBe(result);
    expect(m.bucket.get).toHaveBeenCalledWith(`tts-jobs/${JOB_ID}`);
    expect(m.bucket.delete).toHaveBeenCalledWith(`tts-jobs/${JOB_ID}`);
    expect(m.dispatcher.forgetJob).toHaveBeenCalledWith(JOB_ID, 'user-1');
  });

  it.each([
    [null, 404, 'NOT_FOUND'],
    ['failed', 502, 'UPSTREAM_FAILED'],
    ['cancelled', 409, 'CANCELLED'],
  ])('maps a %s job to %i', async (state, status, error) => {
    m.dispatcher.waitJob.mockResolvedValueOnce(state);
    const res = await GET(request('GET', `/${JOB_ID}`), params());
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it('treats a done job whose result is gone as not found', async () => {
    m.dispatcher.waitJob.mockResolvedValueOnce('done');
    m.bucket.get.mockResolvedValueOnce(null);
    const res = await GET(request('GET', `/${JOB_ID}`), params());
    expect(res.status).toBe(404);
    expect(m.dispatcher.forgetJob).toHaveBeenCalledWith(JOB_ID, 'user-1');
  });

  it('400s on a malformed id', async () => {
    const res = await GET(request('GET', '/nope'), params('nope'));
    expect(res.status).toBe(400);
    expect(m.dispatcher.waitJob).not.toHaveBeenCalled();
  });
});

describe('DELETE /jobs/:id', () => {
  it('cancels the job and drops anything it left', async () => {
    m.dispatcher.cancelJob.mockResolvedValueOnce(true);
    const res = await DELETE(request('DELETE', `/${JOB_ID}`), params());
    expect(res.status).toBe(204);
    expect(m.dispatcher.cancelJob).toHaveBeenCalledWith(JOB_ID, 'user-1');
    expect(m.dispatcher.forgetJob).toHaveBeenCalledWith(JOB_ID, 'user-1');
    expect(m.bucket.delete).toHaveBeenCalledWith(`tts-jobs/${JOB_ID}`);
  });
});
