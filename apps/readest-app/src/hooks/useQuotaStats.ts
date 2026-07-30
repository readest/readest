import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getStorageStats } from '@/libs/storage';
import { QuotaType, UserPlan } from '@/types/quota';
import { getStoragePlanData, getTranslationPlanData, getUserProfilePlan } from '@/utils/access';
import { setCachedUserPlan } from '@/services/sync/cloudSyncProvider';
import { useTranslation } from './useTranslation';

const DAILY_TRANSLATION_QUOTA = 10 * 1024 * 1024;

export const useQuotaStats = (briefName = false) => {
  const _ = useTranslation();
  const { token, user } = useAuth();
  const [quotas, setQuotas] = useState<QuotaType[]>([]);
  const [userProfilePlan, setUserProfilePlan] = useState<UserPlan | undefined>(undefined);

  useEffect(() => {
    if (!user || !token) return;

    let cancelled = false;
    const storagePlan = getStoragePlanData(token);
    const translationPlan = getTranslationPlanData(token);
    const now = new Date();
    const translationResetAt = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    );

    const buildStorageQuota = (usage: number, quota: number): QuotaType => {
      const inGB = quota > 1e9;
      return {
        name: briefName ? _('Storage') : _('Cloud Sync Storage'),
        tooltip: _('{{percentage}}% of Cloud Sync Space Used.', {
          percentage: quota > 0 ? Math.round((usage / quota) * 100) : 0,
        }),
        used: parseFloat((usage / 1024 / 1024 / (inGB ? 1024 : 1)).toFixed(2)),
        total: Math.round((quota / 1024 / 1024 / (inGB ? 1024 : 1)) * 10) / 10,
        unit: inGB ? 'GB' : 'MB',
      };
    };

    const translationQuota: QuotaType = {
      name: briefName ? _('Translation') : _('Translation Characters'),
      tooltip: _('{{percentage}}% of Daily Translation Characters Used.', {
        percentage: Math.round((translationPlan.usage / DAILY_TRANSLATION_QUOTA) * 100),
      }),
      used: parseFloat((translationPlan.usage / 1024 / 1024).toFixed(2)),
      total: 10,
      unit: 'M',
      resetAt: translationResetAt,
    };

    const setQuotaState = (storageUsage: number, storageQuota: number) => {
      if (cancelled) return;
      setQuotas([buildStorageQuota(storageUsage, storageQuota), translationQuota]);
    };

    const profilePlan = getUserProfilePlan(token);
    setUserProfilePlan(profilePlan);
    // Non-React modules (transferManager, syncCategories) need the plan
    // synchronously for the cloud-sync provider gate; cache it here, the
    // one place the plan is resolved from the JWT.
    setCachedUserPlan(profilePlan);

    // Use the token data immediately, then refresh with authoritative server
    // stats. The JWT can lag behind uploads, while /api/storage/stats reads the
    // files table used by Storage Manager.
    setQuotaState(storagePlan.usage, storagePlan.quota);
    getStorageStats()
      .then((stats) => {
        setQuotaState(stats.usage ?? stats.totalSize, stats.quota || storagePlan.quota);
      })
      .catch((error) => {
        console.warn('Failed to refresh storage quota stats:', error);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return {
    quotas,
    userProfilePlan,
  };
};
