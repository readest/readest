import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stripe keeps a refunded PaymentIntent at `succeeded`; the refund lives on
// the charge. `/api/stripe/check` and a late `checkout.session.completed`
// re-run `createOrUpdatePayment` for the same session, so copying the intent
// status would flip a refunded row back to `succeeded` and restore the
// entitlement.

const hooks = vi.hoisted(() => ({
  sessionsRetrieve: vi.fn(),
  upserts: [] as Array<Record<string, unknown>>,
  updateUserStorage: vi.fn(),
}));

vi.mock('stripe', () => {
  function MockStripe() {
    return { checkout: { sessions: { retrieve: hooks.sessionsRetrieve } } };
  }
  MockStripe.createFetchHttpClient = () => ({});
  return { default: MockStripe };
});

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'payments') throw new Error(`unexpected table: ${table}`);
      return {
        upsert: (values: Record<string, unknown>) => {
          hooks.upserts.push(values);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  }),
}));

vi.mock('@/libs/payment/storage', () => ({
  updateUserStorage: (...args: unknown[]) => hooks.updateUserStorage(...args),
}));

import { createOrUpdatePayment } from '@/libs/payment/stripe/server';

const session = (refunded: boolean) => ({
  payment_intent: {
    id: 'pi_1',
    amount: 1999,
    currency: 'usd',
    status: 'succeeded',
    payment_method: 'pm_1',
    latest_charge: { id: 'ch_1', refunded },
  },
  line_items: {
    data: [{ price: { product: { id: 'prod_1', metadata: { feature: 'customization' } } } }],
  },
});

beforeEach(() => {
  hooks.sessionsRetrieve.mockReset();
  hooks.updateUserStorage.mockReset();
  hooks.upserts = [];
  process.env['STRIPE_SECRET_KEY'] = 'sk_test_dummy';
});

describe('createOrUpdatePayment — refund state', () => {
  it('records a fully refunded charge as refunded', async () => {
    hooks.sessionsRetrieve.mockResolvedValue(session(true));

    await createOrUpdatePayment('user-1', 'cus_1', 'cs_1');

    expect(hooks.upserts.at(-1)?.['status']).toBe('refunded');
    expect(hooks.updateUserStorage).toHaveBeenCalledWith('user-1');
  });

  it('records a paid charge with the intent status', async () => {
    hooks.sessionsRetrieve.mockResolvedValue(session(false));

    await createOrUpdatePayment('user-1', 'cus_1', 'cs_1');

    expect(hooks.upserts.at(-1)?.['status']).toBe('succeeded');
  });
});
