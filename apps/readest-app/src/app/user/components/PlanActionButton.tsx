import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { PlanType } from '@/types/quota';
import { PlanDetails } from '../utils/plan';

interface PlanActionButtonProps {
  plan: PlanDetails;
  isUserPlan: boolean;
  recommended?: boolean;
  upgradable?: boolean;
  canSwitchInterval?: boolean;
  onSubscribe: (priceId?: string, planType?: PlanType) => void;
}

const PlanActionButton: React.FC<PlanActionButtonProps> = ({
  plan,
  isUserPlan,
  recommended,
  upgradable,
  canSwitchInterval,
  onSubscribe,
}) => {
  const _ = useTranslation();

  if (upgradable && plan.plan !== 'free' && !isUserPlan) {
    return (
      <button
        onClick={() => onSubscribe(plan.productId)}
        className={clsx(
          'btn w-full',
          // btn-primary and btn-contrast collapse to the same solid fill under
          // [data-eink], so the secondary tiers use a plain bordered button —
          // the recommendation stays legible on monochrome screens too.
          recommended ? 'btn-primary' : 'eink-bordered',
        )}
      >
        {_('Upgrade to {{plan}}', { plan: _(plan.name) })}
      </button>
    );
  }

  if (isUserPlan) {
    return (
      <div className='flex flex-col gap-2'>
        <button disabled className='btn eink-bordered w-full'>
          {_('Current Plan')}
        </button>
        {/* The account's billing interval isn't carried on the session token, so
            this stays neutrally worded rather than claiming which one they are
            on. It routes to the Stripe portal, which swaps the subscription in
            place instead of stacking a second one. */}
        {canSwitchInterval && plan.plan !== 'free' && plan.productId && (
          <button
            onClick={() => onSubscribe(plan.productId)}
            className='btn btn-ghost btn-sm text-base-content/70 hover:text-base-content w-full font-normal'
          >
            {_('Change billing period')}
          </button>
        )}
      </div>
    );
  }

  return null;
};

export default PlanActionButton;
