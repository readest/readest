import { IoCheckmark } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { PlanDetails } from '../utils/plan';
import PlanActionButton from './PlanActionButton';

interface PlanCardProps {
  plan: PlanDetails;
  isUserPlan: boolean;
  comingSoon?: boolean;
  upgradable?: boolean;
  index: number;
  currentPlanIndex: number;
  onSubscribe: (priceId?: string) => void;
  onPlanSwipe: (direction: 'left' | 'right') => void;
}

const PlanCard: React.FC<PlanCardProps> = ({
  plan,
  isUserPlan,
  comingSoon,
  upgradable,
  index,
  currentPlanIndex,
  onSubscribe,
  onPlanSwipe,
}) => {
  const _ = useTranslation();

  return (
    <div
      key={plan.plan}
      className='w-full min-w-72 max-w-96 flex-shrink-0 p-6'
      style={{ scrollSnapAlign: 'start' }}
    >
      <div
        className={`rounded-xl border-2 p-6 ${plan.color} ${index === currentPlanIndex ? 'ring-2 ring-blue-500' : ''}`}
      >
        <div className='mb-6 text-center'>
          <h4 className='mb-2 text-2xl font-bold'>{_(plan.name)}</h4>
          <div className='text-3xl font-bold'>
            {`$${(plan.price / 100).toFixed(2)}`}
            <span className='text-lg font-normal'>/{_(plan.interval)}</span>
          </div>
          {isUserPlan && (
            <div className='mt-3'>
              <span className='inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800'>
                <IoCheckmark className='mr-1 h-4 w-4' />
                {_('Current Plan')}
              </span>
            </div>
          )}
        </div>

        <div className='mb-6 space-y-3'>
          {plan.features.map((feature, featureIndex) => (
            <div key={featureIndex} className='flex items-center'>
              <IoCheckmark className='mr-3 h-5 w-5 flex-shrink-0 text-green-500' />
              <span>{_(feature)}</span>
            </div>
          ))}
        </div>

        <div className='mb-6 rounded-lg bg-white/50 p-4'>
          <h5 className='mb-3 font-semibold'>{_('Plan Limits')}</h5>
          <div className='space-y-2'>
            {Object.entries(plan.limits).map(([key, value]) => (
              <div key={key} className='flex justify-between text-sm'>
                <span>{_(key)}:</span>
                <span className='font-medium'>{value}</span>
              </div>
            ))}
          </div>
        </div>

        <PlanActionButton
          plan={plan}
          comingSoon={comingSoon}
          upgradable={upgradable}
          isUserPlan={isUserPlan}
          onSubscribe={onSubscribe}
          onPlanSwipe={onPlanSwipe}
        />
      </div>
    </div>
  );
};

export default PlanCard;
