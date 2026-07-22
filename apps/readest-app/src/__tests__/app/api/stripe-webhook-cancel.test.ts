import { describe, it, expect, vi, beforeEach } from 'vitest';

// When a subscription is cancelled, the user may still hold other active
// subscriptions (e.g. cancelling the leftover Plus subscription after an
// upgrade to Pro). The webhook used to drop the account to `free`
// unconditionally. It must instead reflect the highest plan that remains
// active.

const hooks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  getHighestActivePlan: vi.fn(),
  planUpdates: [] as Array<Record<string, unknown>>,
  subscriptionData: { user_id: 'user-1', stripe_customer_id: 'cus_1' } as unknown,
}));

vi.mock('@/libs/payment/stripe/server', () => ({
  getStripe: () => ({ webhooks: { constructEvent: hooks.constructEvent } }),
  createOrUpdateSubscription: vi.fn(),
  createOrUpdatePayment: vi.fn(),
  getHighestActivePlan: (...args: unknown[]) => hooks.getHighestActivePlan(...args),
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'plans') {
        return {
          update: (values: Record<string, unknown>) => ({
            eq: () => {
              hooks.planUpdates.push(values);
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table === 'subscriptions') {
        return {
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: hooks.subscriptionData }) }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { POST } from '@/app/api/stripe/webhook/route';

const makeReq = () =>
  new Request('https://web.readest.com/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
    body: '{}',
  }) as unknown as Parameters<typeof POST>[0];

beforeEach(() => {
  hooks.constructEvent.mockReset();
  hooks.getHighestActivePlan.mockReset();
  hooks.planUpdates = [];
  hooks.subscriptionData = { user_id: 'user-1', stripe_customer_id: 'cus_1' };
  process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_dummy';
  hooks.constructEvent.mockReturnValue({
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_plus', customer: 'cus_1' } },
  });
});

describe('POST /api/stripe/webhook — subscription cancelled', () => {
  it('keeps the highest remaining active plan when another subscription is still active', async () => {
    hooks.getHighestActivePlan.mockResolvedValue('pro');

    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(hooks.getHighestActivePlan).toHaveBeenCalledWith(expect.anything(), 'cus_1');
    expect(hooks.planUpdates.at(-1)).toEqual({ plan: 'pro', status: 'active' });
  });

  it('drops to free + cancelled when no subscription remains active', async () => {
    hooks.getHighestActivePlan.mockResolvedValue('free');

    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(hooks.planUpdates.at(-1)).toEqual({ plan: 'free', status: 'cancelled' });
  });
});
