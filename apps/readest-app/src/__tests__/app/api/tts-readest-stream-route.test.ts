import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { StreamEvent } from '@/libs/readestVoice/runpod';
import { readNDJSON } from '@/utils/ndjson';

const m = vi.hoisted(() => ({
  validateUserAndToken: vi.fn(),
  getSubscriptionPlan: vi.fn(),
  getCatalog: vi.fn(),
  getRunPodConfig: vi.fn(),
  startJob: vi.fn(),
  streamJob: vi.fn(),
  cancelJob: vi.fn(),
  acquireSlot: vi.fn(),
  setSlotJob: vi.fn(),
  releaseSlot: vi.fn(),
  getCurrentUsage: vi.fn(),
  trackUsage: vi.fn(),
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
vi.mock('@/libs/readestVoice/runpod', () => ({
  getRunPodConfig: m.getRunPodConfig,
  startJob: m.startJob,
  streamJob: m.streamJob,
  cancelJob: m.cancelJob,
}));
vi.mock('@/libs/readestVoice/admission', async (orig) => ({
  ...(await orig<typeof import('@/libs/readestVoice/admission')>()),
  acquireSlot: m.acquireSlot,
  setSlotJob: m.setSlotJob,
  releaseSlot: m.releaseSlot,
}));
vi.mock('@/utils/usage', async (orig) => {
  const actual = await orig<typeof import('@/utils/usage')>();
  return {
    ...actual,
    UsageStatsManager: { getCurrentUsage: m.getCurrentUsage, trackUsage: m.trackUsage },
  };
});

import { POST } from '@/app/api/tts/readest/stream/route';

const CATALOG = [
  { id: 'kokoro:af_heart', engine: 'kokoro', name: 'Heart', langs: ['en-US'] },
  { id: 'qwen3:ryan', engine: 'qwen3', name: 'Ryan', langs: ['en-US'] },
  { id: 'omnivoice:clara', engine: 'omnivoice', name: 'Clara', langs: ['en-US'] },
];
const CFG = { apiKey: 'k', endpointId: 'ep', base: 'https://rp.test/v2' };
const B = [{ offset: 0, duration: 5_000_000, text: 'Hello' }];

const seg = (id: string, text = 'Hello world.', voice = 'kokoro:af_heart') => ({ id, text, voice });

const post = (body: unknown, signal?: AbortSignal) =>
  new NextRequest('https://web.readest.com/api/tts/readest/stream', {
    method: 'POST',
    headers: { authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

const listen = (...segments: ReturnType<typeof seg>[]) => ({
  lane: 'listen',
  lang: 'en-US',
  segments,
});

const lines = async (res: Response) => {
  const out: Record<string, unknown>[] = [];
  for await (const line of readNDJSON(res.body!)) out.push(line as Record<string, unknown>);
  return out;
};

// streamJob stand-in: yields the given events, then (if `hang`) waits for the
// abort signal like a long-poll that never gets more frames.
const fakeStream = (events: StreamEvent[], hang = false) =>
  async function* (_cfg: unknown, _job: string, signal: AbortSignal) {
    for (const e of events) yield e;
    if (hang) {
      await new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
    }
  };

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.validateUserAndToken.mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' });
  m.getSubscriptionPlan.mockReturnValue('plus');
  m.getCatalog.mockResolvedValue(CATALOG);
  m.getRunPodConfig.mockReturnValue(CFG);
  m.startJob.mockResolvedValue('job-1');
  m.streamJob.mockImplementation(
    fakeStream([{ output: { id: 's0', audio: 'AAA', boundaries: B } }, { status: 'COMPLETED' }]),
  );
  m.cancelJob.mockResolvedValue(undefined);
  m.acquireSlot.mockResolvedValue({ acquired: true, previousJobId: null });
  m.setSlotJob.mockResolvedValue(true);
  m.releaseSlot.mockResolvedValue(undefined);
  m.getCurrentUsage.mockResolvedValue(0);
  m.trackUsage.mockResolvedValue(0);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('gating', () => {
  it('403s when unauthenticated', async () => {
    m.validateUserAndToken.mockResolvedValue({});
    const res = await POST(post(listen(seg('s0'))));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'NOT_AUTHENTICATED' });
  });

  it('503s when RunPod is unconfigured (kill switch) or the catalog is down', async () => {
    m.getRunPodConfig.mockReturnValueOnce(null);
    expect((await POST(post(listen(seg('s0'))))).status).toBe(503);
    m.getCatalog.mockResolvedValueOnce(null);
    const res = await POST(post(listen(seg('s0'))));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'NOT_CONFIGURED' });
  });

  it.each(['free', 'purchase'])('403s PLAN_REQUIRED for %s', async (plan) => {
    m.getSubscriptionPlan.mockReturnValue(plan);
    const res = await POST(post(listen(seg('s0'))));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'PLAN_REQUIRED' });
  });

  it('rejects a Pro voice for Plus and an unknown voice', async () => {
    let res = await POST(post(listen(seg('s0', 'Hi.', 'omnivoice:clara'))));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'VOICE_TIER_REQUIRED' });
    res = await POST(post(listen(seg('s0', 'Hi.', 'kokoro:nope'))));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'UNKNOWN_VOICE' });
    expect(m.startJob).not.toHaveBeenCalled();
  });

  it('rejects Qwen3 voices for Pro too', async () => {
    m.getSubscriptionPlan.mockReturnValue('pro');
    const res = await POST(post(listen(seg('s0', 'Hi.', 'qwen3:ryan'))));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'VOICE_TIER_REQUIRED' });
    expect(m.startJob).not.toHaveBeenCalled();
  });
});

describe('window validation', () => {
  it.each([
    ['9 listen segments', listen(...Array.from({ length: 9 }, (_, i) => seg(`s${i}`)))],
    ['2,001-char segment', listen(seg('s0', 'a'.repeat(2001)))],
    ['listen over 2,000 chars', listen(seg('s0', 'a'.repeat(1500)), seg('s1', 'a'.repeat(600)))],
    ['duplicate ids', listen(seg('s0'), seg('s0'))],
    ['empty text', listen(seg('s0', '  '))],
    ['no segments', listen()],
    ['bad lane', { lane: 'bulk', lang: 'en', segments: [seg('s0')] }],
  ])('400s on %s', async (_name, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'INVALID_INPUT' });
  });

  it('accepts 64 download segments', async () => {
    const body = {
      lane: 'download',
      lang: 'en-US',
      segments: Array.from({ length: 64 }, (_, i) => seg(`s${i}`, 'Hi.')),
    };
    expect((await POST(post(body))).status).toBe(200);
  });
});

describe('quota and admission', () => {
  it('429s when the window would exceed the daily quota, before starting a job', async () => {
    m.getCurrentUsage.mockResolvedValue(100 * 1024 - 100);
    const res = await POST(post(listen(seg('s0', 'a'.repeat(200)))));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'DAILY_QUOTA_EXCEEDED' });
    expect(m.startJob).not.toHaveBeenCalled();
    // The slot was taken alongside the quota check: give it back.
    expect(m.releaseSlot).toHaveBeenCalledWith(expect.any(String));
  });

  it('checks the quota and takes the slot at the same time', async () => {
    let resolveUsage!: (used: number) => void;
    m.getCurrentUsage.mockReturnValue(new Promise<number>((r) => (resolveUsage = r)));
    const pending = POST(post(listen(seg('s0'))));
    await flush();
    expect(m.acquireSlot).toHaveBeenCalled();
    resolveUsage(0);
    await lines(await pending);
  });

  it('queues as the client the request names, or as one shared client for older apps', async () => {
    await lines(await POST(post({ ...listen(seg('s0')), client: 'phone' })));
    expect(m.acquireSlot).toHaveBeenLastCalledWith('user-1', 'phone', 'listen', expect.any(String));
    await lines(await POST(post(listen(seg('s0')))));
    expect(m.acquireSlot).toHaveBeenLastCalledWith(
      'user-1',
      'default',
      'listen',
      expect.any(String),
    );
    const res = await POST(post({ ...listen(seg('s0')), client: 'x'.repeat(65) }));
    expect(res.status).toBe(400);
  });

  it('withdraws a waiting window when the client goes away', async () => {
    let admit!: (result: { acquired: boolean; previousJobId: null }) => void;
    m.acquireSlot.mockReturnValue(new Promise((r) => (admit = r)));
    const controller = new AbortController();
    const pending = POST(post(listen(seg('s0')), controller.signal));
    await flush();
    controller.abort();
    const token = m.acquireSlot.mock.calls[0]![3];
    expect(m.releaseSlot).toHaveBeenCalledWith(token);
    // Admitted in the same moment: the window must not start anyway.
    admit({ acquired: true, previousJobId: null });
    await pending;
    expect(m.startJob).not.toHaveBeenCalled();
    expect(m.releaseSlot).toHaveBeenLastCalledWith(token);
  });

  it('429s BUSY with Retry-After when the window waited too long or was refused', async () => {
    m.acquireSlot.mockResolvedValue({ acquired: false, previousJobId: null });
    const res = await POST(post({ lane: 'download', lang: 'en', segments: [seg('s0')] }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('5');
    expect(await res.json()).toEqual({ error: 'BUSY' });
    expect(m.startJob).not.toHaveBeenCalled();
  });

  it('cancels the superseded listen job without waiting on it', async () => {
    m.acquireSlot.mockResolvedValue({ acquired: true, previousJobId: 'old-job' });
    m.cancelJob.mockReturnValue(new Promise(() => {}));
    const res = await POST(post(listen(seg('s0'))));
    await lines(res);
    expect(m.cancelJob).toHaveBeenCalledWith(CFG, 'old-job');
    expect(m.startJob).toHaveBeenCalled();
  });

  it('streams without waiting for the job id to be recorded on the slot', async () => {
    m.setSlotJob.mockReturnValue(new Promise(() => {}));
    const res = await POST(post(listen(seg('s0'))));
    expect(await lines(res)).toEqual([
      { id: 's0', audio: 'AAA', boundaries: B },
      { done: true, charged: 'Hello world.'.length },
    ]);
  });

  it('cancels its own job when it turns out to have lost the slot race', async () => {
    m.setSlotJob.mockResolvedValue(false);
    m.streamJob.mockImplementation(fakeStream([], true));
    const res = await POST(post(listen(seg('s0'))));
    expect(await lines(res)).toEqual([{ done: true, charged: 0 }]);
    expect(m.cancelJob).toHaveBeenCalledWith(CFG, 'job-1');
  });

  it('502s and frees the slot when the job cannot start', async () => {
    m.startJob.mockRejectedValue(new Error('RunPod run failed: 500'));
    const res = await POST(post(listen(seg('s0'))));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'UPSTREAM_FAILED' });
    expect(m.releaseSlot).toHaveBeenCalled();
  });
});

describe('streaming', () => {
  it('streams ordered lines and charges delivered segments once', async () => {
    m.streamJob.mockImplementation(
      fakeStream([
        { output: { id: 's0', audio: 'AAA', boundaries: B } },
        { output: { id: 's1', failed: true } },
        { output: { id: 's2', audio: 'BBB', boundaries: B } },
        { status: 'COMPLETED' },
      ]),
    );
    const res = await POST(
      post(listen(seg('s0', 'Hello.'), seg('s1', 'Bad one.'), seg('s2', 'Third!!'))),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');
    expect(await lines(res)).toEqual([
      { id: 's0', audio: 'AAA', boundaries: B },
      { id: 's1', error: 'synthesis failed' },
      { id: 's2', audio: 'BBB', boundaries: B },
      { done: true, charged: 13 },
    ]);
    expect(m.startJob).toHaveBeenCalledWith(CFG, {
      lang: 'en-US',
      segments: [seg('s0', 'Hello.'), seg('s1', 'Bad one.'), seg('s2', 'Third!!')],
    });
    expect(m.trackUsage).toHaveBeenCalledTimes(1);
    expect(m.trackUsage).toHaveBeenCalledWith('user-1', 'tts_chars', 13, {
      plan: 'plus',
      lane: 'listen',
      segments: 3,
    });
    expect(m.releaseSlot).toHaveBeenCalledWith(expect.any(String));
  });

  it('charges only what was delivered when the job fails mid-window', async () => {
    m.streamJob.mockImplementation(
      fakeStream([
        { output: { id: 's0', audio: 'AAA', boundaries: B } },
        { status: 'FAILED', error: 'synthesis failed' },
      ]),
    );
    const res = await POST(post(listen(seg('s0', 'Hello.'), seg('s1', 'World.'))));
    expect(await lines(res)).toEqual([
      { id: 's0', audio: 'AAA', boundaries: B },
      { done: true, charged: 6, error: 'UPSTREAM_FAILED' },
    ]);
    expect(m.trackUsage).toHaveBeenCalledWith('user-1', 'tts_chars', 6, expect.any(Object));
  });

  it('does not charge a window that delivered nothing', async () => {
    m.streamJob.mockImplementation(fakeStream([{ status: 'CANCELLED' }]));
    const res = await POST(post(listen(seg('s0'))));
    expect(await lines(res)).toEqual([{ done: true, charged: 0, error: 'CANCELLED' }]);
    expect(m.trackUsage).not.toHaveBeenCalled();
  });

  it('ignores frames for ids outside the window', async () => {
    m.streamJob.mockImplementation(
      fakeStream([{ output: { id: 'zz', audio: 'X', boundaries: [] } }, { status: 'COMPLETED' }]),
    );
    expect(await lines(await POST(post(listen(seg('s0')))))).toEqual([{ done: true, charged: 0 }]);
  });

  it('turns a polling error into a terminal line and cancels the job', async () => {
    m.streamJob.mockImplementation(async function* () {
      yield { output: { id: 's0', audio: 'AAA', boundaries: B } };
      throw new Error('RunPod stream failed: 502');
    });
    const res = await POST(post(listen(seg('s0', 'Hello.'), seg('s1'))));
    expect(await lines(res)).toEqual([
      { id: 's0', audio: 'AAA', boundaries: B },
      { done: true, charged: 6, error: 'UPSTREAM_FAILED' },
    ]);
    expect(m.cancelJob).toHaveBeenCalledWith(CFG, 'job-1');
  });

  it('still closes the stream when charging fails (fail open)', async () => {
    m.trackUsage.mockRejectedValue(new Error('db down'));
    const res = await POST(post(listen(seg('s0'))));
    expect((await lines(res)).at(-1)).toEqual({ done: true, charged: 12 });
  });

  it('on client disconnect: cancels the job, charges delivered only, frees the slot', async () => {
    m.streamJob.mockImplementation(
      fakeStream([{ output: { id: 's0', audio: 'AAA', boundaries: B } }], true),
    );
    const client = new AbortController();
    const res = await POST(post(listen(seg('s0', 'Hello.'), seg('s1')), client.signal));
    const reader = readNDJSON(res.body!);
    expect((await reader.next()).value).toEqual({ id: 's0', audio: 'AAA', boundaries: B });
    client.abort();
    await reader.return(undefined);
    await vi.waitFor(() => expect(m.releaseSlot).toHaveBeenCalled());
    await flush();
    expect(m.cancelJob).toHaveBeenCalledWith(CFG, 'job-1');
    expect(m.trackUsage).toHaveBeenCalledTimes(1);
    expect(m.trackUsage).toHaveBeenCalledWith('user-1', 'tts_chars', 6, expect.any(Object));
  });
});
