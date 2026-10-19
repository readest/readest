import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const getCurrentUsageMock = vi.fn();
const trackUsageMock = vi.fn();

vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => {
    throw new Error('no cloudflare context');
  },
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn().mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' }),
  getSubscriptionPlan: () => 'free',
  getDailyTranslationPlanData: () => ({ quota: 1000 }),
}));
vi.mock('@/utils/usage', () => ({
  UsageStatsManager: {
    getCurrentUsage: (...a: unknown[]) => getCurrentUsageMock(...a),
    trackUsage: (...a: unknown[]) => trackUsageMock(...a),
  },
}));

import handler from '@/pages/api/deepl/translate';

const call = async (body: unknown) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer tok' }, body } as NextApiRequest,
    res as unknown as NextApiResponse,
  );
  return res;
};

const deeplResponse = () =>
  new Response(JSON.stringify({ translations: [{ text: 'ok' }] }), { status: 200 });

beforeEach(() => {
  getCurrentUsageMock.mockReset().mockResolvedValue(0);
  trackUsageMock.mockReset().mockResolvedValue(100);
});
afterEach(() => vi.unstubAllGlobals());

describe('DeepL translate request limits', () => {
  it.each([
    ['a string instead of an array', 'hello'],
    ['a missing text field', undefined],
    ['a non-string item', ['hello', 42]],
  ])('rejects %s without calling DeepL', async (_label, text) => {
    const fetchMock = vi.fn().mockResolvedValue(deeplResponse());
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ text, target_lang: 'EN' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a request with too many items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(deeplResponse());
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ text: Array.from({ length: 101 }, () => 'a'), target_lang: 'EN' });
    expect(res.status).toHaveBeenCalledWith(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a request with too many characters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(deeplResponse());
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ text: ['a'.repeat(50_001)], target_lang: 'EN' });
    expect(res.status).toHaveBeenCalledWith(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the whole request against the quota before any upstream call', async () => {
    // 10 x 200 chars: each item alone fits the 1000-char quota, the request does not.
    const fetchMock = vi.fn().mockResolvedValue(deeplResponse());
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ text: Array.from({ length: 10 }, () => 'a'.repeat(200)) });
    expect(res.status).toHaveBeenCalledWith(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(trackUsageMock).not.toHaveBeenCalled();
  });

  it('translates a request that fits the quota and records usage once', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => deeplResponse());
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ text: ['hello', '', 'world'], target_lang: 'EN' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(trackUsageMock).toHaveBeenCalledTimes(1);
    const { translations } = res.json.mock.calls[0]![0] as { translations: { text: string }[] };
    expect(translations.map((t) => t.text)).toEqual(['ok', '', 'ok']);
  });
});
