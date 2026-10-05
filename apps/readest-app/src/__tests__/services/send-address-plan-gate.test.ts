import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import { isEmailInPlan } from '@/utils/access';
import type { UserPlan } from '@/types/quota';

// Hoisted mocks — installed before importing the route handler.

const validateUserMock = vi.fn();
const getUserProfilePlanMock = vi.fn();
const getCustomizationPurchasedMock = vi.fn();
vi.mock('@/utils/access', async () => {
  // Reach the real module so `isEmailInPlan` keeps the production logic
  // (we test it directly below) while patching the two functions the
  // route actually calls.
  const actual = await vi.importActual<typeof import('@/utils/access')>('@/utils/access');
  return {
    ...actual,
    validateUserAndToken: (...args: unknown[]) => validateUserMock(...args),
    getUserProfilePlan: (...args: unknown[]) => getUserProfilePlanMock(...args),
    getCustomizationPurchased: (...args: unknown[]) => getCustomizationPurchasedMock(...args),
  };
});

vi.mock('@/utils/cors', () => ({
  corsAllMethods: vi.fn(),
  runMiddleware: vi.fn(async () => undefined),
}));

// Supabase admin client — must not be touched on the gate-blocked path;
// if any test calls into it the gate has leaked.
const supabaseTouched = vi.fn();

// Permissive chain proxy: every property access returns a callable that
// returns the same proxy; awaiting or calling a terminal returns
// `{ data: null, error: null }`. Sufficient for verifying the gate
// passes without modelling the full PostgREST builder.
const chainProxy = (): unknown => {
  const empty = { data: null, error: null };
  const handler: ProxyHandler<{ then?: unknown }> = {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      return (..._args: unknown[]) => {
        // Terminal methods return the empty result directly.
        if (prop === 'maybeSingle' || prop === 'single') return Promise.resolve(empty);
        return chainProxy();
      };
    },
  };
  return new Proxy({}, handler);
};

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => {
    supabaseTouched();
    return { from: () => chainProxy() };
  },
}));

const { default: addressHandler } = await import('@/pages/api/send/address');
const { default: sendersHandler } = await import('@/pages/api/send/senders');

interface MockRes {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  _status: number;
  _body: Record<string, unknown> | undefined;
}

function makeRes(): MockRes {
  const res: MockRes = { status: vi.fn(), json: vi.fn(), _status: 0, _body: undefined };
  res.status.mockImplementation((code: number) => {
    res._status = code;
    return res as unknown as NextApiResponse;
  });
  res.json.mockImplementation((body: Record<string, unknown>) => {
    res._body = body;
    return res as unknown as NextApiResponse;
  });
  return res;
}

function makeReq(method: 'GET' | 'POST', body?: unknown): NextApiRequest {
  return {
    method,
    headers: { authorization: 'Bearer testtoken' },
    body,
    query: {},
  } as unknown as NextApiRequest;
}

beforeEach(() => {
  validateUserMock.mockReset();
  getUserProfilePlanMock.mockReset();
  getCustomizationPurchasedMock.mockReset().mockReturnValue(false);
  supabaseTouched.mockReset();
  validateUserMock.mockResolvedValue({
    user: { id: 'user-1', email: 'u@example.com' },
    token: 'testtoken',
  });
});

describe('isEmailInPlan helper', () => {
  test('allows all plans including free', () => {
    expect(isEmailInPlan('free', false)).toBe(true);
    expect(isEmailInPlan('plus', false)).toBe(true);
    expect(isEmailInPlan('pro', false)).toBe(true);
    expect(isEmailInPlan('purchase', false)).toBe(true);
  });
});

describe('/api/send/address — plan gate (removed)', () => {
  test('free users pass the gate and access supabase', async () => {
    getUserProfilePlanMock.mockReturnValue('free' satisfies UserPlan);
    const res = makeRes();
    await addressHandler(makeReq('GET'), res as unknown as NextApiResponse);
    // No 403 — the gate is removed. Supabase is touched.
    expect(supabaseTouched).toHaveBeenCalled();
  });

  test.each<UserPlan>([
    'free',
    'plus',
    'pro',
    'purchase',
  ])('lets %s users through the gate', async (plan) => {
    getUserProfilePlanMock.mockReturnValue(plan);
    const res = makeRes();
    await addressHandler(makeReq('GET'), res as unknown as NextApiResponse);
    expect(supabaseTouched).toHaveBeenCalled();
    expect(res._status).not.toBe(403);
  });
});

describe('/api/send/senders — plan gate (removed)', () => {
  test('free users pass the gate and access supabase', async () => {
    getUserProfilePlanMock.mockReturnValue('free' satisfies UserPlan);
    const res = makeRes();
    await sendersHandler(makeReq('GET'), res as unknown as NextApiResponse);
    expect(supabaseTouched).toHaveBeenCalled();
    expect(res._status).not.toBe(403);
  });

  test('free users can add a sender on POST (no plan gate)', async () => {
    getUserProfilePlanMock.mockReturnValue('free' satisfies UserPlan);
    const res = makeRes();
    await sendersHandler(
      makeReq('POST', { email: 'friend@example.com' }),
      res as unknown as NextApiResponse,
    );

    expect(res._status).not.toBe(403);
    expect(supabaseTouched).toHaveBeenCalled();
  });

  test.each<UserPlan>([
    'free',
    'plus',
    'pro',
    'purchase',
  ])('lets %s users through the gate', async (plan) => {
    getUserProfilePlanMock.mockReturnValue(plan);
    const res = makeRes();
    await sendersHandler(makeReq('GET'), res as unknown as NextApiResponse);
    expect(supabaseTouched).toHaveBeenCalled();
    expect(res._status).not.toBe(403);
  });
});
