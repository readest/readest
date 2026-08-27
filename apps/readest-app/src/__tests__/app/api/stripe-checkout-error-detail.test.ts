import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Stripe from 'stripe';

// Keep Stripe's stable diagnostic fields without leaking raw backend errors to
// the client (and onward to client-side error telemetry).

const createMock = vi.fn();
const customersCreateMock = vi.fn();
const validateUserAndTokenMock = vi.fn();
const singleMock = vi.fn();

vi.mock('@/libs/payment/stripe/server', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: (...a: unknown[]) => createMock(...a) } },
    customers: { create: (...a: unknown[]) => customersCreateMock(...a) },
  }),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: () => singleMock() }) }),
      insert: () => Promise.resolve({ error: null }),
    }),
  }),
}));

import { POST } from '@/app/api/stripe/checkout/route';

const postReq = () =>
  new NextRequest('https://web.readest.com/api/stripe/checkout', {
    method: 'POST',
    headers: {
      authorization: 'Bearer caller',
      'content-type': 'application/json',
      origin: 'http://tauri.localhost',
    },
    body: JSON.stringify({
      priceId: 'price_1SM42IENgv2E9LPDjWb0A3wC',
      planType: 'purchase',
      embedded: true,
    }),
  });

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({
    user: { id: 'caller-id', email: 'caller@example.com' },
    token: 'tok',
  });
  singleMock.mockReset().mockResolvedValue({ data: { stripe_customer_id: 'cus_stale' } });
  createMock.mockReset();
  customersCreateMock.mockReset();
});

describe('POST /api/stripe/checkout — error detail', () => {
  it('returns sanitized Stripe diagnostics when session creation is rejected', async () => {
    createMock.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: "No such customer: 'cus_stale'",
        type: 'invalid_request_error',
        code: 'resource_missing',
        param: 'customer',
      }),
    );

    const res = await POST(postReq());
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body).toEqual({
      error: 'Error creating checkout session',
      message: 'Stripe rejected the checkout request',
      code: 'resource_missing',
      param: 'customer',
    });
    expect(JSON.stringify(body)).not.toContain('cus_stale');
  });

  it('does not expose non-Stripe error details', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('supabaseKey is required.'), {
        code: 'resource_missing',
        param: 'customer',
      }),
    );

    const res = await POST(postReq());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Error creating checkout session' });
  });

  it.each([null, undefined])('handles a %s rejection without throwing', async (error) => {
    createMock.mockRejectedValue(error);

    const res = await POST(postReq());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Error creating checkout session' });
  });

  it('returns the session on success', async () => {
    createMock.mockResolvedValue({
      id: 'cs_test_1',
      url: null,
      client_secret: 'cs_test_1_secret',
    });

    const res = await POST(postReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sessionId: 'cs_test_1',
      clientSecret: 'cs_test_1_secret',
    });
  });
});
