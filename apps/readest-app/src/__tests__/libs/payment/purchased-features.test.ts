import { describe, it, expect, vi, beforeEach } from 'vitest';

// `plans.customization_purchased` has to be derived from payments, exactly the
// way storage_purchased_bytes is, so that markPaymentRefunded -> recompute
// revokes it for free. The two stores identify the product differently: IAP
// rows carry a readable product id and no metadata, Stripe rows carry an
// opaque `prod_xxx` plus the product metadata.

const updateMock = vi.fn();
const insertMock = vi.fn();
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
          insert: (row: Record<string, unknown>) => {
            insertMock(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      return { update: (...a: unknown[]) => updateMock(...a) };
    },
  }),
}));

import {
  STORAGE_GRANTS_CUSTOMIZATION,
  shouldGrantGraceCustomization,
  updateUserStorage,
} from '@/libs/payment/storage';

const lastUpdate = () =>
  updateMock.mock.calls[0]![0] as {
    storage_purchased_bytes: number;
    customization_purchased: boolean;
  };

beforeEach(() => {
  updateMock.mockReset().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
  insertMock.mockReset();
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

// Storage buyers from before the unlock existed are grandfathered with a
// synthetic payment row rather than a flag, so the entitlement stays derived:
// `updateUserStorage` is the only writer of `customization_purchased` and
// reruns on every later purchase, which would erase a flag set by hand.
describe('updateUserStorage — grandfathered storage buyers', () => {
  const grandfatherRow = {
    storage_gb: 0,
    product_id: 'com.bilingify.readest.customization.grandfathered',
    metadata: { feature: 'customization', grandfathered: true },
  };

  it('grants customization from the grandfather row', async () => {
    paymentsRows.current = [grandfatherRow];

    await updateUserStorage('user-1');

    expect(lastUpdate().customization_purchased).toBe(true);
  });

  // The trap the synthetic row exists to avoid: recompute runs after every
  // purchase, so an entitlement held only as a flag would be wiped here.
  it('survives a later storage purchase that reruns the recompute', async () => {
    paymentsRows.current = [
      grandfatherRow,
      { storage_gb: 5, product_id: 'com.bilingify.readest.storage.5gb.purchase', metadata: null },
    ];

    await updateUserStorage('user-1');

    expect(lastUpdate().customization_purchased).toBe(true);
    expect(lastUpdate().storage_purchased_bytes).toBe(5 * 1024 * 1024 * 1024);
  });

  it('adds no storage of its own', async () => {
    paymentsRows.current = [grandfatherRow];

    await updateUserStorage('user-1');

    expect(lastUpdate().storage_purchased_bytes).toBe(0);
  });
});

// The grace flag is flipped by hand when storage add-ons stop carrying the
// premium feature set. It drives a WRITE rather than a derivation, so that
// flipping it off cannot revoke anyone who bought while it was on.
describe('storage grace grant', () => {
  it('is on today, so the grace period is live', () => {
    expect(STORAGE_GRANTS_CUSTOMIZATION).toBe(true);
  });

  it('grants while the flag is on and the buyer has storage', () => {
    expect(shouldGrantGraceCustomization(5, false, true)).toBe(true);
  });

  it('grants nothing once the flag is off', () => {
    expect(shouldGrantGraceCustomization(5, false, false)).toBe(false);
  });

  it('does not re-grant a buyer who is already entitled', () => {
    expect(shouldGrantGraceCustomization(5, true, true)).toBe(false);
  });

  it('does not grant without a storage purchase', () => {
    expect(shouldGrantGraceCustomization(0, false, true)).toBe(false);
  });

  it('writes a durable payment row for a storage buyer during the grace period', async () => {
    paymentsRows.current = [
      { storage_gb: 5, product_id: 'com.bilingify.readest.storage.5gb.purchase', metadata: null },
    ];

    await updateUserStorage('user-1');

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0]![0]).toMatchObject({
      user_id: 'user-1',
      provider: 'readest',
      storage_gb: 0,
      status: 'completed',
      metadata: expect.objectContaining({ feature: 'customization', grandfathered: true }),
    });
    expect(lastUpdate().customization_purchased).toBe(true);
    expect(lastUpdate().storage_purchased_bytes).toBe(5 * 1024 * 1024 * 1024);
  });

  it('does not write a second row for a buyer who already holds the grant', async () => {
    paymentsRows.current = [
      { storage_gb: 5, product_id: 'com.bilingify.readest.storage.5gb.purchase', metadata: null },
      {
        storage_gb: 0,
        product_id: 'com.bilingify.readest.customization.grandfathered',
        metadata: { feature: 'customization', grandfathered: true },
      },
    ];

    await updateUserStorage('user-1');

    expect(insertMock).not.toHaveBeenCalled();
    expect(lastUpdate().customization_purchased).toBe(true);
  });
});
