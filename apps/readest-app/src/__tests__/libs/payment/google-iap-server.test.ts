import { describe, it, expect, vi, beforeEach } from 'vitest';

// Google reports `userCancellationTimeMillis` as epoch milliseconds in a
// string, but `google_iap_subscriptions.user_cancellation_time_millis` is a
// timestamp column. Writing the raw string failed the whole upsert with
// "date/time field value out of range", so every event for a subscription the
// user had cancelled — the SUBSCRIPTION_CANCELED notification, a restore —
// errored out before the plan was touched.

const db = vi.hoisted(() => ({ upserts: [] as Array<Record<string, unknown>> }));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'google_iap_subscriptions') {
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
          }),
          upsert: (values: Record<string, unknown>) => {
            db.upserts.push(values);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) };
    },
  }),
}));

vi.mock('@/libs/payment/entitlements', () => ({
  resolveUserPlan: vi.fn().mockResolvedValue('plus'),
}));

import { createOrUpdateSubscription, VerifiedPurchase } from '@/libs/payment/iap/google/server';

const purchase = (userCancellationTimeMillis: string | null): VerifiedPurchase => ({
  platform: 'android',
  status: 'active',
  customerEmail: '',
  orderId: 'GPA.0000-0000-0000-00000',
  subscriptionId: 'GPA.0000-0000-0000-00000',
  planName: 'Plus',
  planType: 'subscription',
  productId: 'com.bilingify.readest.yearly.plus',
  purchaseToken: 'token',
  quantity: 1,
  environment: 'production',
  packageName: 'com.bilingify.readest',
  userCancellationTimeMillis,
});

beforeEach(() => {
  db.upserts = [];
});

describe('google createOrUpdateSubscription', () => {
  it('stores the cancellation time as a timestamp, not raw milliseconds', async () => {
    await createOrUpdateSubscription('user-1', purchase('1790006712951'));
    expect(db.upserts[0]!['user_cancellation_time_millis']).toBe('2026-09-21T16:05:12.951Z');
  });

  it('stores null when the subscription was never cancelled', async () => {
    await createOrUpdateSubscription('user-1', purchase(null));
    expect(db.upserts[0]!['user_cancellation_time_millis']).toBeNull();
  });
});
