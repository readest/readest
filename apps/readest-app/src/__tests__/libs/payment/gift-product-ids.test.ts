// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  GIFT_PRODUCT_IDS,
  isGiftProduct,
  giftTierForProduct,
  mapProductIdToUserPlan,
  isPurchaseProduct,
  isConsumablePurchase,
  isStoragePurchase,
  parseStorageGB,
} from '@/libs/payment/iap/utils';

describe('gift product ids', () => {
  // The store products carry their length (owner chose "Add _1y to the IDs"),
  // so a future half-year or two-year card gets its own id.
  it.each([
    ['plus', 'com.bilingify.readest.giftcard_plus_1y.purchase'],
    ['pro', 'com.bilingify.readest.giftcard_pro_1y.purchase'],
  ] as const)('%s', (tier, id) => {
    expect(GIFT_PRODUCT_IDS[tier]).toBe(id);
    expect(isGiftProduct(id)).toBe(true);
    expect(mapProductIdToUserPlan(id, true)).toBe('free');
    expect(['plus', 'pro']).not.toContain(mapProductIdToUserPlan(id));
    expect(isPurchaseProduct(id)).toBe(true);
    expect(isConsumablePurchase(id)).toBe(true);
    expect(isStoragePurchase(id)).toBe(false);
    expect(parseStorageGB(id)).toBe(0);
    expect(giftTierForProduct(id)).toBe(tier);
  });

  it('does not treat other products as gifts', () => {
    expect(giftTierForProduct('com.bilingify.readest.yearly.plus')).toBeNull();
    expect(isGiftProduct('com.bilingify.readest.yearly.plus')).toBe(false);
    expect(isConsumablePurchase('com.bilingify.readest.customization.purchase')).toBe(false);
  });
});
