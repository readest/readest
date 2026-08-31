import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { PlanInterval } from '@/types/quota';

interface BillingIntervalToggleProps {
  intervals: PlanInterval[];
  value: PlanInterval;
  savingsPercent?: number | null;
  onChange: (interval: PlanInterval) => void;
}

const BillingIntervalToggle: React.FC<BillingIntervalToggleProps> = ({
  intervals,
  value,
  savingsPercent,
  onChange,
}) => {
  const _ = useTranslation();

  // Nothing to switch between until the store returns a yearly price.
  if (intervals.length < 2) return null;

  return (
    <div className='flex items-center justify-center'>
      <div
        role='group'
        aria-label={_('Billing interval')}
        className='bg-base-200 eink-bordered inline-flex items-center gap-1 rounded-full p-1'
      >
        {intervals.map((interval) => {
          const selected = interval === value;
          return (
            <button
              key={interval}
              onClick={() => onChange(interval)}
              aria-pressed={selected}
              className={clsx(
                'flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium',
                'transition-colors duration-150',
                'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
                selected
                  ? 'bg-base-100 text-base-content eink-bordered not-eink:shadow-xs'
                  : 'text-base-content/60 hover:text-base-content',
              )}
            >
              <span className='whitespace-nowrap'>
                {interval === 'year' ? _('Yearly') : _('Monthly')}
              </span>
              {interval === 'year' && savingsPercent ? (
                <span
                  className={clsx(
                    'rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
                    'not-eink:bg-primary/10 not-eink:text-primary',
                    'eink:border-base-content eink:text-base-content eink:border',
                  )}
                >
                  {_('Save {{percent}}%', { percent: savingsPercent })}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default BillingIntervalToggle;
