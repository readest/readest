import { describe, it, expect, vi, beforeEach } from 'vitest';

// Google Play Real-Time Developer Notifications (RTDN) webhook handler. The
// Pub/Sub message carries a base64-encoded DeveloperNotification with no user
// id and no trustworthy state, so the handler resolves the user via the stored
// `purchase_token` and re-verifies against the Play Developer API (overriding
// the status for terminal events such as REVOKED/EXPIRED).

const googleMocks = vi.hoisted(() => ({
  verifyPurchase: vi.fn(),
}));

vi.mock('@/libs/payment/iap/google/verifier', () => ({
  getGoogleIAPVerifier: () => ({ verifyPurchase: googleMocks.verifyPurchase }),
}));

const h = vi.hoisted(() => ({ supabase: null as ReturnType<typeof createSupabaseMock> | null }));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => h.supabase!.client,
}));

import { handleGoogleNotification } from '@/libs/payment/iap/google/notifications';

type Captures = {
  googleSubUpserts: Array<Record<string, unknown>>;
  googleSubUpsertOptions: Array<Record<string, unknown> | undefined>;
  planUpdates: Array<Record<string, unknown>>;
  paymentUpdates: Array<Record<string, unknown>>;
};

function createSupabaseMock(state: {
  googleSubRow?: unknown;
  paymentRow?: unknown;
  completedPayments?: Array<{ storage_gb: number }>;
}) {
  const captures: Captures = {
    googleSubUpserts: [],
    googleSubUpsertOptions: [],
    planUpdates: [],
    paymentUpdates: [],
  };
  const client = {
    from(table: string) {
      switch (table) {
        case 'google_iap_subscriptions':
          return {
            select: () => ({
              eq: () => ({ single: () => Promise.resolve({ data: state.googleSubRow ?? null }) }),
            }),
            upsert: (obj: Record<string, unknown>, options?: Record<string, unknown>) => {
              captures.googleSubUpserts.push(obj);
              captures.googleSubUpsertOptions.push(options);
              return Promise.resolve({ data: obj, error: null });
            },
          };
        case 'plans':
          return {
            update: (obj: Record<string, unknown>) => ({
              eq: () => {
                captures.planUpdates.push(obj);
                return Promise.resolve({ data: null, error: null });
              },
            }),
          };
        case 'payments':
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: state.paymentRow ?? null }),
                in: () => Promise.resolve({ data: state.completedPayments ?? [] }),
              }),
            }),
            update: (obj: Record<string, unknown>) => ({
              eq: () => {
                captures.paymentUpdates.push(obj);
                return Promise.resolve({ data: null, error: null });
              },
            }),
          };
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
  };
  return { client, captures };
}

const PLUS_PRODUCT = 'com.bilingify.readest.plus.monthly';
const PACKAGE = 'com.bilingify.readest';
const TOKEN = 'purchase-token-1';

const subRow = {
  user_id: 'user-1',
  product_id: PLUS_PRODUCT,
  order_id: 'order-1',
  package_name: PACKAGE,
};

const encode = (notification: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(notification)).toString('base64');

const subscriptionMessage = (notificationType: number) =>
  encode({
    version: '1.0',
    packageName: PACKAGE,
    eventTimeMillis: '1700000000000',
    subscriptionNotification: {
      version: '1.0',
      notificationType,
      purchaseToken: TOKEN,
      subscriptionId: PLUS_PRODUCT,
    },
  });

const activeVerification = () => ({
  success: true,
  status: 'active',
  purchaseDate: new Date(1_700_000_000_000),
  expiresDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  purchaseType: 'subscription',
  purchaseData: {
    orderId: 'order-1',
    priceAmountMicros: '4990000',
    priceCurrencyCode: 'USD',
    autoRenewing: true,
    purchaseState: 0,
    acknowledgementState: 1,
    quantity: 1,
  },
});

beforeEach(() => {
  googleMocks.verifyPurchase.mockReset();
  googleMocks.verifyPurchase.mockResolvedValue(activeVerification());
});

describe('handleGoogleNotification — subscriptions', () => {
  it('re-verifies and keeps the plan active on renewal', async () => {
    const sb = createSupabaseMock({ googleSubRow: subRow });
    h.supabase = sb;

    const res = await handleGoogleNotification(subscriptionMessage(2)); // SUBSCRIPTION_RENEWED

    expect(res).toMatchObject({ handled: true, status: 'active' });
    expect(sb.captures.googleSubUpserts.at(-1)).toMatchObject({ status: 'active' });
    expect(sb.captures.planUpdates.at(-1)).toEqual({ plan: 'plus', status: 'active' });
  });

  it('forces revocation on SUBSCRIPTION_REVOKED even if the API still reports active', async () => {
    googleMocks.verifyPurchase.mockResolvedValue(activeVerification());
    const sb = createSupabaseMock({ googleSubRow: subRow });
    h.supabase = sb;

    const res = await handleGoogleNotification(subscriptionMessage(12)); // SUBSCRIPTION_REVOKED

    expect(res).toMatchObject({ handled: true, status: 'revoked' });
    expect(sb.captures.planUpdates.at(-1)).toEqual({ plan: 'free', status: 'revoked' });
  });

  it('drops to free on SUBSCRIPTION_EXPIRED', async () => {
    googleMocks.verifyPurchase.mockResolvedValue({
      ...activeVerification(),
      status: 'expired',
      expiresDate: new Date(Date.now() - 1000),
    });
    const sb = createSupabaseMock({ googleSubRow: subRow });
    h.supabase = sb;

    const res = await handleGoogleNotification(subscriptionMessage(13)); // SUBSCRIPTION_EXPIRED

    expect(res).toMatchObject({ handled: true, status: 'expired' });
    expect(sb.captures.planUpdates.at(-1)).toEqual({ plan: 'free', status: 'expired' });
  });

  it('keeps entitlement during the grace period', async () => {
    const sb = createSupabaseMock({ googleSubRow: subRow });
    h.supabase = sb;

    const res = await handleGoogleNotification(subscriptionMessage(6)); // SUBSCRIPTION_IN_GRACE_PERIOD

    expect(res).toMatchObject({ handled: true, status: 'in_grace_period' });
    expect(sb.captures.planUpdates.at(-1)).toEqual({ plan: 'plus', status: 'in_grace_period' });
  });

  it('downgrades to free when re-verification fails on a terminal event', async () => {
    googleMocks.verifyPurchase.mockResolvedValue({ success: false, error: 'gone' });
    const sb = createSupabaseMock({ googleSubRow: subRow });
    h.supabase = sb;

    const res = await handleGoogleNotification(subscriptionMessage(13)); // SUBSCRIPTION_EXPIRED

    expect(res).toMatchObject({ handled: true, status: 'expired' });
    expect(sb.captures.planUpdates.at(-1)).toEqual({ plan: 'free', status: 'expired' });
  });

  it('does not downgrade when re-verification fails on a renewal', async () => {
    // A failed Play API call on a non-terminal event (renewal/recovery/purchase)
    // is transient; the handler must surface an error so Pub/Sub retries instead
    // of downgrading a paying user to free.
    googleMocks.verifyPurchase.mockResolvedValue({ success: false, error: 'api unavailable' });
    const sb = createSupabaseMock({ googleSubRow: subRow });
    h.supabase = sb;

    await expect(handleGoogleNotification(subscriptionMessage(2))).rejects.toThrow(
      /re-verification failed/,
    );
    expect(sb.captures.googleSubUpserts).toHaveLength(0);
    expect(sb.captures.planUpdates).toHaveLength(0);
  });

  it('records a renewal under the stable purchase-token key', async () => {
    // After a renewal the Play API returns the order id with a `..N` suffix.
    // The upsert must conflict on (user_id, purchase_token) — the token never
    // changes across renewals — so the existing row is updated instead of an
    // insert that collides with the unique_user_purchase constraint.
    googleMocks.verifyPurchase.mockResolvedValue({
      ...activeVerification(),
      purchaseData: { ...activeVerification().purchaseData, orderId: 'order-1..3' },
    });
    const sb = createSupabaseMock({ googleSubRow: subRow });
    h.supabase = sb;

    const res = await handleGoogleNotification(subscriptionMessage(2)); // SUBSCRIPTION_RENEWED

    expect(res).toMatchObject({ handled: true, status: 'active' });
    expect(sb.captures.googleSubUpsertOptions.at(-1)).toMatchObject({
      onConflict: 'user_id,purchase_token',
    });
    const upsert = sb.captures.googleSubUpserts.at(-1)!;
    expect(upsert).toMatchObject({ order_id: 'order-1..3', purchase_token: TOKEN });
    // created_at has a DB default and must not be rewritten on every upsert.
    expect(upsert).not.toHaveProperty('created_at');
  });

  it('ignores notifications for an unknown purchase token', async () => {
    const sb = createSupabaseMock({ googleSubRow: null });
    h.supabase = sb;

    const res = await handleGoogleNotification(subscriptionMessage(2));

    expect(res).toMatchObject({ handled: false, reason: 'subscription_not_found' });
    expect(sb.captures.planUpdates).toHaveLength(0);
  });
});

describe('handleGoogleNotification — voided purchases', () => {
  it('revokes a refunded subscription', async () => {
    const sb = createSupabaseMock({ googleSubRow: subRow });
    h.supabase = sb;

    const res = await handleGoogleNotification(
      encode({
        version: '1.0',
        packageName: PACKAGE,
        voidedPurchaseNotification: { purchaseToken: TOKEN, orderId: 'order-1', productType: 1 },
      }),
    );

    expect(res).toMatchObject({ handled: true, status: 'revoked' });
    expect(sb.captures.planUpdates.at(-1)).toEqual({ plan: 'free', status: 'revoked' });
  });

  it('refunds a voided one-time purchase and recomputes storage', async () => {
    const sb = createSupabaseMock({ paymentRow: { user_id: 'user-1' }, completedPayments: [] });
    h.supabase = sb;

    const res = await handleGoogleNotification(
      encode({
        version: '1.0',
        packageName: PACKAGE,
        voidedPurchaseNotification: { purchaseToken: TOKEN, orderId: 'order-1', productType: 2 },
      }),
    );

    expect(res).toMatchObject({ handled: true });
    expect(sb.captures.paymentUpdates.at(-1)).toMatchObject({ status: 'refunded' });
    expect(sb.captures.planUpdates.at(-1)).toMatchObject({ storage_purchased_bytes: 0 });
  });
});

describe('handleGoogleNotification — other', () => {
  it('acknowledges test notifications without processing', async () => {
    h.supabase = createSupabaseMock({});

    const res = await handleGoogleNotification(encode({ testNotification: { version: '1.0' } }));

    expect(res).toMatchObject({ handled: false, reason: 'test_notification' });
  });
});
