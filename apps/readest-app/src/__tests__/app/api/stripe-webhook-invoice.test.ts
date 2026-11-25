// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Invoice events re-read the subscription from Stripe through the same path as
// customer.subscription.updated. The live endpoint sends `invoice.paid` (not
// `invoice.payment_succeeded`) at API version 2024-11-20.acacia, where an
// invoice names its subscription in `subscription`; from 2025-03-31.basil it
// is `parent.subscription_details.subscription`.

const hooks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  createOrUpdateSubscription: vi.fn(),
  storedSubscription: { user_id: 'user-1', stripe_customer_id: 'cus_1' } as unknown,
  writes: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

vi.mock('@/libs/payment/stripe/server', () => ({
  getStripe: () => ({ webhooks: { constructEvent: hooks.constructEvent } }),
  createOrUpdateSubscription: (...args: unknown[]) => hooks.createOrUpdateSubscription(...args),
  createOrUpdatePayment: vi.fn(),
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const write = (values: Record<string, unknown>) => {
        hooks.writes.push({ table, values });
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      };
      return {
        update: write,
        insert: write,
        upsert: write,
        select: () => ({
          eq: () => ({ single: () => Promise.resolve({ data: hooks.storedSubscription }) }),
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

const sendInvoiceEvent = (type: string, invoice: Record<string, unknown>) => {
  hooks.constructEvent.mockReturnValue({
    type,
    data: { object: { id: 'in_1', customer: 'cus_1', ...invoice } },
  });
  return POST(makeReq());
};

const acacia = { subscription: 'sub_1' };
const basil = { parent: { subscription_details: { subscription: 'sub_1' } } };

beforeEach(() => {
  hooks.constructEvent.mockReset();
  hooks.createOrUpdateSubscription.mockReset();
  hooks.storedSubscription = { user_id: 'user-1', stripe_customer_id: 'cus_1' };
  hooks.writes = [];
  process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_dummy';
});

describe('POST /api/stripe/webhook — invoice events', () => {
  it.each([
    ['invoice.paid', 'acacia', acacia],
    ['invoice.paid', 'basil', basil],
    ['invoice.payment_failed', 'acacia', acacia],
    ['invoice.payment_failed', 'basil', basil],
  ])('%s (%s payload) re-reads the stored subscription from Stripe', async (type, _v, invoice) => {
    const res = await sendInvoiceEvent(type, invoice);

    expect(res.status).toBe(200);
    expect(hooks.createOrUpdateSubscription).toHaveBeenCalledWith('user-1', 'cus_1', 'sub_1');
    // Stripe's own status is written by the re-read, never a guessed one.
    expect(hooks.writes).toEqual([]);
  });

  it('writes nothing when the subscription is not stored yet', async () => {
    // The first invoice can arrive before checkout.session.completed stores
    // the subscription; that event creates the row, so this one must not.
    hooks.storedSubscription = null;

    const res = await sendInvoiceEvent('invoice.paid', acacia);

    expect(res.status).toBe(200);
    expect(hooks.createOrUpdateSubscription).not.toHaveBeenCalled();
    expect(hooks.writes).toEqual([]);
  });

  it('ignores an invoice that belongs to no subscription', async () => {
    const res = await sendInvoiceEvent('invoice.paid', {});

    expect(res.status).toBe(200);
    expect(hooks.createOrUpdateSubscription).not.toHaveBeenCalled();
    expect(hooks.writes).toEqual([]);
  });
});
