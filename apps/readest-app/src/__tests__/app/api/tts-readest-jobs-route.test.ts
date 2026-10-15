import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  validateUserAndToken: vi.fn(),
  getSubscriptionPlan: vi.fn(),
  getCatalog: vi.fn(),
  getVoiceService: vi.fn(),
  getCurrentUsage: vi.fn(),
  trackUsage: vi.fn(),
  service: {
    submitJob: vi.fn(),
    waitJob: vi.fn(),
    takeResult: vi.fn(),
    cancelJob: vi.fn(),
  },
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
vi.mock('@/libs/readestVoice/service', async (orig) => ({
  ...(await orig<typeof import('@/libs/readestVoice/service')>()),
  getVoiceService: m.getVoiceService,
}));
vi.mock('@/utils/usage', async (orig) => ({
  ...(await orig<typeof import('@/utils/usage')>()),
  UsageStatsManager: { getCurrentUsage: m.getCurrentUsage, trackUsage: m.trackUsage },
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
    m.getVoiceService,
    m.getCurrentUsage,
    m.trackUsage,
    ...Object.values(m.service),
  ]) {
    fn.mockReset();
  }
  m.validateUserAndToken.mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' });
  m.getSubscriptionPlan.mockReturnValue('pro');
  m.getCatalog.mockResolvedValue(CATALOG);
  m.getVoiceService.mockResolvedValue(m.service);
  m.getCurrentUsage.mockResolvedValue(1_000);
  m.trackUsage.mockResolvedValue(0);
  m.service.submitJob.mockResolvedValue({ ok: true, jobId: JOB_ID, state: 'queued' });
  m.service.cancelJob.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('POST /jobs', () => {
  it('queues the window with its engines and the quota left', async () => {
    const body = download(seg('s0'), seg('s1', 'Hi there.', 'omnivoice:clara'));
    const res = await POST(request('POST', '', body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobId: JOB_ID, state: 'queued' });
    expect(m.service.submitJob).toHaveBeenCalledWith({
      userId: 'user-1',
      lang: 'en-US',
      segments: body.segments,
      engines: ['kokoro', 'omnivoice'],
      quotaLeft: 1_000_000 - 1_000,
    });
  });

  it('keeps only the validated segment fields', async () => {
    const padded = { ...seg('s0'), notes: 'x'.repeat(100_000) };
    await POST(request('POST', '', { ...download(), segments: [padded] }));
    expect(m.service.submitJob).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [seg('s0')] }),
    );
  });

  it('refuses listen windows and plan-locked voices', async () => {
    let res = await POST(request('POST', '', { ...download(seg('s0')), lane: 'listen' }));
    expect(res.status).toBe(400);
    m.getSubscriptionPlan.mockReturnValue('plus');
    res = await POST(request('POST', '', download(seg('s0', 'Hi.', 'omnivoice:clara'))));
    expect(res.status).toBe(403);
    expect(m.service.submitJob).not.toHaveBeenCalled();
  });

  it('passes on BUSY with a retry hint and a spent quota', async () => {
    m.service.submitJob.mockResolvedValueOnce({ ok: false, error: 'BUSY' });
    let res = await POST(request('POST', '', download(seg('s0'))));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('5');
    expect(await res.json()).toEqual({ error: 'BUSY' });
    m.service.submitJob.mockResolvedValueOnce({ ok: false, error: 'DAILY_QUOTA_EXCEEDED' });
    res = await POST(request('POST', '', download(seg('s0'))));
    expect(await res.json()).toEqual({ error: 'DAILY_QUOTA_EXCEEDED' });
  });

  it('says jobs are unavailable when the service call fails (the app then streams)', async () => {
    m.service.submitJob.mockRejectedValueOnce(new Error('reset'));
    const res = await POST(request('POST', '', download(seg('s0'))));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'JOBS_UNAVAILABLE' });
  });

  it('is unavailable without the service', async () => {
    m.getVoiceService.mockResolvedValueOnce(null);
    expect((await POST(request('POST', '', download(seg('s0'))))).status).toBe(503);
  });
});

describe('GET /jobs/:id', () => {
  it('answers 202 while the job runs', async () => {
    m.service.waitJob.mockResolvedValueOnce('leased');
    const res = await GET(request('GET', `/${JOB_ID}`), params());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ state: 'leased' });
    expect(m.service.waitJob).toHaveBeenCalledWith(JOB_ID, 'user-1', expect.any(Number));
  });

  it('hands over the result once and charges what it delivered', async () => {
    m.service.waitJob.mockResolvedValueOnce('done');
    const result =
      '{"id":"s0","audio":"AAA","boundaries":[]}\n{"id":"s1","error":"synthesis failed"}\n{"done":true,"charged":12}\n';
    m.service.takeResult.mockResolvedValueOnce({ body: result, charged: 12 });
    const res = await GET(request('GET', `/${JOB_ID}`), params());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');
    expect(await res.text()).toBe(result);
    expect(m.service.takeResult).toHaveBeenCalledWith(JOB_ID, 'user-1');
    await vi.waitFor(() =>
      expect(m.trackUsage).toHaveBeenCalledWith('user-1', 'tts_chars', 12, {
        plan: 'pro',
        lane: 'download',
        segments: 2,
      }),
    );
  });

  it('charges nothing for a result that delivered nothing', async () => {
    m.service.waitJob.mockResolvedValueOnce('done');
    m.service.takeResult.mockResolvedValueOnce({ body: '{"done":true,"charged":0}\n', charged: 0 });
    expect((await GET(request('GET', `/${JOB_ID}`), params())).status).toBe(200);
    expect(m.trackUsage).not.toHaveBeenCalled();
  });

  it.each([
    [null, 404, 'NOT_FOUND'],
    ['failed', 502, 'UPSTREAM_FAILED'],
    ['cancelled', 409, 'CANCELLED'],
  ])('maps a %s job to %i', async (state, status, error) => {
    m.service.waitJob.mockResolvedValueOnce(state);
    const res = await GET(request('GET', `/${JOB_ID}`), params());
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it('treats a done job whose result is gone as not found', async () => {
    m.service.waitJob.mockResolvedValueOnce('done');
    m.service.takeResult.mockResolvedValueOnce(null);
    const res = await GET(request('GET', `/${JOB_ID}`), params());
    expect(res.status).toBe(404);
    expect(m.trackUsage).not.toHaveBeenCalled();
  });

  it('says jobs are unavailable when the service call fails', async () => {
    m.service.waitJob.mockRejectedValueOnce(new Error('reset'));
    let res = await GET(request('GET', `/${JOB_ID}`), params());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'JOBS_UNAVAILABLE' });
    m.service.waitJob.mockResolvedValueOnce('done');
    m.service.takeResult.mockRejectedValueOnce(new Error('reset'));
    res = await GET(request('GET', `/${JOB_ID}`), params());
    expect(res.status).toBe(503);
  });

  it('400s on a malformed id', async () => {
    const res = await GET(request('GET', '/nope'), params('nope'));
    expect(res.status).toBe(400);
    expect(m.service.waitJob).not.toHaveBeenCalled();
  });
});

describe('DELETE /jobs/:id', () => {
  it('says jobs are unavailable when the service call fails', async () => {
    m.service.cancelJob.mockRejectedValueOnce(new Error('reset'));
    const res = await DELETE(request('DELETE', `/${JOB_ID}`), params());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'JOBS_UNAVAILABLE' });
  });

  it('cancels the job in the service', async () => {
    const res = await DELETE(request('DELETE', `/${JOB_ID}`), params());
    expect(res.status).toBe(204);
    expect(m.service.cancelJob).toHaveBeenCalledWith(JOB_ID, 'user-1');
  });
});
