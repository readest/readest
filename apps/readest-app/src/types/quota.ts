export interface UserQuota {
  free: number;
  plus: number;
  pro: number;
  purchase: number;
}

export type UserStorageQuota = UserQuota;
export type UserDailyTranslationQuota = UserQuota;
export type QuotaType = {
  name: string;
  tooltip: string;
  used: number;
  total: number;
  unit: string;
};

export type QuotaFeature = 'storage' | 'translation' | 'tokens' | 'customization' | 'generic';

export type UserPlan = keyof UserQuota;
export type PlanType = 'subscription' | 'purchase';
export type PlanInterval = 'month' | 'year' | 'lifetime';
export type AvailablePlan = {
  plan: UserPlan;
  productId: string;
  price: number; // in cents
  currency: string;
  interval: PlanInterval;
  productName: string;
};
