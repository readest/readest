export type UserStorageQuota = {
  free: number;
  plus: number;
  pro: number;
};

export type UserPlan = keyof UserStorageQuota;
