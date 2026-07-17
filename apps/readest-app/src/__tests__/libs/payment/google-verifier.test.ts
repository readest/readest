import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The Play Developer API client can fail for reasons that have nothing to do
// with the purchase itself (auth, network, runtime). The verifier must log the
// underlying error instead of silently mapping every failure to "not found" —
// a swallowed runtime error on the RTDN path once downgraded paying users.

const apiMocks = vi.hoisted(() => ({
  subscriptionsGet: vi.fn(),
  productsGet: vi.fn(),
}));

vi.mock('@googleapis/androidpublisher', () => ({
  androidpublisher: () => ({
    purchases: {
      subscriptions: { get: apiMocks.subscriptionsGet },
      products: { get: apiMocks.productsGet },
    },
  }),
}));

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {},
}));

import { GoogleIAPVerifier } from '@/libs/payment/iap/google/verifier';

const params = {
  orderId: 'order-1',
  purchaseToken: 'token-1',
  productId: 'com.bilingify.readest.plus.monthly',
  packageName: 'com.bilingify.readest',
};

describe('GoogleIAPVerifier.verifyPurchase', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_IAP_SERVICE_ACCOUNT_KEY', '{"client_email":"t@t","private_key":"k"}');
    apiMocks.subscriptionsGet.mockReset();
    apiMocks.productsGet.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('logs the underlying API error when verification fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const subError = new Error('workerd exploded');
    const prodError = new Error('also failed');
    apiMocks.subscriptionsGet.mockRejectedValue(subError);
    apiMocks.productsGet.mockRejectedValue(prodError);

    const result = await new GoogleIAPVerifier().verifyPurchase(params);

    expect(result.success).toBe(false);
    const logged = errorSpy.mock.calls.flat();
    expect(logged).toContain(subError);
    expect(logged).toContain(prodError);
  });

  it('still verifies an active subscription', async () => {
    apiMocks.subscriptionsGet.mockResolvedValue({
      data: {
        startTimeMillis: '1700000000000',
        expiryTimeMillis: String(Date.now() + 86_400_000),
        paymentState: 1,
        autoRenewing: true,
        orderId: 'order-1..2',
      },
    });

    const result = await new GoogleIAPVerifier().verifyPurchase(params);

    expect(result.success).toBe(true);
    expect(result.status).toBe('active');
  });
});
