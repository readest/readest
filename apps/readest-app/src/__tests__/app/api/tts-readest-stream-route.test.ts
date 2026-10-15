import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readNDJSON } from '@/utils/ndjson';

const m = vi.hoisted(() => ({
  validateUserAndToken: vi.fn(),
  getSubscriptionPlan: vi.fn(),
  getCatalog: vi.fn(),
  getVoiceService: vi.fn(),
  service: { admitWindow: vi.fn(), streamWindow: vi.fn(), releaseWindow: vi.fn() },
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
vi.mock('@/libs/readestVoice/service', async (orig) => ({
  ...(await orig<typeof import('@/libs/readestVoice/service')>()),
  getVoiceService: m.getVoiceService,
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

// The service's NDJSON stream; with `hang` it stays open until cancelled.
const serviceStream = (items: unknown[], hang = false) => {
  const cancel = vi.fn();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const item of items) controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`));
      if (!hang) controller.close();
    },
    cancel,
  });
  return { stream, cancel };
};

const streams = (items: unknown[], hang = false) => {
  const { stream, cancel } = serviceStream(items, hang);
  m.service.streamWindow.mockResolvedValue({ ok: true, stream });
  return cancel;
};

const flush = () => new Promise((r) => setTimeout(r, 0));

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
  m.getSubscriptionPlan.mockReturnValue('plus');
  m.getCatalog.mockResolvedValue(CATALOG);
  m.getVoiceService.mockResolvedValue(m.service);
  m.service.admitWindow.mockResolvedValue({ acquired: true, pendingChars: 0 });
  m.service.releaseWindow.mockResolvedValue(undefined);
  streams([{ id: 's0', audio: 'AAA', boundaries: B }, { done: true }]);
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

  it('503s without the Readest Voice service (kill switch) or when the catalog is down', async () => {
    m.getVoiceService.mockResolvedValueOnce(null);
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
    expect(m.service.admitWindow).not.toHaveBeenCalled();
  });

  it('rejects Qwen3 voices for Pro too', async () => {
    m.getSubscriptionPlan.mockReturnValue('pro');
    const res = await POST(post(listen(seg('s0', 'Hi.', 'qwen3:ryan'))));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'VOICE_TIER_REQUIRED' });
    expect(m.service.admitWindow).not.toHaveBeenCalled();
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
  it('counts the uncharged download jobs of the user against the quota', async () => {
    m.getCurrentUsage.mockResolvedValue(250_000);
    m.service.admitWindow.mockResolvedValue({ acquired: true, pendingChars: 250_000 });
    const res = await POST(post(listen(seg('s0', 'a'.repeat(200)))));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'DAILY_QUOTA_EXCEEDED' });
    expect(m.service.streamWindow).not.toHaveBeenCalled();
  });

  it('429s when the window would exceed the daily quota, and gives the slot back', async () => {
    m.getCurrentUsage.mockResolvedValue(500_000 - 100);
    const res = await POST(post(listen(seg('s0', 'a'.repeat(200)))));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'DAILY_QUOTA_EXCEEDED' });
    expect(m.service.streamWindow).not.toHaveBeenCalled();
    const token = m.service.admitWindow.mock.calls[0]![0].token;
    expect(m.service.releaseWindow).toHaveBeenCalledWith(token);
  });

  it('checks the quota and takes the slot at the same time', async () => {
    let resolveUsage!: (used: number) => void;
    m.getCurrentUsage.mockReturnValue(new Promise<number>((r) => (resolveUsage = r)));
    const pending = POST(post(listen(seg('s0'))));
    await flush();
    expect(m.service.admitWindow).toHaveBeenCalled();
    resolveUsage(0);
    await lines(await pending);
  });

  it('queues as the client the request names, or as one shared client for older apps', async () => {
    await lines(await POST(post({ ...listen(seg('s0')), client: 'phone' })));
    expect(m.service.admitWindow).toHaveBeenLastCalledWith({
      token: expect.any(String),
      userId: 'user-1',
      clientId: 'phone',
      lane: 'listen',
    });
    streams([{ done: true }]);
    await lines(await POST(post(listen(seg('s0')))));
    expect(m.service.admitWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ clientId: 'default' }),
    );
    const res = await POST(post({ ...listen(seg('s0')), client: 'x'.repeat(65) }));
    expect(res.status).toBe(400);
  });

  it('withdraws a waiting window when the client goes away', async () => {
    let admit!: (result: { acquired: boolean; pendingChars: number }) => void;
    m.service.admitWindow.mockReturnValue(new Promise((r) => (admit = r)));
    const controller = new AbortController();
    const pending = POST(post(listen(seg('s0')), controller.signal));
    await flush();
    controller.abort();
    const token = m.service.admitWindow.mock.calls[0]![0].token;
    expect(m.service.releaseWindow).toHaveBeenCalledWith(token);
    // Admitted in the same moment: the window must not start anyway.
    admit({ acquired: true, pendingChars: 0 });
    await pending;
    expect(m.service.streamWindow).not.toHaveBeenCalled();
    expect(m.service.releaseWindow).toHaveBeenLastCalledWith(token);
  });

  it('429s BUSY with Retry-After when the window waited too long or was refused', async () => {
    m.service.admitWindow.mockResolvedValue({ acquired: false, pendingChars: 0 });
    const res = await POST(post({ lane: 'download', lang: 'en', segments: [seg('s0')] }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('5');
    expect(await res.json()).toEqual({ error: 'BUSY' });
    expect(m.service.streamWindow).not.toHaveBeenCalled();
  });

  it('502s when the window cannot start, 503s when the service is switched off', async () => {
    m.service.streamWindow.mockResolvedValueOnce({ ok: false, error: 'UPSTREAM_FAILED' });
    let res = await POST(post(listen(seg('s0'))));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'UPSTREAM_FAILED' });
    m.service.streamWindow.mockResolvedValueOnce({ ok: false, error: 'NOT_CONFIGURED' });
    res = await POST(post(listen(seg('s0'))));
    expect(res.status).toBe(503);
    expect(m.trackUsage).not.toHaveBeenCalled();
  });

  it('502s when the service cannot be reached, giving the slot back', async () => {
    m.service.admitWindow.mockRejectedValueOnce(new Error('unreachable'));
    expect((await POST(post(listen(seg('s0'))))).status).toBe(502);
    m.service.streamWindow.mockRejectedValueOnce(new Error('unreachable'));
    expect((await POST(post(listen(seg('s0'))))).status).toBe(502);
    expect(m.service.releaseWindow).toHaveBeenCalled();
  });
});

describe('streaming', () => {
  it('leaves a window that ended on its own to the service', async () => {
    await lines(await POST(post(listen(seg('s0')))));
    expect(m.service.releaseWindow).not.toHaveBeenCalled();
  });

  it('relays the lines and charges delivered sentences once', async () => {
    streams([
      { id: 's0', audio: 'AAA', boundaries: B },
      { id: 's1', error: 'synthesis failed' },
      { id: 's2', audio: 'BBB', boundaries: B },
      { done: true },
    ]);
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
    const token = m.service.admitWindow.mock.calls[0]![0].token;
    expect(m.service.streamWindow).toHaveBeenCalledWith(token, {
      lang: 'en-US',
      segments: [seg('s0', 'Hello.'), seg('s1', 'Bad one.'), seg('s2', 'Third!!')],
    });
    expect(m.trackUsage).toHaveBeenCalledTimes(1);
    expect(m.trackUsage).toHaveBeenCalledWith('user-1', 'tts_chars', 13, {
      plan: 'plus',
      lane: 'listen',
      segments: 3,
    });
  });

  it('charges only what was delivered when the window fails mid-way', async () => {
    streams([
      { id: 's0', audio: 'AAA', boundaries: B },
      { done: true, error: 'UPSTREAM_FAILED' },
    ]);
    const res = await POST(post(listen(seg('s0', 'Hello.'), seg('s1', 'World.'))));
    expect(await lines(res)).toEqual([
      { id: 's0', audio: 'AAA', boundaries: B },
      { done: true, charged: 6, error: 'UPSTREAM_FAILED' },
    ]);
    expect(m.trackUsage).toHaveBeenCalledWith('user-1', 'tts_chars', 6, expect.any(Object));
  });

  it('does not charge a window that delivered nothing', async () => {
    streams([{ done: true, error: 'CANCELLED' }]);
    const res = await POST(post(listen(seg('s0'))));
    expect(await lines(res)).toEqual([{ done: true, charged: 0, error: 'CANCELLED' }]);
    expect(m.trackUsage).not.toHaveBeenCalled();
  });

  it('ends with UPSTREAM_FAILED when the service stream breaks or stops early', async () => {
    const encoder = new TextEncoder();
    let pulls = 0;
    // One line, then the stream breaks on the next read.
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) {
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ id: 's0', audio: 'AAA', boundaries: B })}\n`),
          );
        } else {
          controller.error(new Error('RPC stream broke'));
        }
      },
    });
    m.service.streamWindow.mockResolvedValueOnce({ ok: true, stream: broken });
    expect(await lines(await POST(post(listen(seg('s0', 'Hello.'), seg('s1')))))).toEqual([
      { id: 's0', audio: 'AAA', boundaries: B },
      { done: true, charged: 6, error: 'UPSTREAM_FAILED' },
    ]);
    streams([{ id: 's0', audio: 'AAA', boundaries: B }]);
    expect((await lines(await POST(post(listen(seg('s0', 'Hello.')))))).at(-1)).toEqual({
      done: true,
      charged: 6,
      error: 'UPSTREAM_FAILED',
    });
    // Both windows were given up, so both were ended in the service.
    expect(m.service.releaseWindow).toHaveBeenCalledTimes(2);
  });

  it('still closes the stream when charging fails (fail open)', async () => {
    m.trackUsage.mockRejectedValue(new Error('db down'));
    const res = await POST(post(listen(seg('s0'))));
    expect((await lines(res)).at(-1)).toEqual({ done: true, charged: 12 });
  });

  it('on client disconnect: stops the service stream and charges delivered only', async () => {
    const cancel = streams([{ id: 's0', audio: 'AAA', boundaries: B }], true);
    const client = new AbortController();
    const res = await POST(post(listen(seg('s0', 'Hello.'), seg('s1')), client.signal));
    const reader = readNDJSON(res.body!);
    expect((await reader.next()).value).toEqual({ id: 's0', audio: 'AAA', boundaries: B });
    client.abort();
    await reader.return(undefined);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    // Stopped explicitly too: a cancel across the binding may not arrive.
    const token = m.service.admitWindow.mock.calls[0]![0].token;
    await vi.waitFor(() => expect(m.service.releaseWindow).toHaveBeenCalledWith(token));
    await vi.waitFor(() => expect(m.trackUsage).toHaveBeenCalledTimes(1));
    expect(m.trackUsage).toHaveBeenCalledWith('user-1', 'tts_chars', 6, expect.any(Object));
  });
});
