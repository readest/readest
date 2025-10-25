export interface UserQuota {
  free: number;
  plus: number;
  pro: number;
  purchase: number;
}

export type UserPlan = keyof UserQuota;
export type UserStorageQuota = UserQuota;
export type UserDailyTranslationQuota = UserQuota;

export type PlanType = 'subscription' | 'purchase';
export type QuotaType = {
  name: string;
  tooltip: string;
  used: number;
  total: number;
  unit: string;
};

export type QuotaFeature = 'storage' | 'translation' | 'tokens' | 'customization' | 'generic';
