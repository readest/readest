import { IoCheckmark } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { getLocale } from '@/utils/misc';
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
  onSelectPlan: (index: number) => void;
}

const PlanCard: React.FC<PlanCardProps> = ({
  plan,
  isUserPlan,
  comingSoon,
  upgradable,
  index,
  currentPlanIndex,
  onSubscribe,
  onSelectPlan,
}) => {
  const _ = useTranslation();
  const { price, currency } = plan;
  const formattedPrice = new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(
    price / 100,
  );

  return (
    <div
      key={plan.plan}
      className='w-full flex-shrink-0 p-6 sm:min-w-96 sm:max-w-96'
      style={{ scrollSnapAlign: 'start' }}
    >
      <div
        className={`rounded-xl border-2 p-4 ${plan.color} ${index === currentPlanIndex ? 'ring-2 ring-blue-500' : ''}`}
      >
        <div className='mb-6 text-center'>
          <h4 className='mb-2 text-2xl font-bold'>{_(plan.name)}</h4>
          <div className='text-3xl font-bold'>
            {formattedPrice}
            <span className='text-lg font-normal'>/{_(plan.interval)}</span>
          </div>
        </div>

        <div className='mb-6 space-y-3' onClick={() => onSelectPlan(index)}>
          {plan.features.map((feature, featureIndex) => (
            <div key={featureIndex} className='flex flex-col'>
              <div className='flex items-center gap-2'>
                <IoCheckmark className='h-5 w-5 flex-shrink-0 text-green-500' />
                <span>{_(feature.label)}</span>
              </div>
              {feature.description && (
                <div className={`ms-7 text-sm sm:text-xs ${plan.hintColor}`}>
                  {_(feature.description)}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className='mb-6 rounded-lg bg-white/50 p-4' onClick={() => onSelectPlan(index)}>
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
          onSelectPlan={onSelectPlan}
        />
      </div>
    </div>
  );
};

export default PlanCard;
