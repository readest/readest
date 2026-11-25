// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  fetchIAPProducts: vi.fn(),
}));

vi.mock('@/utils/access', () => ({ getAccessToken: mocks.getAccessToken }));
vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => 'https://web.test/api',
  getNodeAPIBaseUrl: () => 'https://node.test/api',
}));
vi.mock('@/libs/payment/iap/client', () => ({ fetchIAPProducts: mocks.fetchIAPProducts }));

import {
  fetchGiftPrices,
  getGiftRedeemLink,
  redeemGiftCode,
  verifyGiftIAPPurchase,
} from '@/libs/payment/gift/client';
import { READEST_WEB_BASE_URL } from '@/services/constants';

describe('gift client', () => {
  beforeEach(() => {
    mocks.getAccessToken.mockReset();
    mocks.getAccessToken.mockResolvedValue('jwt');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('getGiftRedeemLink normalizes the code', () => {
    expect(getGiftRedeemLink('abcd-efgh-ijkl-mnop')).toBe(
      `${READEST_WEB_BASE_URL}/user?gift=ABCDEFGH1JK1MN0P`,
    );
  });

  it('fetchGiftPrices(true) maps IAP products to tiers', async () => {
    mocks.fetchIAPProducts.mockResolvedValue([
      {
        id: 'com.bilingify.readest.giftcard_pro_1y.purchase',
        title: 'Pro',
        description: '',
        price: '$79.99',
        priceCurrencyCode: 'USD',
        priceAmountMicros: 79990000,
      },
    ]);
    expect(await fetchGiftPrices(true)).toEqual([
      {
        tier: 'pro',
        productId: 'com.bilingify.readest.giftcard_pro_1y.purchase',
        price: 7999,
        currency: 'USD',
      },
    ]);
  });

  it('redeemGiftCode throws invalid_or_used on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'invalid_or_used' }) }),
    );
    await expect(redeemGiftCode('ABC')).rejects.toThrow('invalid_or_used');
  });

  it('verifyGiftIAPPurchase posts the iOS body with giftCardId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await verifyGiftIAPPurchase(
      {
        platform: 'ios',
        productId: 'p',
        purchaseDate: 'd',
        transactionId: 't',
        originalTransactionId: 'o',
      },
      'gid',
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://node.test/api/apple/iap-verify');
    expect(JSON.parse(init.body)).toEqual({
      transactionId: 't',
      originalTransactionId: 'o',
      giftCardId: 'gid',
    });
  });
});
