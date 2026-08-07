import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IAPPurchase } from '@/utils/iap';

// Storage purchases bought before the server learned to consume them stay
// "owned" on Google Play forever, blocking repurchase. Restore is the only
// flow that sees those stuck purchases, so it must send each restored one-time
// Android purchase through the verify endpoint (which consumes it server-side).

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/access', () => ({ getAccessToken: mocks.getAccessToken }));
vi.mock('@/services/environment', () => ({ getNodeAPIBaseUrl: () => 'https://node.test/api' }));

import { verifyGooglePurchaseProducts } from '@/libs/payment/iap/client';

const purchaseDate = '2026-08-01T00:00:00Z';

describe('verifyGooglePurchaseProducts', () => {
  beforeEach(() => {
    mocks.getAccessToken.mockReset();
    mocks.getAccessToken.mockResolvedValue('jwt');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts each restored Android one-time purchase to the verify endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const purchases: IAPPurchase[] = [
      {
        platform: 'android',
        productId: 'com.bilingify.readest.purchase.storage.1gb',
        orderId: 'GPA.1',
        purchaseToken: 'tok-1',
        packageName: 'com.bilingify.readest',
        purchaseDate,
      },
      {
        platform: 'android',
        productId: 'com.bilingify.readest.plus.monthly',
        orderId: 'GPA.2',
        purchaseToken: 'tok-2',
        packageName: 'com.bilingify.readest',
        purchaseDate,
      },
      {
        platform: 'ios',
        productId: 'com.bilingify.readest.purchase.storage.1gb',
        transactionId: 't1',
        originalTransactionId: 't0',
        purchaseDate,
      },
    ];

    await verifyGooglePurchaseProducts(purchases);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://node.test/api/google/iap-verify');
    expect(init.headers['Authorization']).toBe('Bearer jwt');
    expect(JSON.parse(init.body)).toEqual({
      packageName: 'com.bilingify.readest',
      productId: 'com.bilingify.readest.purchase.storage.1gb',
      orderId: 'GPA.1',
      purchaseToken: 'tok-1',
    });
  });

  it('does nothing when no restored purchase is an Android one-time product', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await verifyGooglePurchaseProducts([
      {
        platform: 'android',
        productId: 'com.bilingify.readest.plus.monthly',
        orderId: 'GPA.2',
        purchaseToken: 'tok-2',
        packageName: 'com.bilingify.readest',
        purchaseDate,
      },
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
