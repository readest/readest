import { useEffect, useState } from 'react';
import { fetchAndTransformIAPPlans } from '@/libs/payment/iap/client';
import { fetchStripePlans } from '@/libs/payment/stripe/client';
import { AvailablePlan } from '@/types/quota';
import { stubTranslation as _ } from '@/utils/misc';

const IAP_PRODUCT_IDS = [
  'com.bilingify.readest.monthly.plus',
  'com.bilingify.readest.monthly.pro',
  'com.bilingify.readest.storage.1gb.purchase',
  'com.bilingify.readest.storage.2gb.purchase',
  'com.bilingify.readest.storage.5gb.purchase',
  'com.bilingify.readest.storage.10gb.purchase',
];

interface UseAvailablePlansParams {
  hasIAP: boolean;
  onError?: (message: string) => void;
}

export const useAvailablePlans = ({ hasIAP, onError }: UseAvailablePlansParams) => {
  const [availablePlans, setAvailablePlans] = useState<AvailablePlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchPlans = async () => {
      setLoading(true);
      setError(null);

      try {
        if (hasIAP) {
          const plans = await fetchAndTransformIAPPlans(IAP_PRODUCT_IDS);
          setAvailablePlans(plans);
        } else {
          const plans = await fetchStripePlans();
          setAvailablePlans(plans);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error');
        setError(error);
        console.error(`Failed to fetch ${hasIAP ? 'IAP' : 'Stripe'} plans:`, error);

        if (onError) {
          onError(_('Failed to load subscription plans.'));
        }
      } finally {
        setLoading(false);
      }
    };

    fetchPlans();
  }, [hasIAP, onError]);

  return { availablePlans, loading, error };
};
