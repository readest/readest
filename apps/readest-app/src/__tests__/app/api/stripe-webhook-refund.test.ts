import { describe, it, expect, vi, beforeEach } from 'vitest';

// A refunded one-time Stripe purchase (Full Customization or a storage
// add-on) must lose its entitlement, the same way the App Store and Google
// Play refund notifications already revoke theirs.

const hooks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  markPaymentRefunded: vi.fn(),
  paymentRow: { user_id: 'user-1' } as { user_id: string } | null,
  lookupError: null as { message: string } | null,
}));

vi.mock('@/libs/payment/stripe/server', () => ({
  getStripe: () => ({ webhooks: { constructEvent: hooks.constructEvent } }),
  createOrUpdateSubscription: vi.fn(),
  createOrUpdatePayment: vi.fn(),
}));

vi.mock('@/libs/payment/iap/payments', () => ({
  markPaymentRefunded: (...args: unknown[]) => hooks.markPaymentRefunded(...args),
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'payments') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve(
                hooks.lookupError
                  ? { data: null, error: hooks.lookupError }
                  : { data: hooks.paymentRow, error: null },
              ),
          }),
        }),
      };
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

const refundEvent = (charge: Record<string, unknown>) => ({
  type: 'charge.refunded',
  data: { object: { id: 'ch_1', payment_intent: 'pi_1', refunded: true, ...charge } },
});

beforeEach(() => {
  hooks.constructEvent.mockReset();
  hooks.markPaymentRefunded.mockReset();
  hooks.paymentRow = { user_id: 'user-1' };
  hooks.lookupError = null;
  process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_dummy';
});

describe('POST /api/stripe/webhook — charge refunded', () => {
  it('revokes the one-time purchase on a full refund', async () => {
    hooks.constructEvent.mockReturnValue(refundEvent({}));

    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(hooks.markPaymentRefunded).toHaveBeenCalledWith(
      'user-1',
      'stripe_payment_intent_id',
      'pi_1',
    );
  });

  it('keeps the purchase on a partial refund', async () => {
    hooks.constructEvent.mockReturnValue(refundEvent({ refunded: false }));

    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(hooks.markPaymentRefunded).not.toHaveBeenCalled();
  });

  it('fails the webhook when the payment lookup errors, so Stripe retries', async () => {
    hooks.lookupError = { message: 'connection reset' };
    hooks.constructEvent.mockReturnValue(refundEvent({}));

    const res = await POST(makeReq());

    expect(res.status).toBe(500);
    expect(hooks.markPaymentRefunded).not.toHaveBeenCalled();
  });

  it('ignores refunds of charges with no payment row, such as subscription invoices', async () => {
    hooks.paymentRow = null;
    hooks.constructEvent.mockReturnValue(refundEvent({}));

    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(hooks.markPaymentRefunded).not.toHaveBeenCalled();
  });
});
