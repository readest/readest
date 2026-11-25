import { useState } from 'react';
import { GiftPrice, GiftTier } from '@/types/gift';
import { AvailablePlan, PlanInterval, PlanType, UserPlan } from '@/types/quota';
import { getPlanDetails, getSubscriptionIntervals, getYearlySavingsPercent } from '../utils/plan';
import BillingIntervalToggle from './BillingIntervalToggle';
import PlanCard from './PlanCard';

interface PlansComparisonProps {
  availablePlans: AvailablePlan[];
  userPlan: UserPlan;
  /** Defaults to false: an unknown state shows the buy button, never hides it. */
  customizationPurchased?: boolean;
  gift?: { plan: GiftTier; activeUntil: string; giftOnly: boolean };
  giftPrices?: GiftPrice[];
  onSubscribe: (priceId?: string, planType?: PlanType) => void;
  onGiftCard?: () => void;
}

const PLAN_ORDER: UserPlan[] = ['free', 'plus', 'pro', 'purchase'];
const RECOMMENDED_PLAN: UserPlan = 'plus';

const PlansComparison: React.FC<PlansComparisonProps> = ({
  availablePlans,
  customizationPurchased = false,
  userPlan,
  gift,
  giftPrices,
  onSubscribe,
  onGiftCard,
}) => {
  const [interval, setInterval] = useState<PlanInterval>('month');

  const intervals = getSubscriptionIntervals(availablePlans);
  const savingsPercent = getYearlySavingsPercent(availablePlans);
  const selectedInterval = intervals.includes(interval) ? interval : 'month';

  const userPlanIndex = Math.max(0, PLAN_ORDER.indexOf(userPlan));
  const allPlans = PLAN_ORDER.map((plan) => getPlanDetails(plan, availablePlans, selectedInterval));

  return (
    <div className='flex flex-col gap-6'>
      <BillingIntervalToggle
        intervals={intervals}
        value={selectedInterval}
        savingsPercent={savingsPercent}
        onChange={setInterval}
      />

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        {allPlans.map((plan, index) => (
          <PlanCard
            key={plan.plan}
            plan={plan}
            interval={selectedInterval}
            isUserPlan={plan.plan === userPlan}
            recommended={plan.plan === RECOMMENDED_PLAN}
            canSwitchInterval={intervals.length > 1}
            customizationPurchased={customizationPurchased}
            // Only a gift-only holder sees the chip: beside a paid plan it would
            // read as that plan ending.
            giftUntil={gift?.giftOnly && gift.plan === plan.plan ? gift.activeUntil : undefined}
            giftOnly={gift?.plan === plan.plan ? gift.giftOnly : undefined}
            belowGift={
              !!gift?.giftOnly &&
              PLAN_ORDER.indexOf(plan.plan) > 0 &&
              PLAN_ORDER.indexOf(plan.plan) < PLAN_ORDER.indexOf(gift.plan)
            }
            // Only with a product to subscribe to. A gift-only holder can
            // subscribe to any tier, below their gift too.
            upgradable={
              index > 0 &&
              !!plan.productId &&
              (index > userPlanIndex ||
                userPlan === 'purchase' ||
                (!!gift?.giftOnly && (plan.plan === 'plus' || plan.plan === 'pro')))
            }
            giftPrices={giftPrices}
            onSubscribe={onSubscribe}
            onGiftCard={onGiftCard}
          />
        ))}
      </div>
    </div>
  );
};

export default PlansComparison;
