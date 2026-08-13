import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IAPPurchase } from '@/utils/iap';

// An iOS storage purchase whose one-shot client verification never reached the
// server (network failure, app closed mid-flow) is recorded nowhere: the App
// Store webhook deliberately ignores one-time purchase events. Restore is the
// only flow that sees the transaction again, so it must send each restored
// one-time iOS purchase through the verify endpoint (deduped server-side by
// original transaction id).

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/access', () => ({ getAccessToken: mocks.getAccessToken }));
vi.mock('@/services/environment', () => ({ getNodeAPIBaseUrl: () => 'https://node.test/api' }));

import { verifyApplePurchaseProducts } from '@/libs/payment/iap/client';

const purchaseDate = '2026-08-13T01:17:01Z';

describe('verifyApplePurchaseProducts', () => {
  beforeEach(() => {
    mocks.getAccessToken.mockReset();
    mocks.getAccessToken.mockResolvedValue('jwt');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts each restored iOS one-time purchase to the verify endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const purchases: IAPPurchase[] = [
      {
        platform: 'ios',
        productId: 'com.bilingify.readest.storage.1gb.purchase',
        transactionId: '450003083195506',
        originalTransactionId: '450003083195506',
        purchaseDate,
      },
      {
        platform: 'ios',
        productId: 'com.bilingify.readest.plus.monthly',
        transactionId: 't2',
        originalTransactionId: 't2',
        purchaseDate,
      },
      {
        platform: 'android',
        productId: 'com.bilingify.readest.purchase.storage.1gb',
        orderId: 'GPA.1',
        purchaseToken: 'tok-1',
        packageName: 'com.bilingify.readest',
        purchaseDate,
      },
    ];

    await verifyApplePurchaseProducts(purchases);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://node.test/api/apple/iap-verify');
    expect(init.headers['Authorization']).toBe('Bearer jwt');
    expect(JSON.parse(init.body)).toEqual({
      transactionId: '450003083195506',
      originalTransactionId: '450003083195506',
    });
  });

  it('does nothing when no restored purchase is an iOS one-time product', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await verifyApplePurchaseProducts([
      {
        platform: 'ios',
        productId: 'com.bilingify.readest.plus.monthly',
        transactionId: 't2',
        originalTransactionId: 't2',
        purchaseDate,
      },
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
