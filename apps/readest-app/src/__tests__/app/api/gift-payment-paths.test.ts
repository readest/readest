// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GiftDb } from '../../helpers/gift-db';

// Each payment path records its payment exactly as before (refund webhooks find
// the purchase through that `payments` row) and then turns a gift payment into
// an active card. A payment that isn't currently paid for never makes one, and
// a gift never writes the buyer's own plan.

const hooks = vi.hoisted(() => ({
  log: [] as string[],
  paymentWrites: [] as Array<Record<string, unknown>>,
  planUpdates: [] as Array<Record<string, unknown>>,
  activateGiftCard: vi.fn(),
  revokeGiftCardForPayment: vi.fn(),
  validateUserAndToken: vi.fn(),
  sessionsRetrieve: vi.fn(),
  sessionsCreate: vi.fn(),
  constructEvent: vi.fn(),
  verifyTransaction: vi.fn(),
  verifyPurchase: vi.fn(),
  acknowledgePurchase: vi.fn(),
  consumeProductPurchase: vi.fn(),
  decodeNotificationPayload: vi.fn(),
  decodeTransaction: vi.fn(),
  rpc: vi.fn(),
  giftDb: null as GiftDb | null,
}));

vi.mock('stripe', () => {
  function MockStripe() {
    return {
      checkout: { sessions: { retrieve: hooks.sessionsRetrieve, create: hooks.sessionsCreate } },
      webhooks: { constructEvent: hooks.constructEvent },
    };
  }
  MockStripe.createFetchHttpClient = () => ({});
  return { default: MockStripe };
});

vi.mock('app-store-server-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app-store-server-api')>();
  return {
    ...actual,
    decodeNotificationPayload: hooks.decodeNotificationPayload,
    decodeTransaction: hooks.decodeTransaction,
  };
});

vi.mock('@/libs/payment/gift/server', () => ({
  activateGiftCard: (...a: unknown[]) => {
    hooks.log.push('gift.activate');
    return hooks.activateGiftCard(...a);
  },
  revokeGiftCardForPayment: (...a: unknown[]) => {
    hooks.log.push('gift.revoke');
    return hooks.revokeGiftCardForPayment(...a);
  },
}));

vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => hooks.validateUserAndToken(...a),
}));

vi.mock('@/libs/payment/iap/apple/verifier', () => ({
  getAppleIAPVerifier: () => ({ verifyTransaction: hooks.verifyTransaction }),
  appleVerifierEnvironment: () =>
    process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
}));

vi.mock('@/libs/payment/iap/google/verifier', () => ({
  getGoogleIAPVerifier: () => ({
    verifyPurchase: hooks.verifyPurchase,
    acknowledgePurchase: hooks.acknowledgePurchase,
    consumeProductPurchase: hooks.consumeProductPurchase,
  }),
}));

type Result = { data: unknown; error: null };
type Query = Promise<Result> & {
  eq: () => Query;
  in: () => Query;
  select: () => Query;
  single: () => Promise<Result>;
};

// Every filter returns the same rows; awaiting the chain or ending it with
// `single()` resolves them.
const query = (data: unknown): Query =>
  Object.assign(Promise.resolve({ data, error: null }), {
    eq: () => query(data),
    in: () => query(data),
    select: () => query(data),
    single: () => Promise.resolve({ data, error: null }),
  });

const recordPayment = (values: Record<string, unknown>) => {
  hooks.log.push('payments.write');
  hooks.paymentWrites.push(values);
};

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      switch (table) {
        case 'payments':
          return {
            // No existing row for the purchase, and no completed purchases
            // for the storage recompute.
            select: () => query(null),
            upsert: (values: Record<string, unknown>) => {
              recordPayment(values);
              return Promise.resolve({ data: null, error: null });
            },
            // The App Store write updates only the buyer's own row; there is
            // none, so it inserts.
            update: (values: Record<string, unknown>) => {
              recordPayment(values);
              return query([]);
            },
            insert: (values: Record<string, unknown>) => {
              recordPayment(values);
              return Promise.resolve({ data: null, error: null });
            },
          };
        case 'plans':
          return {
            update: (values: Record<string, unknown>) => {
              hooks.planUpdates.push(values);
              return query(null);
            },
          };
        case 'customers':
          return { select: () => query({ stripe_customer_id: 'cus_1' }) };
        // Only for a test that runs the real activation.
        case 'gift_cards':
          return hooks.giftDb!.client.from(table);
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
    rpc: (...a: unknown[]) => hooks.rpc(...a),
  }),
}));

import { NotificationType, TransactionType } from 'app-store-server-api';
import { createOrUpdatePayment } from '@/libs/payment/stripe/server';
import { handleAppleNotification } from '@/libs/payment/iap/apple/notifications';
import { POST as checkoutPost } from '@/app/api/stripe/checkout/route';
import { POST as applePost } from '@/app/api/apple/iap-verify/route';
import { POST as googlePost } from '@/app/api/google/iap-verify/route';
import { POST as stripeWebhookPost } from '@/app/api/stripe/webhook/route';

const BUYER = 'buyer-1';
const DRAFT_ID = '6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f';
const GIFT_PLUS = 'com.bilingify.readest.giftcard_plus_1y.purchase';
const GIFT_PRO = 'com.bilingify.readest.giftcard_pro_1y.purchase';
const BUNDLE_ID = 'com.bilingify.readest';

const stripeSession = ({
  refunded = false,
  intentStatus = 'succeeded',
  productMetadata = { gift: 'plus' } as Record<string, string>,
} = {}) => ({
  id: 'cs_1',
  metadata: { userId: BUYER, giftCardId: DRAFT_ID },
  payment_intent: {
    id: 'pi_1',
    amount: 3999,
    currency: 'usd',
    status: intentStatus,
    payment_method: 'pm_1',
    latest_charge: { id: 'ch_1', refunded },
  },
  line_items: { data: [{ price: { product: { id: 'prod_gift', metadata: productMetadata } } }] },
});

const appleVerification = (productId: string, status = 'active') => ({
  success: true,
  status,
  planType: 'purchase',
  purchaseDate: new Date('2026-11-23T00:00:00Z'),
  expiresDate: null,
  transaction: {
    productId,
    transactionId: 'tx-1',
    originalTransactionId: 'otx-1',
    environment: 'Production',
    bundleId: BUNDLE_ID,
    quantity: 1,
    type: TransactionType.Consumable,
  },
});

const googleParams = {
  packageName: BUNDLE_ID,
  productId: GIFT_PLUS,
  orderId: 'GPA.1111-2222-3333-44444',
  purchaseToken: 'gift-token-1',
};

const googleVerification = (purchaseState = 0) => ({
  success: true,
  status: purchaseState === 0 ? 'active' : 'cancelled',
  purchaseType: 'product',
  purchaseDate: new Date('2026-11-23T00:00:00Z'),
  purchaseData: {
    orderId: googleParams.orderId,
    purchaseState,
    consumptionState: 0,
    acknowledgementState: 0,
    quantity: 1,
    regionCode: 'US',
  },
});

const jsonReq = (path: string, body: unknown) =>
  new NextRequest(`https://web.readest.com${path}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer buyer-token',
      'content-type': 'application/json',
      origin: 'https://web.readest.com',
    },
    body: JSON.stringify(body),
  });

const appleVerify = (body: Record<string, unknown>) =>
  applePost(
    jsonReq('/api/apple/iap-verify', {
      transactionId: 'tx-1',
      originalTransactionId: 'otx-1',
      ...body,
    }),
  );

const googleVerify = (body: Record<string, unknown>) =>
  googlePost(jsonReq('/api/google/iap-verify', { ...googleParams, ...body }));

beforeEach(() => {
  hooks.log = [];
  hooks.paymentWrites = [];
  hooks.planUpdates = [];
  for (const fn of [
    hooks.activateGiftCard,
    hooks.revokeGiftCardForPayment,
    hooks.validateUserAndToken,
    hooks.sessionsRetrieve,
    hooks.sessionsCreate,
    hooks.constructEvent,
    hooks.verifyTransaction,
    hooks.verifyPurchase,
    hooks.acknowledgePurchase,
    hooks.consumeProductPurchase,
    hooks.decodeNotificationPayload,
    hooks.decodeTransaction,
    hooks.rpc,
  ]) {
    fn.mockReset();
  }
  hooks.activateGiftCard.mockResolvedValue({ id: 'card-1' });
  hooks.revokeGiftCardForPayment.mockResolvedValue(undefined);
  hooks.validateUserAndToken.mockResolvedValue({
    user: { id: BUYER, email: 'buyer@example.com' },
    token: 'buyer-token',
  });
  hooks.acknowledgePurchase.mockResolvedValue(undefined);
  hooks.consumeProductPurchase.mockImplementation(async () => {
    hooks.log.push('google.consume');
  });
  process.env['STRIPE_SECRET_KEY_DEV'] = 'sk_test_dummy';
  process.env['APPLE_IAP_BUNDLE_ID'] = BUNDLE_ID;
});

describe('Stripe gift payments', () => {
  it('Stripe gift checkout activates the draft from session metadata', async () => {
    hooks.sessionsRetrieve.mockResolvedValue(stripeSession());

    await createOrUpdatePayment(BUYER, 'cus_1', 'cs_1');

    expect(hooks.activateGiftCard).toHaveBeenCalledTimes(1);
    expect(hooks.activateGiftCard).toHaveBeenCalledWith({
      buyerId: BUYER,
      tier: 'plus',
      provider: 'stripe',
      column: 'stripe_payment_intent_id',
      paymentRef: 'pi_1',
      giftCardId: DRAFT_ID,
    });
    // The payment row is written first and as before: refunds find it there.
    expect(hooks.paymentWrites[0]).toMatchObject({
      stripe_payment_intent_id: 'pi_1',
      status: 'succeeded',
      metadata: { gift: 'plus' },
    });
    // Review (CodeRabbit): indexOf is -1 with no write at all, which also passes.
    expect(hooks.log).toContain('payments.write');
    expect(hooks.log.indexOf('payments.write')).toBeLessThan(hooks.log.indexOf('gift.activate'));
  });

  it('a refunded Stripe gift session revokes instead of activating', async () => {
    hooks.sessionsRetrieve.mockResolvedValue(stripeSession({ refunded: true }));

    await createOrUpdatePayment(BUYER, 'cus_1', 'cs_1');

    expect(hooks.activateGiftCard).not.toHaveBeenCalled();
    expect(hooks.revokeGiftCardForPayment).toHaveBeenCalledWith('stripe_payment_intent_id', 'pi_1');
    expect(hooks.paymentWrites[0]).toMatchObject({ status: 'refunded' });
  });

  it('an unpaid Stripe gift session does not activate', async () => {
    hooks.sessionsRetrieve.mockResolvedValue(stripeSession({ intentStatus: 'processing' }));

    await createOrUpdatePayment(BUYER, 'cus_1', 'cs_1');

    expect(hooks.activateGiftCard).not.toHaveBeenCalled();
    expect(hooks.revokeGiftCardForPayment).not.toHaveBeenCalled();
  });

  it('a Stripe plan purchase never activates a gift', async () => {
    // Even with a giftCardId in the session metadata, only the product decides.
    hooks.sessionsRetrieve.mockResolvedValue(
      stripeSession({ productMetadata: { plan: 'purchase', storageGB: '5' } }),
    );

    await createOrUpdatePayment(BUYER, 'cus_1', 'cs_1');

    expect(hooks.activateGiftCard).not.toHaveBeenCalled();
    expect(hooks.revokeGiftCardForPayment).not.toHaveBeenCalled();
    expect(hooks.paymentWrites[0]).toMatchObject({ storage_gb: 5 });
  });

  it('a failed activation fails the payment call so the webhook is retried', async () => {
    hooks.sessionsRetrieve.mockResolvedValue(stripeSession());
    hooks.activateGiftCard.mockRejectedValue(new Error('gift card belongs to another buyer'));

    await expect(createOrUpdatePayment(BUYER, 'cus_1', 'cs_1')).rejects.toThrow(
      'gift card belongs to another buyer',
    );
  });
});

// A bank debit (ACH, SEPA) is still processing when the checkout completes;
// Stripe reports the money arriving as a separate event.
describe('Stripe delayed payments', () => {
  const asyncPaymentSucceeded = () => {
    hooks.constructEvent.mockReturnValue({
      type: 'checkout.session.async_payment_succeeded',
      data: {
        object: {
          id: 'cs_1',
          mode: 'payment',
          customer: 'cus_1',
          metadata: { userId: BUYER, giftCardId: DRAFT_ID },
        },
      },
    });
    return stripeWebhookPost(
      new NextRequest('https://web.readest.com/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig' },
        body: '{}',
      }),
    );
  };

  it('async_payment_succeeded for a gift session activates the card', async () => {
    hooks.sessionsRetrieve.mockResolvedValue(stripeSession());

    const res = await asyncPaymentSucceeded();

    expect(res.status).toBe(200);
    expect(hooks.sessionsRetrieve).toHaveBeenCalledWith('cs_1', expect.anything());
    expect(hooks.activateGiftCard).toHaveBeenCalledWith(
      expect.objectContaining({ buyerId: BUYER, paymentRef: 'pi_1', giftCardId: DRAFT_ID }),
    );
  });

  // Review (CodeRabbit): the webhook itself must answer the failure, or
  // Stripe takes a 200 and never retries.
  it('a failed gift activation answers the webhook 500, after the payment is written', async () => {
    hooks.sessionsRetrieve.mockResolvedValue(stripeSession());
    hooks.activateGiftCard.mockRejectedValue(new Error('gift card belongs to another buyer'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await asyncPaymentSucceeded();

    expect(res.status).toBe(500);
    expect(hooks.paymentWrites[0]).toMatchObject({ stripe_payment_intent_id: 'pi_1' });
  });

  it('async_payment_succeeded for a storage session records the payment', async () => {
    hooks.sessionsRetrieve.mockResolvedValue(
      stripeSession({ productMetadata: { plan: 'purchase', storageGB: '5' } }),
    );

    const res = await asyncPaymentSucceeded();

    expect(res.status).toBe(200);
    expect(hooks.paymentWrites[0]).toMatchObject({
      stripe_payment_intent_id: 'pi_1',
      status: 'succeeded',
      storage_gb: 5,
    });
    expect(hooks.activateGiftCard).not.toHaveBeenCalled();
  });
});

describe('Stripe gift checkout', () => {
  const checkout = (metadata?: Record<string, unknown>) =>
    checkoutPost(
      jsonReq('/api/stripe/checkout', {
        priceId: 'price_gift_plus',
        planType: 'purchase',
        embedded: false,
        ...(metadata ? { metadata } : {}),
      }),
    );

  beforeEach(() => {
    hooks.sessionsCreate.mockResolvedValue({
      id: 'cs_new',
      url: 'https://checkout.stripe.com/c/cs_new',
      client_secret: null,
    });
  });

  it('checkout sets the gift success and cancel URLs when giftCardId is present', async () => {
    const res = await checkout({ giftCardId: DRAFT_ID });

    expect(res.status).toBe(200);
    expect(hooks.sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        metadata: { giftCardId: DRAFT_ID, userId: BUYER },
        success_url: 'https://web.readest.com/user?section=gifts&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://web.readest.com/user?section=gifts',
      }),
    );
  });

  // A tampered id would be paid for and then fail every webhook retry on the
  // uuid column, so it is refused before any session exists.
  it.each([
    ['a non-UUID string', 'not-a-uuid'],
    ['a number', 42],
  ])('checkout answers %s giftCardId with 400', async (_label, giftCardId) => {
    const res = await checkout({ giftCardId });

    expect(res.status).toBe(400);
    expect(hooks.sessionsCreate).not.toHaveBeenCalled();
  });

  it('checkout treats a null metadata as no giftCardId', async () => {
    const res = await checkoutPost(
      jsonReq('/api/stripe/checkout', {
        priceId: 'price_plus',
        embedded: false,
        metadata: null,
      }),
    );

    expect(res.status).toBe(200);
    expect(hooks.sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { userId: BUYER } }),
    );
  });

  it('checkout keeps the plan success and cancel URLs without a giftCardId', async () => {
    await checkout();

    expect(hooks.sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url:
          'https://web.readest.com/user/subscription/success?payment=stripe&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://web.readest.com/user',
      }),
    );
  });
});

describe('App Store gift payments', () => {
  it('Apple verify passes giftCardId through', async () => {
    hooks.verifyTransaction.mockResolvedValue(appleVerification(GIFT_PRO));

    const res = await appleVerify({ giftCardId: DRAFT_ID });

    expect(res.status).toBe(200);
    expect(hooks.activateGiftCard).toHaveBeenCalledWith({
      buyerId: BUYER,
      tier: 'pro',
      provider: 'apple',
      column: 'apple_original_transaction_id',
      paymentRef: 'otx-1',
      giftCardId: DRAFT_ID,
    });
    // Review (CodeRabbit): indexOf is -1 with no write at all, which also passes.
    expect(hooks.log).toContain('payments.write');
    expect(hooks.log.indexOf('payments.write')).toBeLessThan(hooks.log.indexOf('gift.activate'));
  });

  it('a restore re-verify with no giftCardId still makes a card', async () => {
    hooks.verifyTransaction.mockResolvedValue(appleVerification(GIFT_PLUS));

    const res = await appleVerify({});

    expect(res.status).toBe(200);
    expect(hooks.activateGiftCard).toHaveBeenCalledTimes(1);
    expect(hooks.activateGiftCard.mock.calls[0]![0]).toMatchObject({
      tier: 'plus',
      paymentRef: 'otx-1',
      giftCardId: undefined,
    });
  });

  it('a failed App Store activation answers 500', async () => {
    hooks.verifyTransaction.mockResolvedValue(appleVerification(GIFT_PLUS));
    hooks.activateGiftCard.mockRejectedValue(new Error('gift card belongs to another buyer'));

    const res = await appleVerify({ giftCardId: DRAFT_ID });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ purchase: null });
  });

  it('a revoked App Store gift does not activate', async () => {
    hooks.verifyTransaction.mockResolvedValue(appleVerification(GIFT_PLUS, 'expired'));

    const res = await appleVerify({ giftCardId: DRAFT_ID });

    expect(res.status).toBe(200);
    expect(hooks.activateGiftCard).not.toHaveBeenCalled();
  });

  it('Apple verify answers a malformed giftCardId with 400', async () => {
    const res = await appleVerify({ giftCardId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(hooks.verifyTransaction).not.toHaveBeenCalled();
    expect(hooks.activateGiftCard).not.toHaveBeenCalled();
  });

  it('Apple ONE_TIME_CHARGE for a gift product activates without a draft', async () => {
    // Review (CodeRabbit): through the live check, as production runs it.
    vi.stubEnv('NODE_ENV', 'production');
    hooks.verifyTransaction.mockResolvedValue(appleVerification(GIFT_PLUS, 'active'));
    hooks.decodeNotificationPayload.mockResolvedValue({
      notificationType: NotificationType.OneTimeCharge,
      data: { bundleId: BUNDLE_ID, environment: 'Production', signedTransactionInfo: 'SIGNED_TX' },
    });
    hooks.decodeTransaction.mockResolvedValue({
      bundleId: BUNDLE_ID,
      productId: GIFT_PLUS,
      transactionId: 'tx-1',
      originalTransactionId: 'otx-1',
      purchaseDate: 1_700_000_000_000,
      quantity: 1,
      type: TransactionType.Consumable,
      appAccountToken: BUYER,
      price: 39990,
      currency: 'USD',
    });

    const res = await handleAppleNotification('payload');

    expect(res).toMatchObject({ handled: true, status: 'active' });
    expect(hooks.verifyTransaction).toHaveBeenCalledWith('otx-1');
    vi.unstubAllEnvs();
    expect(hooks.activateGiftCard).toHaveBeenCalledTimes(1);
    expect(hooks.activateGiftCard.mock.calls[0]![0]).toEqual({
      buyerId: BUYER,
      tier: 'plus',
      provider: 'apple',
      column: 'apple_original_transaction_id',
      paymentRef: 'otx-1',
      giftCardId: undefined,
    });
  });
});

describe('App Store gift charges against a refund', () => {
  const charge = () => {
    hooks.decodeNotificationPayload.mockResolvedValue({
      notificationType: NotificationType.OneTimeCharge,
      data: { bundleId: BUNDLE_ID, environment: 'Production', signedTransactionInfo: 'SIGNED_TX' },
    });
    hooks.decodeTransaction.mockResolvedValue({
      bundleId: BUNDLE_ID,
      productId: GIFT_PLUS,
      transactionId: 'tx-1',
      originalTransactionId: 'otx-1',
      purchaseDate: 1_700_000_000_000,
      quantity: 1,
      type: TransactionType.Consumable,
      appAccountToken: BUYER,
      price: 49990,
      currency: 'USD',
    });
  };
  afterEach(() => vi.unstubAllEnvs());

  // Review (CodeRabbit): a REFUND that came before any payment row found
  // nothing to revoke and answered 200; Apple's later retry of the charge
  // then activated a card for a refunded purchase.
  it('a ONE_TIME_CHARGE for a gift Apple has since refunded does not activate', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    charge();
    hooks.verifyTransaction.mockResolvedValue(appleVerification(GIFT_PLUS, 'expired'));

    const res = await handleAppleNotification('payload');

    expect(hooks.verifyTransaction).toHaveBeenCalledWith('otx-1');
    expect(hooks.activateGiftCard).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: true, status: 'expired' });
  });

  it('a ONE_TIME_CHARGE for a gift still paid activates after the live check', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    charge();
    hooks.verifyTransaction.mockResolvedValue(appleVerification(GIFT_PLUS, 'active'));

    await handleAppleNotification('payload');

    expect(hooks.activateGiftCard).toHaveBeenCalledTimes(1);
  });

  // Review (CodeRabbit): a card this charge already made is revoked, as
  // Stripe does, when Apple now reports the purchase refunded.
  it('a ONE_TIME_CHARGE for a gift Apple has since refunded revokes a card it already made', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    charge();
    hooks.verifyTransaction.mockResolvedValue({
      ...appleVerification(GIFT_PLUS, 'expired'),
      revocationDate: new Date('2026-11-24T00:00:00Z'),
    });

    await handleAppleNotification('payload');

    expect(hooks.revokeGiftCardForPayment).toHaveBeenCalledWith(
      'apple_original_transaction_id',
      'otx-1',
    );
    expect(hooks.activateGiftCard).not.toHaveBeenCalled();
  });

  it('a revoked gift charge whose recipient sync fails throws, so Apple retries', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    charge();
    hooks.verifyTransaction.mockResolvedValue({
      ...appleVerification(GIFT_PLUS, 'expired'),
      revocationDate: new Date('2026-11-24T00:00:00Z'),
    });
    hooks.revokeGiftCardForPayment.mockRejectedValue(new Error('sync failed'));

    await expect(handleAppleNotification('payload')).rejects.toThrow('sync failed');
  });

  // Owner chose "test cards": App Store Connect sends sandbox notifications
  // to this production endpoint, and a TestFlight purchase is free.
  it('a sandbox gift charge on the production server makes a test card', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    charge();
    hooks.decodeNotificationPayload.mockResolvedValue({
      notificationType: NotificationType.OneTimeCharge,
      data: { bundleId: BUNDLE_ID, environment: 'Sandbox', signedTransactionInfo: 'SIGNED_TX' },
    });

    await handleAppleNotification('payload');

    expect(hooks.activateGiftCard).toHaveBeenCalledWith(expect.objectContaining({ test: true }));
  });

  it('a gift charge whose live check fails throws, so Apple retries', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    charge();
    hooks.verifyTransaction.mockResolvedValue({ success: false, error: 'TRANSACTION_NOT_FOUND' });

    await expect(handleAppleNotification('payload')).rejects.toThrow('TRANSACTION_NOT_FOUND');
    expect(hooks.activateGiftCard).not.toHaveBeenCalled();
  });
});

describe('Google Play gift payments', () => {
  it('a Play license-tester gift purchase on the production server makes a test card', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const verification = googleVerification();
    hooks.verifyPurchase.mockResolvedValue({
      ...verification,
      purchaseData: { ...verification.purchaseData, purchaseType: 0 },
    });

    await googleVerify({ giftCardId: DRAFT_ID });

    vi.unstubAllEnvs();
    expect(hooks.activateGiftCard).toHaveBeenCalledWith(expect.objectContaining({ test: true }));
  });

  it('Google verify activates and consumes a gift product', async () => {
    hooks.verifyPurchase.mockResolvedValue(googleVerification());

    const res = await googleVerify({ giftCardId: DRAFT_ID });

    expect(res.status).toBe(200);
    expect(hooks.activateGiftCard).toHaveBeenCalledWith({
      buyerId: BUYER,
      tier: 'plus',
      provider: 'google',
      column: 'google_purchase_token',
      paymentRef: 'gift-token-1',
      giftCardId: DRAFT_ID,
    });
    // Review (CodeRabbit): indexOf is -1 with no write at all, which also passes.
    expect(hooks.log).toContain('payments.write');
    expect(hooks.log.indexOf('payments.write')).toBeLessThan(hooks.log.indexOf('gift.activate'));
    expect(hooks.consumeProductPurchase).toHaveBeenCalledWith(googleParams);
    // Play consumes only once the card is recorded: an unconsumed purchase
    // comes back on the next restore and is verified again.
    expect(hooks.log.indexOf('gift.activate')).toBeLessThan(hooks.log.indexOf('google.consume'));
  });

  it('a live Play gift is consumed even when handing it to its recipient fails', async () => {
    const actual = await vi.importActual<typeof import('@/libs/payment/gift/server')>(
      '@/libs/payment/gift/server',
    );
    hooks.activateGiftCard.mockImplementation(actual.activateGiftCard);
    hooks.giftDb = new GiftDb();
    hooks.giftDb.addCard({
      id: DRAFT_ID,
      buyer_id: BUYER,
      status: 'pending',
      tier: 'plus',
      recipient_email: 'friend@example.com',
    });
    hooks.rpc.mockResolvedValue({ data: null, error: { message: 'lookup failed' } });
    hooks.verifyPurchase.mockResolvedValue(googleVerification());

    const res = await googleVerify({ giftCardId: DRAFT_ID });

    expect(res.status).toBe(200);
    expect(hooks.rpc).toHaveBeenCalledWith('gift_user_id_for_email', {
      p_email: 'friend@example.com',
    });
    expect(hooks.giftDb.card(DRAFT_ID)).toMatchObject({
      status: 'active',
      google_purchase_token: 'gift-token-1',
    });
    expect(hooks.consumeProductPurchase).toHaveBeenCalledWith(googleParams);
  });

  it('a failed Play activation answers 500 and leaves the purchase unconsumed', async () => {
    hooks.verifyPurchase.mockResolvedValue(googleVerification());
    hooks.activateGiftCard.mockRejectedValue(new Error('gift card belongs to another buyer'));

    const res = await googleVerify({ giftCardId: DRAFT_ID });

    expect(res.status).toBe(500);
    expect(hooks.consumeProductPurchase).not.toHaveBeenCalled();
  });

  it('a Play restore re-verify with no giftCardId still makes a card', async () => {
    hooks.verifyPurchase.mockResolvedValue(googleVerification());

    const res = await googleVerify({});

    expect(res.status).toBe(200);
    expect(hooks.activateGiftCard).toHaveBeenCalledTimes(1);
    expect(hooks.activateGiftCard.mock.calls[0]![0]).toMatchObject({
      tier: 'plus',
      paymentRef: 'gift-token-1',
      giftCardId: undefined,
    });
    expect(hooks.consumeProductPurchase).toHaveBeenCalledWith(googleParams);
  });

  it('a pending Play gift does not activate', async () => {
    hooks.verifyPurchase.mockResolvedValue(googleVerification(2));

    const res = await googleVerify({ giftCardId: DRAFT_ID });

    expect(res.status).toBe(200);
    expect(hooks.activateGiftCard).not.toHaveBeenCalled();
  });

  it('Google verify answers a malformed giftCardId with 400', async () => {
    const res = await googleVerify({ giftCardId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(hooks.verifyPurchase).not.toHaveBeenCalled();
    expect(hooks.activateGiftCard).not.toHaveBeenCalled();
  });
});

describe('the buyer keeps their own plan', () => {
  it("the buyer's plans.plan is not written by a gift purchase", async () => {
    hooks.sessionsRetrieve.mockResolvedValue(stripeSession());
    hooks.verifyTransaction.mockResolvedValue(appleVerification(GIFT_PRO));
    hooks.verifyPurchase.mockResolvedValue(googleVerification());

    await createOrUpdatePayment(BUYER, 'cus_1', 'cs_1');
    await appleVerify({ giftCardId: DRAFT_ID });
    await googleVerify({ giftCardId: DRAFT_ID });

    expect(hooks.activateGiftCard).toHaveBeenCalledTimes(3);
    // Each path still recomputes the buyer's purchased storage, and nothing else.
    expect(hooks.planUpdates).toHaveLength(3);
    for (const update of hooks.planUpdates) {
      expect(update).not.toHaveProperty('plan');
      expect(update).not.toHaveProperty('status');
    }
  });
});
