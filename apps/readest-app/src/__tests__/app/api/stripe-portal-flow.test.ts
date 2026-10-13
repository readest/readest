import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type Stripe from 'stripe';

// Switching an existing subscriber between monthly and yearly has to happen in
// the billing portal — a second checkout session would leave both
// subscriptions running. Deep-link straight to the plan-change screen when we
// can identify their live subscription.

const portalCreateMock = vi.fn();
const validateUserAndTokenMock = vi.fn();
const customerSingleMock = vi.fn();
const subscriptionsSelectMock = vi.fn();

vi.mock('@/libs/payment/stripe/server', () => ({
  getStripe: () => ({
    billingPortal: { sessions: { create: (...a: unknown[]) => portalCreateMock(...a) } },
  }),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'customers') {
        return { select: () => ({ eq: () => ({ single: () => customerSingleMock() }) }) };
      }
      return {
        select: () => ({
          eq: () => ({ in: () => ({ order: () => ({ limit: () => subscriptionsSelectMock() }) }) }),
        }),
      };
    },
  }),
}));

import { POST } from '@/app/api/stripe/portal/route';

const postReq = (body?: Record<string, unknown>) =>
  new NextRequest('https://web.readest.com/api/stripe/portal', {
    method: 'POST',
    headers: {
      authorization: 'Bearer tok',
      'content-type': 'application/json',
      origin: 'https://web.readest.com',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({
    user: { id: 'user-1', email: 'reader@example.com' },
    token: 'tok',
  });
  customerSingleMock.mockReset().mockResolvedValue({ data: { stripe_customer_id: 'cus_1' } });
  subscriptionsSelectMock
    .mockReset()
    .mockResolvedValue({ data: [{ stripe_subscription_id: 'sub_live' }] });
  portalCreateMock.mockReset().mockResolvedValue({ url: 'https://billing.stripe.com/session' });
});

describe('POST /api/stripe/portal', () => {
  it('deep-links to the plan-change screen when a switch was requested', async () => {
    const res = await POST(postReq({ flow: 'subscription_update' }));
    expect(res.status).toBe(200);

    const params = portalCreateMock.mock.calls[0]![0] as Stripe.BillingPortal.SessionCreateParams;
    expect(params.flow_data).toEqual({
      type: 'subscription_update',
      subscription_update: { subscription: 'sub_live' },
    });
  });

  it('opens the portal home when no flow is requested', async () => {
    await POST(postReq());

    const params = portalCreateMock.mock.calls[0]![0] as Stripe.BillingPortal.SessionCreateParams;
    expect(params.flow_data).toBeUndefined();
    expect(params.customer).toBe('cus_1');
  });

  it('falls back to the portal home when no live subscription is on file', async () => {
    subscriptionsSelectMock.mockResolvedValue({ data: [] });

    const res = await POST(postReq({ flow: 'subscription_update' }));
    expect(res.status).toBe(200);

    const params = portalCreateMock.mock.calls[0]![0] as Stripe.BillingPortal.SessionCreateParams;
    expect(params.flow_data).toBeUndefined();
  });

  it('still rejects an unauthenticated caller', async () => {
    validateUserAndTokenMock.mockResolvedValue({ user: null, token: null });

    const res = await POST(postReq({ flow: 'subscription_update' }));
    expect(res.status).toBe(403);
    expect(portalCreateMock).not.toHaveBeenCalled();
  });
});
