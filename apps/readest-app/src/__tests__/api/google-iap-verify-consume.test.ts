import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Storage add-ons are consumable one-time products: users buy the same SKU
// repeatedly to stack storage. Google Play blocks repurchase of an owned
// (acknowledged but unconsumed) product with ITEM_ALREADY_OWNED, so the verify
// route must consume product purchases after recording them — and must never
// consume subscriptions.

const mocks = vi.hoisted(() => ({
  validateUserAndToken: vi.fn(),
  verifyPurchase: vi.fn(),
  acknowledgePurchase: vi.fn(),
  consumeProductPurchase: vi.fn(),
  processPurchaseData: vi.fn(),
}));

vi.mock('@/utils/access', () => ({
  validateUserAndToken: mocks.validateUserAndToken,
}));

vi.mock('@/libs/payment/iap/google/verifier', () => ({
  getGoogleIAPVerifier: () => ({
    verifyPurchase: mocks.verifyPurchase,
    acknowledgePurchase: mocks.acknowledgePurchase,
    consumeProductPurchase: mocks.consumeProductPurchase,
  }),
}));

vi.mock('@/libs/payment/iap/google/server', () => ({
  processPurchaseData: mocks.processPurchaseData,
}));

import { POST } from '@/app/api/google/iap-verify/route';

const verifyParams = {
  packageName: 'com.bilingify.readest',
  productId: 'com.bilingify.readest.purchase.storage.1gb',
  orderId: 'GPA.1111-2222-3333-44444',
  purchaseToken: 'storage-token-1',
};

const postVerify = async (body: Record<string, string>) => {
  const request = new NextRequest('http://localhost:3000/api/google/iap-verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify(body),
  });
  return POST(request);
};

describe('/api/google/iap-verify consumption', () => {
  beforeEach(() => {
    mocks.validateUserAndToken.mockReset();
    mocks.verifyPurchase.mockReset();
    mocks.acknowledgePurchase.mockReset();
    mocks.consumeProductPurchase.mockReset();
    mocks.processPurchaseData.mockReset();

    mocks.validateUserAndToken.mockResolvedValue({
      user: { id: 'user-1', email: 'u@example.com' },
      token: 'test-token',
    });
    mocks.processPurchaseData.mockResolvedValue({
      platform: 'android',
      status: 'active',
      productId: verifyParams.productId,
      orderId: verifyParams.orderId,
    });
    mocks.acknowledgePurchase.mockResolvedValue(undefined);
    mocks.consumeProductPurchase.mockResolvedValue(undefined);
  });

  it('consumes a verified one-time product instead of acknowledging it', async () => {
    mocks.verifyPurchase.mockResolvedValue({
      success: true,
      status: 'active',
      purchaseType: 'product',
      purchaseData: { purchaseState: 0, consumptionState: 0, acknowledgementState: 0 },
    });

    const response = await postVerify(verifyParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.purchase).toBeDefined();
    expect(mocks.consumeProductPurchase).toHaveBeenCalledTimes(1);
    expect(mocks.consumeProductPurchase).toHaveBeenCalledWith(verifyParams);
    expect(mocks.acknowledgePurchase).not.toHaveBeenCalled();
  });

  it('consumes an already-acknowledged product purchase (stuck pre-fix purchases)', async () => {
    mocks.verifyPurchase.mockResolvedValue({
      success: true,
      status: 'active',
      purchaseType: 'product',
      purchaseData: { purchaseState: 0, consumptionState: 0, acknowledgementState: 1 },
    });

    const response = await postVerify(verifyParams);

    expect(response.status).toBe(200);
    expect(mocks.consumeProductPurchase).toHaveBeenCalledTimes(1);
  });

  it('does not consume a pending product purchase', async () => {
    mocks.verifyPurchase.mockResolvedValue({
      success: true,
      status: 'cancelled',
      purchaseType: 'product',
      purchaseData: { purchaseState: 2, consumptionState: 0, acknowledgementState: 0 },
    });

    const response = await postVerify(verifyParams);

    expect(response.status).toBe(200);
    expect(mocks.consumeProductPurchase).not.toHaveBeenCalled();
  });

  it('does not consume a product that is already consumed', async () => {
    mocks.verifyPurchase.mockResolvedValue({
      success: true,
      status: 'active',
      purchaseType: 'product',
      purchaseData: { purchaseState: 0, consumptionState: 1, acknowledgementState: 1 },
    });

    const response = await postVerify(verifyParams);

    expect(response.status).toBe(200);
    expect(mocks.consumeProductPurchase).not.toHaveBeenCalled();
    expect(mocks.acknowledgePurchase).not.toHaveBeenCalled();
  });

  it('acknowledges subscriptions and never consumes them', async () => {
    mocks.verifyPurchase.mockResolvedValue({
      success: true,
      status: 'active',
      purchaseType: 'subscription',
      purchaseData: { paymentState: 1, acknowledgementState: 0 },
    });

    const response = await postVerify({
      ...verifyParams,
      productId: 'com.bilingify.readest.plus.monthly',
    });

    expect(response.status).toBe(200);
    expect(mocks.acknowledgePurchase).toHaveBeenCalledTimes(1);
    expect(mocks.consumeProductPurchase).not.toHaveBeenCalled();
  });
});
