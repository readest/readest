import { UserPlan } from '@/types/quota';
import { DEFAULT_DAILY_TRANSLATION_QUOTA, DEFAULT_STORAGE_QUOTA } from '@/services/constants';
import { getDailyUsage } from '@/services/translators/utils';

export const EMAIL_IN_PLANS: readonly UserPlan[] = [];
export const STORAGE_QUOTA_GRACE_BYTES = 10 * 1024 * 1024;

export const isEmailInPlan = (_plan: UserPlan): boolean => false;

export const getSubscriptionPlan = (_token: string): UserPlan => 'free';

export const getUserProfilePlan = (_token: string): UserPlan => 'free';

export const getStoragePlanData = (_token: string) => ({
  plan: 'free' as UserPlan,
  usage: 0,
  quota: DEFAULT_STORAGE_QUOTA['free'],
});

export const getTranslationQuota = (_plan: UserPlan): number =>
  DEFAULT_DAILY_TRANSLATION_QUOTA.free;

export const getTranslationPlanData = (_token: string) => ({
  plan: 'free' as UserPlan,
  usage: getDailyUsage() || 0,
  quota: getTranslationQuota('free'),
});

export const getDailyTranslationPlanData = (_token: string) => ({
  plan: 'free' as UserPlan,
  quota: getTranslationQuota('free'),
});

export const getAccessToken = async (): Promise<string | null> => null;

export const getUserID = async (): Promise<string | null> => null;

export const validateUserAndToken = async (_authHeader: string | null | undefined) => ({});
