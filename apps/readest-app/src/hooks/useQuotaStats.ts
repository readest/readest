import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { QuotaType, UserPlan } from '@/types/quota';
import {
  getCustomizationPurchased,
  getStoragePlanData,
  getTranslationPlanData,
  getUserProfilePlan,
} from '@/utils/access';
import {
  setCachedCustomizationPurchased,
  setCachedUserPlan,
} from '@/services/sync/cloudSyncProvider';
import { useTranslation } from './useTranslation';

export const useQuotaStats = (briefName = false) => {
  const _ = useTranslation();
  const { token, user } = useAuth();
  const [quotas, setQuotas] = useState<QuotaType[]>([]);
  const [userProfilePlan, setUserProfilePlan] = useState<UserPlan | undefined>(undefined);
  // Derived, not state: state lags one render behind a token change, which
  // would briefly report the previous account's entitlement after a switch or
  // a sign-out.
  const customizationPurchased = useMemo(
    () => (token ? getCustomizationPurchased(token) : false),
    [token],
  );

  useEffect(() => {
    if (!user || !token) {
      // Signing out must clear the module-level caches. They are read
      // synchronously by non-React gates, so a stale entitlement would leave a
      // signed-out session looking premium. Falling back to the restrictive
      // side matches how these caches are documented to behave before the
      // first auth resolution.
      setUserProfilePlan(undefined);
      setCachedUserPlan(undefined);
      setCachedCustomizationPurchased(false);
      return;
    }

    const storagPlan = getStoragePlanData(token);
    const inGB = storagPlan.quota > 1e9;
    const storageQuota: QuotaType = {
      name: briefName ? _('Storage') : _('Cloud Sync Storage'),
      tooltip: _('{{percentage}}% of Cloud Sync Space Used.', {
        percentage: Math.round((storagPlan.usage / storagPlan.quota) * 100),
      }),
      used: parseFloat((storagPlan.usage / 1024 / 1024 / (inGB ? 1024 : 1)).toFixed(2)),
      total: Math.round((storagPlan.quota / 1024 / 1024 / (inGB ? 1024 : 1)) * 10) / 10,
      unit: inGB ? 'GB' : 'MB',
    };
    const translationPlan = getTranslationPlanData(token);
    const now = new Date();
    const translationResetAt = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    );
    const translationQuota: QuotaType = {
      name: briefName ? _('Translation') : _('Translation Characters'),
      tooltip: _('{{percentage}}% of Daily Translation Characters Used.', {
        percentage: Math.round((translationPlan.usage / translationPlan.quota) * 100),
      }),
      used: Math.round(translationPlan.usage / 1024),
      total: Math.round(translationPlan.quota / 1024),
      unit: 'K',
      resetAt: translationResetAt,
    };
    const profilePlan = getUserProfilePlan(token);
    setUserProfilePlan(profilePlan);
    // Non-React modules (transferManager, syncCategories) need the plan
    // synchronously for the cloud-sync provider gate; cache it here, the
    // one place the plan is resolved from the JWT.
    setCachedUserPlan(profilePlan);
    setCachedCustomizationPurchased(customizationPurchased);
    setQuotas([storageQuota, translationQuota]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, customizationPurchased]);

  return {
    quotas,
    userProfilePlan,
    customizationPurchased,
  };
};
