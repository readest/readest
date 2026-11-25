import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { getLocale } from '@/utils/misc';
import { PlanType } from '@/types/quota';
import { PlanAccent, PlanDetails } from '../utils/plan';

interface PlanActionButtonProps {
  plan: PlanDetails;
  accent: PlanAccent;
  isUserPlan: boolean;
  recommended?: boolean;
  upgradable?: boolean;
  canSwitchInterval?: boolean;
  giftUntil?: string;
  giftOnly?: boolean;
  /** A gift-only holder's gift is a higher tier than this one. */
  belowGift?: boolean;
  onSubscribe: (priceId?: string, planType?: PlanType) => void;
}

const PlanActionButton: React.FC<PlanActionButtonProps> = ({
  plan,
  accent,
  isUserPlan,
  recommended,
  upgradable,
  canSwitchInterval,
  giftUntil,
  giftOnly,
  belowGift,
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
          accent.cta,
        )}
      >
        {belowGift
          ? _('Subscribe to {{plan}}', { plan: _(plan.name) })
          : _('Upgrade to {{plan}}', { plan: _(plan.name) })}
      </button>
    );
  }

  if (isUserPlan) {
    return (
      <div className='flex flex-col gap-2'>
        {/* Not a <button disabled>: daisyUI washes disabled buttons out to a
            near-invisible grey. This is a status chip, so it keeps the tier's
            own colour and the button's geometry. */}
        <div
          aria-disabled='true'
          className={clsx('btn eink-bordered pointer-events-none w-full', accent.current)}
        >
          {giftUntil
            ? _('Gift, until {{date}}', {
                date: new Date(giftUntil).toLocaleDateString(getLocale()),
              })
            : _('Current Plan')}
        </div>
        {/* The account's billing interval isn't carried on the session token, so
            this stays neutrally worded rather than claiming which one they are
            on. A subscriber goes to the Stripe portal, which swaps the
            subscription in place instead of stacking a second one; a gift-only
            holder has no subscription and goes to checkout. */}
        {(giftOnly || canSwitchInterval) && plan.plan !== 'free' && plan.productId && (
          <button
            onClick={() => onSubscribe(plan.productId)}
            className='btn btn-ghost btn-sm text-base-content/70 hover:text-base-content w-full font-normal'
          >
            {giftOnly
              ? _('Subscribe to {{plan}}', { plan: _(plan.name) })
              : _('Change billing period')}
          </button>
        )}
      </div>
    );
  }

  return null;
};

export default PlanActionButton;
