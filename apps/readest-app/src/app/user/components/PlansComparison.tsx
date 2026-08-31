import { useState } from 'react';
import { AvailablePlan, PlanInterval, PlanType, UserPlan } from '@/types/quota';
import { getPlanDetails, getSubscriptionIntervals, getYearlySavingsPercent } from '../utils/plan';
import BillingIntervalToggle from './BillingIntervalToggle';
import PlanCard from './PlanCard';

interface PlansComparisonProps {
  availablePlans: AvailablePlan[];
  userPlan: UserPlan;
  onSubscribe: (priceId?: string, planType?: PlanType) => void;
}

const PLAN_ORDER: UserPlan[] = ['free', 'plus', 'pro', 'purchase'];
const RECOMMENDED_PLAN: UserPlan = 'plus';

const PlansComparison: React.FC<PlansComparisonProps> = ({
  availablePlans,
  userPlan,
  onSubscribe,
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
            upgradable={index > 0 && (index > userPlanIndex || userPlan === 'purchase')}
            onSubscribe={onSubscribe}
          />
        ))}
      </div>
    </div>
  );
};

export default PlansComparison;
