import { describe, it, expect, vi, beforeEach } from 'vitest';

// `plans.plan` is written by the Stripe webhooks AND by the Google/Apple IAP
// handlers. Each one used to look only at its own provider, so whichever
// provider transitioned last won: cancelling a card subscription wiped the plan
// of a user who had migrated to Google Play (and vice versa, when the store
// subscription later expired). A paying Pro user was dropped to `free` — 500 MB
// of storage — until some unrelated event happened to rewrite the row.
//
// The plan written must reflect the highest plan the user is entitled to across
// EVERY billing provider, regardless of which one fired the event.

const stripeMocks = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsList: vi.fn(),
}));

const db = vi.hoisted(() => ({
  planUpdates: [] as Array<Record<string, unknown>>,
  customer: null as { stripe_customer_id: string } | null,
  customerError: null as { message: string } | null,
  google: [] as Array<{ product_id: string; status: string }>,
  apple: [] as Array<{ product_id: string; status: string }>,
  existingStripeSubscription: null as unknown,
  existingGoogleSubscription: null as unknown,
}));

vi.mock('stripe', () => {
  function MockStripe() {
    return {
      subscriptions: {
        retrieve: stripeMocks.subscriptionsRetrieve,
        list: stripeMocks.subscriptionsList,
      },
    };
  }
  MockStripe.createFetchHttpClient = () => ({});
  return { default: MockStripe };
});

const iapTable = (rows: Array<{ product_id: string; status: string }>, existing: unknown) => ({
  select: () => ({
    eq: () => ({
      in: (_col: string, statuses: string[]) =>
        Promise.resolve({ data: rows.filter((r) => statuses.includes(r.status)), error: null }),
      single: () => Promise.resolve({ data: existing, error: null }),
      eq: () => ({ single: () => Promise.resolve({ data: existing, error: null }) }),
    }),
  }),
  upsert: () => Promise.resolve({ data: null, error: null }),
});

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'plans') {
        return {
          update: (values: Record<string, unknown>) => ({
            eq: () => {
              db.planUpdates.push(values);
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table === 'customers') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: db.customerError ? null : db.customer,
                  error: db.customerError,
                }),
            }),
          }),
        };
      }
      if (table === 'subscriptions') {
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: db.existingStripeSubscription }) }),
          }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
          insert: () => Promise.resolve({ data: null, error: null }),
        };
      }
      if (table === 'google_iap_subscriptions') {
        return iapTable(db.google, db.existingGoogleSubscription);
      }
      if (table === 'apple_iap_subscriptions') {
        return iapTable(db.apple, null);
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { resolveUserPlan } from '@/libs/payment/entitlements';
import { createOrUpdateSubscription as stripeCreateOrUpdateSubscription } from '@/libs/payment/stripe/server';
import { createOrUpdateSubscription as googleCreateOrUpdateSubscription } from '@/libs/payment/iap/google/server';

const PRO_PLAY_SKU = 'com.bilingify.readest.monthly.pro';
const PLUS_PLAY_SKU = 'com.bilingify.readest.monthly.plus';
const PRO_APPLE_SKU = 'com.bilingify.readest.monthly.pro';

const makeStripeSub = (id: string, plan: string, status = 'active') => ({
  id,
  status,
  items: {
    data: [
      {
        price: { id: `price_${plan}`, product: { id: `prod_${plan}`, metadata: { plan } } },
        current_period_start: 1700000000,
        current_period_end: 1702592000,
      },
    ],
  },
});

const stripeHas = (plan: string | null) => {
  if (!plan) {
    stripeMocks.subscriptionsList.mockResolvedValue({ data: [] });
    return;
  }
  stripeMocks.subscriptionsList.mockResolvedValue({
    data: [{ id: `sub_${plan}`, status: 'active' }],
  });
  stripeMocks.subscriptionsRetrieve.mockImplementation((id: string) =>
    Promise.resolve(makeStripeSub(id, plan)),
  );
};

beforeEach(() => {
  stripeMocks.subscriptionsRetrieve.mockReset();
  stripeMocks.subscriptionsList.mockReset();
  db.planUpdates = [];
  db.customer = { stripe_customer_id: 'cus_1' };
  db.customerError = null;
  db.google = [];
  db.apple = [];
  db.existingStripeSubscription = null;
  db.existingGoogleSubscription = null;
  process.env['STRIPE_SECRET_KEY_DEV'] = 'sk_test_dummy';
});

describe('resolveUserPlan', () => {
  it('keeps Pro when Stripe has nothing but Google Play is still active', async () => {
    stripeHas(null);
    db.google = [{ product_id: PRO_PLAY_SKU, status: 'active' }];

    expect(await resolveUserPlan('user-1')).toBe('pro');
  });

  it('keeps Pro when Google Play has expired but Stripe is still active', async () => {
    stripeHas('pro');
    db.google = [{ product_id: PRO_PLAY_SKU, status: 'expired' }];

    expect(await resolveUserPlan('user-1')).toBe('pro');
  });

  it('keeps Pro when the App Store entitlement is the surviving one', async () => {
    stripeHas(null);
    db.apple = [{ product_id: PRO_APPLE_SKU, status: 'active' }];

    expect(await resolveUserPlan('user-1')).toBe('pro');
  });

  it('returns the highest plan when providers disagree', async () => {
    stripeHas('plus');
    db.google = [{ product_id: PRO_PLAY_SKU, status: 'active' }];

    expect(await resolveUserPlan('user-1')).toBe('pro');
  });

  it('honours an entitledPlan the stored rows cannot express (billing grace period)', async () => {
    stripeHas(null);
    // The IAP tables collapse status to active/expired, so a subscription in
    // its billing grace period is stored as `expired`. The handler processing
    // that event passes the entitlement it knows about instead.
    db.google = [{ product_id: PLUS_PLAY_SKU, status: 'expired' }];

    expect(await resolveUserPlan('user-1', { entitledPlan: 'plus' })).toBe('plus');
  });

  it('returns free only when no provider entitles anything', async () => {
    stripeHas(null);
    db.google = [{ product_id: PRO_PLAY_SKU, status: 'expired' }];
    db.apple = [{ product_id: PRO_APPLE_SKU, status: 'revoked' }];

    expect(await resolveUserPlan('user-1')).toBe('free');
  });

  it('throws rather than downgrading when the customer lookup fails', async () => {
    // A failed lookup is indistinguishable from "no Stripe customer", and
    // returning `free` here would persist a downgrade for a user who is still
    // paying by card. Let the provider retry the webhook instead.
    db.customerError = { message: 'connection reset' };
    db.google = [];

    await expect(resolveUserPlan('user-1')).rejects.toMatchObject({
      message: 'connection reset',
    });
  });

  it('handles a user who never had a Stripe customer record', async () => {
    db.customer = null;
    db.google = [{ product_id: PRO_PLAY_SKU, status: 'active' }];

    expect(await resolveUserPlan('user-1')).toBe('pro');
    expect(stripeMocks.subscriptionsList).not.toHaveBeenCalled();
  });
});

describe('Stripe handler does not clobber an active store entitlement', () => {
  it('keeps Pro when the last Stripe subscription is cancelled but Google Play is active', async () => {
    // Exactly the production incident: user migrated card -> Google Play, then
    // the redundant Stripe subscription was cancelled.
    db.existingStripeSubscription = { id: 1 };
    db.google = [{ product_id: PRO_PLAY_SKU, status: 'active' }];
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      makeStripeSub('sub_pro', 'pro', 'canceled'),
    );
    stripeMocks.subscriptionsList.mockResolvedValue({
      data: [{ id: 'sub_pro', status: 'canceled' }],
    });

    await stripeCreateOrUpdateSubscription('user-1', 'cus_1', 'sub_pro');

    expect(db.planUpdates.at(-1)?.['plan']).toBe('pro');
  });

  it('still drops to free when no provider is left', async () => {
    db.existingStripeSubscription = { id: 1 };
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      makeStripeSub('sub_pro', 'pro', 'canceled'),
    );
    stripeMocks.subscriptionsList.mockResolvedValue({
      data: [{ id: 'sub_pro', status: 'canceled' }],
    });

    await stripeCreateOrUpdateSubscription('user-1', 'cus_1', 'sub_pro');

    expect(db.planUpdates.at(-1)?.['plan']).toBe('free');
  });
});

describe('Google handler does not clobber an active Stripe entitlement', () => {
  const expiredPlayPurchase = {
    purchaseToken: 'tok_1',
    platform: 'android',
    productId: PRO_PLAY_SKU,
    orderId: 'GPA.1',
    status: 'expired',
    purchaseDate: '2026-09-05T00:00:00Z',
    expiresDate: '2026-10-05T00:00:00Z',
    environment: 'Production',
    packageName: 'com.bilingify.readest',
    quantity: 1,
  } as never;

  it('keeps Pro when the Play subscription expires but Stripe is still active', async () => {
    stripeHas('pro');
    db.google = [{ product_id: PRO_PLAY_SKU, status: 'expired' }];

    await googleCreateOrUpdateSubscription('user-1', expiredPlayPurchase);

    expect(db.planUpdates.at(-1)?.['plan']).toBe('pro');
  });

  it('still drops to free when the Play subscription expires and Stripe has nothing', async () => {
    stripeHas(null);
    db.google = [{ product_id: PRO_PLAY_SKU, status: 'expired' }];

    await googleCreateOrUpdateSubscription('user-1', expiredPlayPurchase);

    expect(db.planUpdates.at(-1)?.['plan']).toBe('free');
  });
});
