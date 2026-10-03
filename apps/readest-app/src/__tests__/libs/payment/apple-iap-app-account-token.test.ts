import { describe, it, expect, vi, beforeEach } from 'vitest';

// Apple's transaction carries no user id, so a purchase recorded server-side
// (via the ONE_TIME_CHARGE notification) is attributable only through
// `appAccountToken`. StoreKit requires it to be a UUID, which is exactly the
// shape of a Supabase user id. Without it, a purchase whose client-side
// verification never lands cannot be credited to anyone.

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const accessMocks = vi.hoisted(() => ({ getUserID: vi.fn(), getAccessToken: vi.fn() }));
vi.mock('@/utils/access', () => accessMocks);

import { purchaseIAPProduct } from '@/libs/payment/iap/client';

const USER_ID = 'e22f3863-a874-4e09-9524-f1c1810ec0d1';
const PRODUCT = 'com.bilingify.readest.storage.5gb.purchase';

const payloadOf = (call: unknown[]) => (call[1] as { payload: Record<string, unknown> }).payload;

beforeEach(() => {
  invokeMock.mockReset();
  accessMocks.getUserID.mockReset();
  invokeMock.mockResolvedValue({ purchase: { platform: 'ios', productId: PRODUCT } });
});

describe('purchaseIAPProduct — appAccountToken', () => {
  it('tags the purchase with the signed-in user id', async () => {
    accessMocks.getUserID.mockResolvedValue(USER_ID);

    await purchaseIAPProduct(PRODUCT);

    expect(invokeMock).toHaveBeenCalledWith(
      'plugin:native-bridge|iap_purchase_product',
      expect.anything(),
    );
    expect(payloadOf(invokeMock.mock.calls[0]!)).toEqual({
      productId: PRODUCT,
      appAccountToken: USER_ID,
    });
  });

  it('sends a UUID, which is what StoreKit requires to surface the token', async () => {
    accessMocks.getUserID.mockResolvedValue(USER_ID);

    await purchaseIAPProduct(PRODUCT);

    expect(payloadOf(invokeMock.mock.calls[0]!)['appAccountToken']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('still purchases when the user id is unavailable', async () => {
    accessMocks.getUserID.mockResolvedValue(null);

    await purchaseIAPProduct(PRODUCT);

    expect(payloadOf(invokeMock.mock.calls[0]!)).toEqual({ productId: PRODUCT });
  });
});
