import { useTranslation } from '@/hooks/useTranslation';
import { PlanDetails } from '../utils/plan';

interface PlanActionButtonProps {
  plan: PlanDetails;
  isUserPlan: boolean;
  comingSoon?: boolean;
  upgradable?: boolean;
  onSubscribe: (priceId?: string) => void;
  onSelectPlan: (index: number) => void;
}

const PlanActionButton: React.FC<PlanActionButtonProps> = ({
  plan,
  isUserPlan,
  comingSoon,
  upgradable,
  onSubscribe,
  onSelectPlan,
}) => {
  const _ = useTranslation();

  if (upgradable && plan.plan !== 'free' && !isUserPlan) {
    if (comingSoon) {
      return (
        <button
          disabled
          className='w-full cursor-default rounded-lg bg-gray-200 px-6 py-3 font-semibold text-gray-500'
        >
          {_('Coming Soon')}
        </button>
      );
    }
    return (
      <button
        onClick={() => onSubscribe(plan.price_id)}
        className='w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700'
      >
        {_('Upgrade to {{plan}}', { plan: _(plan.name) })}
      </button>
    );
  }

  if (plan.plan === 'free' && isUserPlan) {
    return (
      <button
        onClick={() => onSelectPlan(1)}
        className='w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700'
      >
        {_('Upgrade to Plus or Pro')}
      </button>
    );
  }

  if (isUserPlan) {
    return (
      <button
        disabled
        className='w-full cursor-default rounded-lg bg-green-100 px-6 py-3 font-semibold text-green-700'
      >
        {_('Current Plan')}
      </button>
    );
  }

  return null;
};

export default PlanActionButton;
