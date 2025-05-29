export interface UserQuota {
  free: number;
  plus: number;
  pro: number;
}

export type UserPlan = keyof UserQuota;
export type UserStorageQuota = UserQuota;
export type UserDailyTranslationQuota = UserQuota;

export type QuotaType = {
  name: string;
  tooltip: string;
  used: number;
  total: number;
  unit: string;
};
