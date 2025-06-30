import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { QuotaType, UserPlan } from '@/types/user';
import { getStoragePlanData, getTranslationPlanData, getUserPlan } from '@/utils/access';
import { useTranslation } from './useTranslation';

export const useQuotaStats = () => {
  const _ = useTranslation();
  const { token, user } = useAuth();
  const [quotas, setQuotas] = useState<QuotaType[]>([]);
  const [userPlan, setUserPlan] = useState<UserPlan>('free');

  useEffect(() => {
    if (!user || !token) return;

    const userPlan = getUserPlan(token);
    const storagPlan = getStoragePlanData(token);
    const storageQuota: QuotaType = {
      name: _('Cloud Sync Storage'),
      tooltip: _('{{percentage}}% of Cloud Sync Space Used.', {
        percentage: Math.round((storagPlan.usage / storagPlan.quota) * 100),
      }),
      used: Math.round(storagPlan.usage / 1024 / 1024),
      total: Math.round(storagPlan.quota / 1024 / 1024),
      unit: 'MB',
    };
    const translationPlan = getTranslationPlanData(token);
    const translationQuota: QuotaType = {
      name: _('Translation Characters'),
      tooltip: _('{{percentage}}% of Daily Translation Characters Used.', {
        percentage: Math.round((translationPlan.usage / translationPlan.quota) * 100),
      }),
      used: Math.round(translationPlan.usage / 1024),
      total: Math.round(translationPlan.quota / 1024),
      unit: 'K',
    };
    setUserPlan(userPlan);
    setQuotas([storageQuota, translationQuota]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return {
    quotas,
    userPlan,
  };
};
