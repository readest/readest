import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  validateUserAndToken: vi.fn(),
  getSubscriptionPlan: vi.fn(),
  getCatalog: vi.fn(),
  getVoiceService: vi.fn(),
  service: { warmup: vi.fn() },
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

import { GET, POST } from '@/app/api/tts/readest/route';

const CATALOG = [
  { id: 'kokoro:af_heart', engine: 'kokoro', name: 'Heart', langs: ['en-US'] },
  { id: 'qwen3:serena', engine: 'qwen3', name: 'Serena', langs: ['en-US', 'de-DE'] },
  { id: 'omnivoice:clara', engine: 'omnivoice', name: 'Clara', langs: ['en-US'] },
];

const req = (method: 'GET' | 'POST', body?: unknown, query = '') =>
  new NextRequest(`https://web.readest.com/api/tts/readest${query}`, {
    method,
    headers: { authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  for (const fn of [
    m.validateUserAndToken,
    m.getSubscriptionPlan,
    m.getCatalog,
    m.getVoiceService,
    m.service.warmup,
  ]) {
    fn.mockReset();
  }
  m.validateUserAndToken.mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' });
  m.getSubscriptionPlan.mockReturnValue('pro');
  m.getCatalog.mockResolvedValue(CATALOG);
  m.getVoiceService.mockResolvedValue(m.service);
  m.service.warmup.mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('GET /api/tts/readest', () => {
  it('403s when unauthenticated', async () => {
    m.validateUserAndToken.mockResolvedValue({});
    const res = await GET(req('GET'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'NOT_AUTHENTICATED' });
  });

  it('lists without checking the voice service, which is always on', async () => {
    m.getVoiceService.mockResolvedValue(null);
    expect((await GET(req('GET'))).status).toBe(200);
    expect(m.getVoiceService).not.toHaveBeenCalled();
  });

  it('503s CATALOG_UNAVAILABLE when the catalog cannot be read', async () => {
    m.getCatalog.mockResolvedValueOnce(null);
    expect(await (await GET(req('GET'))).json()).toEqual({ error: 'CATALOG_UNAVAILABLE' });
  });

  it.each(['free', 'purchase'])('403s PLAN_REQUIRED for %s', async (plan) => {
    m.getSubscriptionPlan.mockReturnValue(plan);
    expect(await (await GET(req('GET'))).json()).toEqual({ error: 'PLAN_REQUIRED' });
  });

  it('lists Kokoro for Plus, Kokoro and OmniVoice for Pro', async () => {
    m.getSubscriptionPlan.mockReturnValue('plus');
    expect(await (await GET(req('GET'))).json()).toEqual({
      voices: [{ id: 'kokoro:af_heart', name: 'Heart', lang: 'en-US', tier: 'plus' }],
    });
    m.getSubscriptionPlan.mockReturnValue('pro');
    expect(await (await GET(req('GET'))).json()).toEqual({
      voices: [
        { id: 'kokoro:af_heart', name: 'Heart', lang: 'en-US', tier: 'plus' },
        { id: 'omnivoice:clara', name: 'Clara', lang: 'en-US', tier: 'pro' },
      ],
    });
  });
});

describe('GET /api/tts/readest?all=1', () => {
  it('lists every offered voice with its plan, signed in or not', async () => {
    m.validateUserAndToken.mockResolvedValue({});
    m.getSubscriptionPlan.mockReturnValue('free');
    const res = await GET(req('GET', undefined, '?all=1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      voices: [
        { id: 'kokoro:af_heart', name: 'Heart', lang: 'en-US', tier: 'plus' },
        { id: 'omnivoice:clara', name: 'Clara', lang: 'en-US', tier: 'pro' },
      ],
    });
  });

  it('lists without checking the voice service, which is always on', async () => {
    m.getVoiceService.mockResolvedValue(null);
    expect((await GET(req('GET', undefined, '?all=1'))).status).toBe(200);
    expect(m.getVoiceService).not.toHaveBeenCalled();
  });

  it('503s CATALOG_UNAVAILABLE when the catalog cannot be read', async () => {
    m.getCatalog.mockResolvedValueOnce(null);
    expect(await (await GET(req('GET', undefined, '?all=1'))).json()).toEqual({
      error: 'CATALOG_UNAVAILABLE',
    });
  });
});

describe('POST /api/tts/readest', () => {
  it('asks the service to warm a GPU worker', async () => {
    const res = await POST(req('POST', { warmup: true }));
    expect(await res.json()).toEqual({ ok: true });
    expect(m.service.warmup).toHaveBeenCalled();
  });

  it('stays best-effort when the service cannot warm up', async () => {
    m.service.warmup.mockRejectedValueOnce(new Error('unreachable'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await POST(req('POST', { warmup: true }));
    expect(await res.json()).toEqual({ ok: true });
  });

  it('accepts a plain value, as the next dev platform proxy answers RPC calls', async () => {
    m.service.warmup.mockReturnValueOnce(undefined);
    const res = await POST(req('POST', { warmup: true }));
    expect(await res.json()).toEqual({ ok: true });
  });

  it('is gated like GET', async () => {
    m.getSubscriptionPlan.mockReturnValue('free');
    expect((await POST(req('POST', { warmup: true }))).status).toBe(403);
    expect(m.service.warmup).not.toHaveBeenCalled();
  });

  it('400s on anything but a warmup', async () => {
    const res = await POST(req('POST', { input: 'Hello' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'INVALID_INPUT' });
  });
});
