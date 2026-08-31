import clsx from 'clsx';
import { IoCheckmark } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { getLocale } from '@/utils/misc';
import { PlanDetails } from '../utils/plan';
import { PlanInterval, PlanType } from '@/types/quota';
import PlanActionButton from './PlanActionButton';
import PurchaseCallToActions from './PurchaseCallToActions';

interface PlanCardProps {
  plan: PlanDetails;
  interval: PlanInterval;
  isUserPlan: boolean;
  recommended?: boolean;
  upgradable?: boolean;
  canSwitchInterval?: boolean;
  onSubscribe: (priceId?: string, planType?: PlanType) => void;
}

const PlanCard: React.FC<PlanCardProps> = ({
  plan,
  interval,
  isUserPlan,
  recommended,
  upgradable,
  canSwitchInterval,
  onSubscribe,
}) => {
  const _ = useTranslation();
  const { price, currency } = plan;

  const formatPrice = (amountInCents: number) =>
    new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(amountInCents / 100);

  const isYearly = plan.type === 'subscription' && interval === 'year';
  // Yearly plans lead with the per-month equivalent — the figure people compare
  // against the monthly price — with the amount actually charged underneath.
  const headlinePrice = formatPrice(isYearly ? price / 12 : price);

  const renderPriceCaption = () => {
    if (plan.plan === 'free') return _('Free forever');
    if (isYearly) return _('{{price}} billed yearly', { price: formatPrice(price) });
    return null;
  };

  return (
    <div
      className={clsx(
        'bg-base-100 eink-bordered flex h-full flex-col rounded-lg border p-4',
        recommended ? 'border-base-content/25' : 'border-base-200',
      )}
    >
      <div className='mb-4 flex items-center justify-between gap-2'>
        <span
          className={clsx('rounded-full px-3 py-1 text-sm font-medium', plan.color)}
          data-plan={plan.plan}
        >
          {_(plan.name)}
        </span>
        {recommended && (
          <span className='text-base-content/60 text-xs font-semibold whitespace-nowrap uppercase'>
            {_('Popular')}
          </span>
        )}
      </div>

      <div className='mb-5'>
        {plan.plan !== 'purchase' ? (
          <>
            <div className='text-base-content flex items-baseline gap-1'>
              <span className='text-3xl font-bold'>{headlinePrice}</span>
              <span className='text-base-content/60 text-sm font-normal'>/{_('month')}</span>
            </div>
            <div className={clsx('mt-1 min-h-5 text-xs', plan.hintColor)}>
              {renderPriceCaption()}
            </div>
          </>
        ) : (
          <div className='text-base-content flex min-h-[3.25rem] items-center text-lg font-semibold'>
            {_('On-Demand Purchase')}
          </div>
        )}
      </div>

      <div className='mb-5 space-y-3'>
        {plan.features.map((feature, featureIndex) => (
          <div key={featureIndex} className='flex flex-col'>
            <div className='text-base-content flex items-start gap-2 text-sm'>
              <IoCheckmark className='mt-0.5 h-4 w-4 shrink-0' />
              <span>{_(feature.label)}</span>
            </div>
            {feature.description && (
              <div className={clsx('ms-6 text-xs', plan.hintColor)}>{_(feature.description)}</div>
            )}
          </div>
        ))}
      </div>

      {plan.limits && Object.keys(plan.limits).length > 0 && (
        <div className='bg-base-200/60 mb-5 rounded-lg p-3'>
          <h5 className='text-base-content mb-2 text-xs font-semibold'>{_('Plan Limits')}</h5>
          <div className='space-y-1.5'>
            {Object.entries(plan.limits).map(([key, value]) => (
              <div key={key} className='flex justify-between gap-2 text-xs'>
                <span className={plan.hintColor}>{_(key)}</span>
                <span className='text-base-content shrink-0 font-medium whitespace-nowrap'>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className='mt-auto'>
        {plan.plan === 'purchase' ? (
          <PurchaseCallToActions plan={plan} onSubscribe={onSubscribe} />
        ) : (
          <PlanActionButton
            plan={plan}
            recommended={recommended}
            canSwitchInterval={canSwitchInterval}
            upgradable={upgradable}
            isUserPlan={isUserPlan}
            onSubscribe={onSubscribe}
          />
        )}
      </div>
    </div>
  );
};

export default PlanCard;
