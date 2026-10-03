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
  test('allows plus, pro, and lifetime (purchase)', () => {
    expect(isEmailInPlan('plus', false)).toBe(true);
    expect(isEmailInPlan('pro', false)).toBe(true);
    expect(isEmailInPlan('purchase', false)).toBe(false);
  });

  test('blocks the free tier', () => {
    expect(isEmailInPlan('free', false)).toBe(false);
  });
});

describe('/api/send/address — plan gate', () => {
  test('returns 403 with code=plan_required for free users on GET (lazy-create blocked)', async () => {
    getUserProfilePlanMock.mockReturnValue('free' satisfies UserPlan);
    const res = makeRes();
    await addressHandler(makeReq('GET'), res as unknown as NextApiResponse);

    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({
      code: 'plan_required',
      plan: 'free',
      requiredPlans: ['plus', 'pro', 'purchase'],
    });
    // Critically: no Supabase access on the gate-blocked path. A free
    // user must never get a row allocated in `send_addresses`.
    expect(supabaseTouched).not.toHaveBeenCalled();
  });

  test('returns 403 for free users on POST (rotation blocked)', async () => {
    getUserProfilePlanMock.mockReturnValue('free' satisfies UserPlan);
    const res = makeRes();
    await addressHandler(makeReq('POST', { slug: 'myname' }), res as unknown as NextApiResponse);

    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({ code: 'plan_required' });
    expect(supabaseTouched).not.toHaveBeenCalled();
  });

  test.each<UserPlan>(['plus', 'pro'])('lets %s users through the gate', async (plan) => {
    getUserProfilePlanMock.mockReturnValue(plan);
    const res = makeRes();
    await addressHandler(makeReq('GET'), res as unknown as NextApiResponse);
    // The gate is past — Supabase was touched. We don't care here what
    // the eventual response is (the Supabase mock returns no row).
    expect(supabaseTouched).toHaveBeenCalled();
    expect(res._status).not.toBe(403);
  });
});

describe('/api/send/senders — plan gate', () => {
  test('returns 403 for free users on GET (list blocked)', async () => {
    getUserProfilePlanMock.mockReturnValue('free' satisfies UserPlan);
    const res = makeRes();
    await sendersHandler(makeReq('GET'), res as unknown as NextApiResponse);

    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({ code: 'plan_required' });
    expect(supabaseTouched).not.toHaveBeenCalled();
  });

  test('returns 403 for free users on POST (add sender blocked)', async () => {
    getUserProfilePlanMock.mockReturnValue('free' satisfies UserPlan);
    const res = makeRes();
    await sendersHandler(
      makeReq('POST', { email: 'friend@example.com' }),
      res as unknown as NextApiResponse,
    );

    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({ code: 'plan_required' });
    expect(supabaseTouched).not.toHaveBeenCalled();
  });

  test.each<UserPlan>(['plus', 'pro'])('lets %s users past the gate', async (plan) => {
    getUserProfilePlanMock.mockReturnValue(plan);
    const res = makeRes();
    await sendersHandler(makeReq('GET'), res as unknown as NextApiResponse);
    expect(supabaseTouched).toHaveBeenCalled();
    expect(res._status).not.toBe(403);
  });

  // `purchase` means "holds some one-time purchase", which is how a
  // storage-only buyer presents. Entitlement now rides on the customization
  // claim, so the plan alone is not enough.
  test('refuses a storage-only buyer reporting the purchase plan', async () => {
    getUserProfilePlanMock.mockReturnValue('purchase' satisfies UserPlan);
    getCustomizationPurchasedMock.mockReturnValue(false);
    const res = makeRes();
    await sendersHandler(makeReq('GET'), res as unknown as NextApiResponse);
    expect(res._status).toBe(403);
    expect(supabaseTouched).not.toHaveBeenCalled();
  });

  test('lets a grandfathered buyer through on the customization claim', async () => {
    getUserProfilePlanMock.mockReturnValue('purchase' satisfies UserPlan);
    getCustomizationPurchasedMock.mockReturnValue(true);
    const res = makeRes();
    await sendersHandler(makeReq('GET'), res as unknown as NextApiResponse);
    expect(supabaseTouched).toHaveBeenCalled();
    expect(res._status).not.toBe(403);
  });

  test('lets a free user who bought Full Customization through', async () => {
    getUserProfilePlanMock.mockReturnValue('free' satisfies UserPlan);
    getCustomizationPurchasedMock.mockReturnValue(true);
    const res = makeRes();
    await sendersHandler(makeReq('GET'), res as unknown as NextApiResponse);
    expect(supabaseTouched).toHaveBeenCalled();
    expect(res._status).not.toBe(403);
  });
});
