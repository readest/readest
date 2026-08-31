import { describe, it, expect, vi, beforeEach } from 'vitest';

// `plans.customization_purchased` has to be derived from payments, exactly the
// way storage_purchased_bytes is, so that markPaymentRefunded -> recompute
// revokes it for free. The two stores identify the product differently: IAP
// rows carry a readable product id and no metadata, Stripe rows carry an
// opaque `prod_xxx` plus the product metadata.

const updateMock = vi.fn();
const paymentsRows = { current: [] as Record<string, unknown>[] };

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'payments') {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: paymentsRows.current, error: null }),
            }),
          }),
        };
      }
      return { update: (...a: unknown[]) => updateMock(...a) };
    },
  }),
}));

import { updateUserStorage } from '@/libs/payment/storage';

const lastUpdate = () =>
  updateMock.mock.calls[0]![0] as {
    storage_purchased_bytes: number;
    customization_purchased: boolean;
  };

beforeEach(() => {
  updateMock.mockReset().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
  paymentsRows.current = [];
});

describe('updateUserStorage — purchased features', () => {
  it('grants customization from an IAP purchase, identified by product id', async () => {
    paymentsRows.current = [
      { storage_gb: 0, product_id: 'com.bilingify.readest.customization.purchase', metadata: null },
    ];

    await updateUserStorage('user-1');

    expect(lastUpdate().customization_purchased).toBe(true);
  });

  it('grants customization from a Stripe purchase, identified by product metadata', async () => {
    // Stripe stores an opaque product id, so a name match would miss this.
    paymentsRows.current = [
      {
        storage_gb: 0,
        product_id: 'prod_QxYz123',
        metadata: { plan: 'purchase', feature: 'customization' },
      },
    ];

    await updateUserStorage('user-1');

    expect(lastUpdate().customization_purchased).toBe(true);
  });

  it('does not grant customization from a storage-only purchase', async () => {
    paymentsRows.current = [
      { storage_gb: 5, product_id: 'com.bilingify.readest.storage.5gb.purchase', metadata: null },
      {
        storage_gb: 1,
        product_id: 'prod_Storage1',
        metadata: { plan: 'purchase', feature: 'storage' },
      },
    ];

    await updateUserStorage('user-1');

    expect(lastUpdate().customization_purchased).toBe(false);
    expect(lastUpdate().storage_purchased_bytes).toBe(6 * 1024 * 1024 * 1024);
  });

  it('revokes customization once the payment no longer counts as completed', async () => {
    // markPaymentRefunded flips the row to `refunded`, which drops it from the
    // COMPLETED_PAYMENT_STATUSES filter — so the recompute sees nothing.
    paymentsRows.current = [];

    await updateUserStorage('user-1');

    expect(lastUpdate().customization_purchased).toBe(false);
    expect(lastUpdate().storage_purchased_bytes).toBe(0);
  });

  it('still returns the purchased storage total', async () => {
    paymentsRows.current = [
      { storage_gb: 2, product_id: 'com.bilingify.readest.storage.2gb.purchase', metadata: null },
    ];

    await expect(updateUserStorage('user-1')).resolves.toBe(2);
  });
});
