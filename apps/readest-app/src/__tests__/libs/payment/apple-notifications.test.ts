import { describe, it, expect, vi, beforeEach } from 'vitest';

// Apple App Store Server Notifications V2 webhook handler. The notification is
// signed by Apple (decoded/verified by `app-store-server-api`), carries no
// user id, and must be resolved to a user via `original_transaction_id` before
// the subscription/plan tables are updated.

const appleMocks = vi.hoisted(() => ({
  decodeNotificationPayload: vi.fn(),
  decodeTransaction: vi.fn(),
  decodeRenewalInfo: vi.fn(),
}));

vi.mock('app-store-server-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app-store-server-api')>();
  return {
    ...actual,
    decodeNotificationPayload: appleMocks.decodeNotificationPayload,
    decodeTransaction: appleMocks.decodeTransaction,
    decodeRenewalInfo: appleMocks.decodeRenewalInfo,
  };
});

const h = vi.hoisted(() => ({ supabase: null as ReturnType<typeof createSupabaseMock> | null }));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => h.supabase!.client,
}));

import {
  NotificationType,
  NotificationSubtype,
  AutoRenewStatus,
  TransactionType,
} from 'app-store-server-api';
import { handleAppleNotification } from '@/libs/payment/iap/apple/notifications';

type Captures = {
  appleSubUpserts: Array<Record<string, unknown>>;
  planUpdates: Array<Record<string, unknown>>;
  paymentUpdates: Array<Record<string, unknown>>;
};

function createSupabaseMock(state: {
  appleSubRow?: unknown;
  paymentRow?: unknown;
  completedPayments?: Array<{ storage_gb: number }>;
}) {
  const captures: Captures = { appleSubUpserts: [], planUpdates: [], paymentUpdates: [] };
  const client = {
    from(table: string) {
      switch (table) {
        case 'apple_iap_subscriptions':
          return {
            select: () => ({
              eq: () => ({ single: () => Promise.resolve({ data: state.appleSubRow ?? null }) }),
            }),
            upsert: (obj: Record<string, unknown>) => {
              captures.appleSubUpserts.push(obj);
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
const STORAGE_PRODUCT = 'com.bilingify.readest.purchase.storage.5gb';
const BUNDLE_ID = 'com.bilingify.readest';
const ORIGINAL_TX = 'orig-tx-1';

const buildTransaction = (overrides: Record<string, unknown> = {}) => ({
  bundleId: BUNDLE_ID,
  productId: PLUS_PRODUCT,
  transactionId: 'tx-1',
  originalTransactionId: ORIGINAL_TX,
  purchaseDate: 1_700_000_000_000,
  expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
  quantity: 1,
  type: TransactionType.AutoRenewableSubscription,
  webOrderLineItemId: 'wol-1',
  subscriptionGroupIdentifier: 'group-1',
  ...overrides,
});

const mockNotification = (
  notificationType: NotificationType,
  subtype?: NotificationSubtype,
  hasRenewal = true,
) => {
  appleMocks.decodeNotificationPayload.mockResolvedValue({
    notificationType,
    subtype,
    data: {
      bundleId: BUNDLE_ID,
      environment: 'Production',
      signedTransactionInfo: 'SIGNED_TX',
      signedRenewalInfo: hasRenewal ? 'SIGNED_RENEWAL' : undefined,
    },
  });
};

beforeEach(() => {
  appleMocks.decodeNotificationPayload.mockReset();
  appleMocks.decodeTransaction.mockReset();
  appleMocks.decodeRenewalInfo.mockReset();
  process.env['APPLE_IAP_BUNDLE_ID'] = BUNDLE_ID;
  appleMocks.decodeTransaction.mockResolvedValue(buildTransaction());
  appleMocks.decodeRenewalInfo.mockResolvedValue({ autoRenewStatus: AutoRenewStatus.On });
});

describe('handleAppleNotification — subscriptions', () => {
  it('marks a renewed subscription active and keeps the paid plan', async () => {
    mockNotification(NotificationType.DidRenew);
    const sb = createSupabaseMock({ appleSubRow: { user_id: 'user-1' } });
    h.supabase = sb;

    const res = await handleAppleNotification('payload');

    expect(res).toMatchObject({ handled: true, status: 'active' });
    expect(sb.captures.appleSubUpserts.at(-1)).toMatchObject({ status: 'active' });
    expect(sb.captures.planUpdates.at(-1)).toEqual({ plan: 'plus', status: 'active' });
  });

  it('drops the user to free when the subscription expires', async () => {
    mockNotification(NotificationType.Expired);
    appleMocks.decodeTransaction.mockResolvedValue(
      buildTransaction({ expiresDate: Date.now() - 1000 }),
    );
    const sb = createSupabaseMock({ appleSubRow: { user_id: 'user-1' } });
    h.supabase = sb;

    const res = await handleAppleNotification('payload');

    expect(res).toMatchObject({ handled: true, status: 'expired' });
    expect(sb.captures.appleSubUpserts.at(-1)).toMatchObject({ status: 'expired' });
    expect(sb.captures.planUpdates.at(-1)).toEqual({ plan: 'free', status: 'expired' });
  });

  it('revokes access and drops to free on a subscription refund', async () => {
    mockNotification(NotificationType.Refund);
    const sb = createSupabaseMock({ appleSubRow: { user_id: 'user-1' } });
    h.supabase = sb;

    const res = await handleAppleNotification('payload');

    expect(res).toMatchObject({ handled: true, status: 'revoked' });
    expect(sb.captures.appleSubUpserts.at(-1)).toMatchObject({ status: 'expired' });
    expect(sb.captures.planUpdates.at(-1)).toEqual({ plan: 'free', status: 'revoked' });
  });

  it('keeps the plan active but records auto-renew off when renewal is disabled', async () => {
    mockNotification(
      NotificationType.DidChangeRenewalStatus,
      NotificationSubtype.AutoRenewDisabled,
    );
    appleMocks.decodeRenewalInfo.mockResolvedValue({ autoRenewStatus: AutoRenewStatus.Off });
    const sb = createSupabaseMock({ appleSubRow: { user_id: 'user-1' } });
    h.supabase = sb;

    const res = await handleAppleNotification('payload');

    expect(res).toMatchObject({ handled: true, status: 'active' });
    expect(sb.captures.appleSubUpserts.at(-1)).toMatchObject({
      status: 'active',
      auto_renew_status: false,
    });
    expect(sb.captures.planUpdates.at(-1)).toEqual({ plan: 'plus', status: 'active' });
  });

  it('keeps entitlement during the billing grace period', async () => {
    mockNotification(NotificationType.DidFailToRenew, NotificationSubtype.GracePeriod);
    const sb = createSupabaseMock({ appleSubRow: { user_id: 'user-1' } });
    h.supabase = sb;

    const res = await handleAppleNotification('payload');

    expect(res).toMatchObject({ handled: true, status: 'in_grace_period' });
    expect(sb.captures.planUpdates.at(-1)).toEqual({ plan: 'plus', status: 'in_grace_period' });
  });

  it('ignores notifications for an unknown subscription', async () => {
    mockNotification(NotificationType.DidRenew);
    const sb = createSupabaseMock({ appleSubRow: null });
    h.supabase = sb;

    const res = await handleAppleNotification('payload');

    expect(res).toMatchObject({ handled: false, reason: 'subscription_not_found' });
    expect(sb.captures.planUpdates).toHaveLength(0);
  });
});

describe('handleAppleNotification — validation', () => {
  it('skips summary notifications without transaction data', async () => {
    appleMocks.decodeNotificationPayload.mockResolvedValue({
      notificationType: NotificationType.RenewalExtension,
      subtype: NotificationSubtype.Summary,
      summary: { requestIdentifier: 'r1' },
    });
    h.supabase = createSupabaseMock({});

    const res = await handleAppleNotification('payload');

    expect(res).toMatchObject({ handled: false, reason: 'summary_notification' });
  });

  it('rejects a payload for a different bundle id', async () => {
    mockNotification(NotificationType.DidRenew);
    appleMocks.decodeNotificationPayload.mockResolvedValue({
      notificationType: NotificationType.DidRenew,
      data: {
        bundleId: 'com.evil.app',
        environment: 'Production',
        signedTransactionInfo: 'SIGNED_TX',
      },
    });
    h.supabase = createSupabaseMock({});

    await expect(handleAppleNotification('payload')).rejects.toThrow();
  });
});

describe('handleAppleNotification — one-time purchases', () => {
  it('marks a refunded one-time purchase and recomputes storage', async () => {
    appleMocks.decodeNotificationPayload.mockResolvedValue({
      notificationType: NotificationType.Refund,
      data: {
        bundleId: BUNDLE_ID,
        environment: 'Production',
        signedTransactionInfo: 'SIGNED_TX',
      },
    });
    appleMocks.decodeTransaction.mockResolvedValue(
      buildTransaction({ productId: STORAGE_PRODUCT, type: TransactionType.NonConsumable }),
    );
    const sb = createSupabaseMock({
      paymentRow: { user_id: 'user-1' },
      completedPayments: [],
    });
    h.supabase = sb;

    const res = await handleAppleNotification('payload');

    expect(res).toMatchObject({ handled: true });
    expect(sb.captures.paymentUpdates.at(-1)).toMatchObject({ status: 'refunded' });
    expect(sb.captures.planUpdates.at(-1)).toMatchObject({ storage_purchased_bytes: 0 });
  });
});
