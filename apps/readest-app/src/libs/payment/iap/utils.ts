import { PlanInterval, PlanType, UserPlan } from '@/types/quota';

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

export const isStoragePurchase = (productId: string): boolean => {
  return isPurchaseProduct(productId) && productId.includes('.storage');
};

export const parseStorageGB = (productId: string): number => {
  const match = productId.match(/\.([0-9]+)gb/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return 0;
};
