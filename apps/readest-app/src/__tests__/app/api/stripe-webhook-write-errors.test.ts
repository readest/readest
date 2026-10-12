import { describe, it, expect, vi, beforeEach } from 'vitest';

// supabase-js returns `{ error }` instead of throwing, and the webhook used to
// ignore the result of every `.update()`. A failed DB write therefore still
// returned 200, so Stripe never retried and the user's billing state silently
// diverged (paid user stuck "free", or a cancelled user stuck "active"). The
// fix checks each write result and throws so the handler answers 500 and Stripe
// retries the event.

const hooks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  // Per-table update results, settable per test.
  subscriptionsUpdate: { error: null } as { error: { message: string } | null },
  plansUpdate: { error: null } as { error: { message: string } | null },
}));

vi.mock('@/libs/payment/stripe/server', () => ({
  getStripe: () => ({ webhooks: { constructEvent: hooks.constructEvent } }),
  createOrUpdateSubscription: vi.fn(),
  createOrUpdatePayment: vi.fn(),
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'customers') {
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: { user_id: 'user-1' } }) }),
          }),
        };
      }
      if (table === 'subscriptions') {
        return { update: () => ({ eq: () => Promise.resolve(hooks.subscriptionsUpdate) }) };
      }
      if (table === 'plans') {
        return { update: () => ({ eq: () => Promise.resolve(hooks.plansUpdate) }) };
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
  hooks.subscriptionsUpdate = { error: null };
  hooks.plansUpdate = { error: null };
  process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_dummy';
  hooks.constructEvent.mockReturnValue({
    type: 'invoice.payment_failed',
    data: {
      object: {
        customer: 'cus_1',
        parent: { subscription_details: { subscription: 'sub_1' } },
      },
    },
  });
});

describe('POST /api/stripe/webhook — write-error propagation', () => {
  it('returns 500 when the plans update fails so Stripe retries', async () => {
    hooks.plansUpdate = { error: { message: 'db down' } };

    const res = await POST(makeReq());

    expect(res.status).toBe(500);
  });

  it('returns 500 when the subscriptions update fails', async () => {
    hooks.subscriptionsUpdate = { error: { message: 'db down' } };

    const res = await POST(makeReq());

    expect(res.status).toBe(500);
  });

  it('returns 200 when all writes succeed', async () => {
    const res = await POST(makeReq());

    expect(res.status).toBe(200);
  });
});
