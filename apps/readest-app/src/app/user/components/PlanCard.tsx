import clsx from 'clsx';
import { IoCheckmark } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { getLocale } from '@/utils/misc';
import { getPlanAccent, PlanDetails } from '../utils/plan';
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
  /** Defaults to false: an unknown state shows the buy button, never hides it. */
  customizationPurchased?: boolean;
  onSubscribe: (priceId?: string, planType?: PlanType) => void;
}

const PlanCard: React.FC<PlanCardProps> = ({
  plan,
  interval,
  isUserPlan,
  recommended,
  customizationPurchased = false,
  upgradable,
  canSwitchInterval,
  onSubscribe,
}) => {
  const _ = useTranslation();
  const { price, currency } = plan;
  const accent = getPlanAccent(plan.plan);

  const formatPrice = (amountInCents: number) =>
    new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(amountInCents / 100);

  // The free tier is nominally a subscription but has no yearly billing, so
  // it must not pick up the "billed yearly" caption.
  const isYearly = plan.type === 'subscription' && plan.plan !== 'free' && interval === 'year';
  // Yearly plans lead with the per-month equivalent — the figure people compare
  // against the monthly price — with the amount actually charged underneath.
  const headlinePrice = formatPrice(isYearly ? price / 12 : price);

  const renderPriceCaption = () => {
    if (isYearly) return _('{{price}} billed yearly', { price: formatPrice(price) });
    return null;
  };

  return (
    <div
      className={clsx(
        'bg-base-100 eink-bordered flex h-full flex-col overflow-hidden rounded-lg border',
        // The emphasised border marks the plan you are actually on, in that
        // tier's own colour — "recommended" is not a state the reader is in.
        isUserPlan ? accent.border : 'border-base-200',
      )}
    >
      <div className={clsx('px-4 py-3', accent.header)}>
        <span
          className={clsx('inline-block rounded-full px-3 py-1 text-sm font-medium', plan.color)}
          data-plan={plan.plan}
        >
          {_(plan.name)}
        </span>
      </div>

      <div className='flex flex-1 flex-col p-4'>
        <div className='mb-5'>
          {plan.plan !== 'purchase' ? (
            <>
              <div className='flex items-baseline gap-1'>
                <span className={clsx('text-base-content text-3xl font-bold', accent.price)}>
                  {headlinePrice}
                </span>
                <span className='text-base-content/60 text-sm font-normal'>/{_('month')}</span>
              </div>
              <div className={clsx('mt-1 min-h-5 text-xs', plan.hintColor)}>
                {renderPriceCaption()}
              </div>
            </>
          ) : (
            <>
              {/* Sized below the price: the same type size on an 18-character
                  phrase outweighs a four-character figure. */}
              <div
                className={clsx(
                  'text-base-content text-2xl leading-tight font-bold text-balance',
                  accent.price,
                )}
              >
                {_('On-Demand Purchase')}
              </div>
              <div className='mt-1 min-h-5 text-xs' />
            </>
          )}
        </div>

        <div className='mb-5 space-y-3'>
          {plan.features.map((feature, featureIndex) => (
            <div key={featureIndex} className='flex flex-col'>
              <div className='text-base-content flex items-start gap-2 text-sm'>
                <IoCheckmark className={clsx('mt-0.5 h-4 w-4 shrink-0', accent.check)} />
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
            <h5 className='text-base-content mb-2 text-xs font-semibold'>{_("What's Included")}</h5>
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
            <PurchaseCallToActions
              plan={plan}
              accent={accent}
              customizationPurchased={customizationPurchased}
              onSubscribe={onSubscribe}
            />
          ) : (
            <PlanActionButton
              plan={plan}
              accent={accent}
              recommended={recommended}
              canSwitchInterval={canSwitchInterval}
              upgradable={upgradable}
              isUserPlan={isUserPlan}
              onSubscribe={onSubscribe}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default PlanCard;
