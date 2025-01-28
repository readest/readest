export type UserStorageQuota = {
  free: number;
  plus: number;
  pro: number;
};

export type UserPlan = keyof UserStorageQuota;

export type QuotaType = {
  name: string;
  tooltip: string;
  used: number;
  total: number;
  unit: string;
};
