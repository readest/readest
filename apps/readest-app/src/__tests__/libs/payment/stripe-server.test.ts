import { describe, it, expect, vi, beforeEach } from 'vitest';

// When a user upgrades Plus -> Pro on Stripe, both subscriptions stay active
// for a while (the old Plus one is not cancelled immediately). Each webhook
// calls `createOrUpdateSubscription`, which used to overwrite `plans.plan` with
// the plan of whichever subscription's event fired last. If the Plus event was
// processed after the Pro event, the user was downgraded to `plus`.
//
// The plan written to the `plans` table must reflect the HIGHEST active plan
// the user holds, regardless of webhook ordering.

const stripeMocks = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsList: vi.fn(),
}));

const db = vi.hoisted(() => ({
  existingSubscription: null as unknown,
  planUpdates: [] as Array<Record<string, unknown>>,
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
      if (table === 'subscriptions') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: db.existingSubscription }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
          insert: () => Promise.resolve({ data: null, error: null }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import {
  createOrUpdateSubscription,
  getHighestActivePlan,
  getStripe,
} from '@/libs/payment/stripe/server';

const makeSub = (id: string, plan: string, status = 'active') => ({
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

beforeEach(() => {
  stripeMocks.subscriptionsRetrieve.mockReset();
  stripeMocks.subscriptionsList.mockReset();
  db.existingSubscription = null;
  db.planUpdates = [];
  process.env['STRIPE_SECRET_KEY_DEV'] = 'sk_test_dummy';
});

describe('getHighestActivePlan', () => {
  it('returns the highest plan among multiple active subscriptions', async () => {
    stripeMocks.subscriptionsList.mockResolvedValue({
      data: [
        { id: 'sub_plus', status: 'active' },
        { id: 'sub_pro', status: 'active' },
      ],
    });
    stripeMocks.subscriptionsRetrieve.mockImplementation((id: string) =>
      Promise.resolve(id === 'sub_pro' ? makeSub('sub_pro', 'pro') : makeSub('sub_plus', 'plus')),
    );

    expect(await getHighestActivePlan(getStripe(), 'cus_1')).toBe('pro');
  });

  it('ignores subscriptions that are not active or trialing', async () => {
    stripeMocks.subscriptionsList.mockResolvedValue({
      data: [
        { id: 'sub_pro_old', status: 'canceled' },
        { id: 'sub_plus', status: 'active' },
        { id: 'sub_pro_pastdue', status: 'past_due' },
      ],
    });
    stripeMocks.subscriptionsRetrieve.mockImplementation((id: string) =>
      Promise.resolve(makeSub(id, 'plus')),
    );

    expect(await getHighestActivePlan(getStripe(), 'cus_1')).toBe('plus');
    // Only the single active subscription needs to be retrieved.
    expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledTimes(1);
  });

  it('counts trialing subscriptions', async () => {
    stripeMocks.subscriptionsList.mockResolvedValue({
      data: [{ id: 'sub_pro', status: 'trialing' }],
    });
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(makeSub('sub_pro', 'pro'));

    expect(await getHighestActivePlan(getStripe(), 'cus_1')).toBe('pro');
  });

  it('returns "free" when no subscription is active', async () => {
    stripeMocks.subscriptionsList.mockResolvedValue({
      data: [{ id: 'sub_plus', status: 'canceled' }],
    });

    expect(await getHighestActivePlan(getStripe(), 'cus_1')).toBe('free');
    expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
  });
});

describe('createOrUpdateSubscription', () => {
  it('writes the highest active plan when a user holds both Plus and Pro (Plus event fires last)', async () => {
    db.existingSubscription = { id: 1 };
    // The webhook being processed is for the older Plus subscription.
    stripeMocks.subscriptionsRetrieve.mockImplementation((id: string) =>
      Promise.resolve(id === 'sub_pro' ? makeSub('sub_pro', 'pro') : makeSub('sub_plus', 'plus')),
    );
    stripeMocks.subscriptionsList.mockResolvedValue({
      data: [
        { id: 'sub_plus', status: 'active' },
        { id: 'sub_pro', status: 'active' },
      ],
    });

    await createOrUpdateSubscription('user-1', 'cus_1', 'sub_plus');

    expect(db.planUpdates.at(-1)?.['plan']).toBe('pro');
  });

  it('keeps the active higher plan even when the triggering subscription is past_due', async () => {
    db.existingSubscription = { id: 1 };
    stripeMocks.subscriptionsRetrieve.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'sub_pro' ? makeSub('sub_pro', 'pro') : makeSub('sub_plus', 'plus', 'past_due'),
      ),
    );
    stripeMocks.subscriptionsList.mockResolvedValue({
      data: [
        { id: 'sub_plus', status: 'past_due' },
        { id: 'sub_pro', status: 'active' },
      ],
    });

    await createOrUpdateSubscription('user-1', 'cus_1', 'sub_plus');

    expect(db.planUpdates.at(-1)?.['plan']).toBe('pro');
  });

  it('downgrades to "free" when the only subscription becomes inactive', async () => {
    db.existingSubscription = { id: 1 };
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(makeSub('sub_plus', 'plus', 'canceled'));
    stripeMocks.subscriptionsList.mockResolvedValue({
      data: [{ id: 'sub_plus', status: 'canceled' }],
    });

    await createOrUpdateSubscription('user-1', 'cus_1', 'sub_plus');

    expect(db.planUpdates.at(-1)?.['plan']).toBe('free');
  });
});
