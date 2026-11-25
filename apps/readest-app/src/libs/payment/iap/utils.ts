import { PlanInterval, PlanType, UserPlan } from '@/types/quota';
import { GiftTier } from '@/types/gift';
import { IAPStatus } from './types';

// Statuses that still grant the user their paid plan. Anything else (expired,
// cancelled past its period, revoked, pending, on hold) falls back to `free`.
export const ENTITLED_IAP_STATUSES: IAPStatus[] = ['active', 'in_grace_period'];

export const isEntitledStatus = (status: IAPStatus): boolean =>
  ENTITLED_IAP_STATUSES.includes(status);

export const mapProductIdToUserPlan = (productId: string, isSubscription = false): UserPlan => {
  if (productId.includes('.plus')) return 'plus';
  if (productId.includes('.pro')) return 'pro';
  if (!isSubscription && productId.includes('.purchase')) return 'purchase';
  return 'free';
};

export const mapProductIdToInterval = (productId: string): PlanInterval => {
  if (productId.includes('.monthly')) return 'month';
  if (productId.includes('.yearly')) return 'year';
  return 'lifetime';
};

export const mapProductIdToPlanType = (productId: string): PlanType => {
  if (productId.includes('.purchase')) return 'purchase';
  return 'subscription';
};

export const mapProductIdToProductName = (productId: string): string => {
  if (productId.includes('.plus')) return 'Plus';
  if (productId.includes('.pro')) return 'Pro';
  if (productId.includes('.1gb')) return '1 GB';
  if (productId.includes('.2gb')) return '2 GB';
  if (productId.includes('.5gb')) return '5 GB';
  if (productId.includes('.10gb')) return '10 GB';
  return productId;
};

export const isPurchaseProduct = (productId: string): boolean => {
  return productId.includes('.purchase');
};

// The App Store and Play products, one year each; the length is in the id so
// a card of another length can have its own.
export const GIFT_PRODUCT_IDS: Record<GiftTier, string> = {
  plus: 'com.bilingify.readest.giftcard_plus_1y.purchase',
  pro: 'com.bilingify.readest.giftcard_pro_1y.purchase',
};

/**
 * A store purchase nobody paid for, reaching the live server: Apple sends
 * sandbox (TestFlight, App Review) notifications to the production endpoint,
 * and a Play license tester's purchase is free. A gift bought this way is a
 * test card. Elsewhere sandbox is how development buys, and stays real.
 */
export const isTestPurchaseInProduction = (environment: string): boolean =>
  environment === 'sandbox' && process.env.NODE_ENV === 'production';

export const isGiftProduct = (productId: string): boolean =>
  Object.values(GIFT_PRODUCT_IDS).includes(productId);

export const giftTierForProduct = (productId: string): GiftTier | null =>
  (Object.keys(GIFT_PRODUCT_IDS) as GiftTier[]).find((t) => GIFT_PRODUCT_IDS[t] === productId) ??
  null;

export const isStoragePurchase = (productId: string): boolean => {
  return isPurchaseProduct(productId) && productId.includes('.storage');
};

/**
 * Whether Play should consume a one-time product after verifying it.
 *
 * Consuming is what lets a SKU be bought again, which storage add-ons need
 * because they stack. A permanent unlock must NOT be consumed or the buyer can
 * be charged for it twice; it only needs acknowledging. This is an allowlist
 * rather than a denylist on purpose: an unrecognised product failing to be
 * repurchasable is an annoyance caught in testing, while wrongly consuming a
 * permanent unlock costs a user real money.
 * Gift cards are consumable too: they are bought repeatedly.
 */
export const isConsumablePurchase = (productId: string): boolean =>
  isStoragePurchase(productId) || isGiftProduct(productId);

export const parseStorageGB = (productId: string): number => {
  const match = productId.match(/\.([0-9]+)gb/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return 0;
};
