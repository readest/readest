import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

type QuotaProps = {
  quotas: {
    name: string;
    tooltip: string;
    used: number;
    total: number;
    unit: string;
    resetAt?: number;
  }[];
  className?: string;
  labelClassName?: string;
  showProgress?: boolean;
};

const Quota: React.FC<QuotaProps> = ({ quotas, showProgress, className, labelClassName }) => {
  const _ = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  const hasResetIndicator = showProgress && quotas.some((q) => q.resetAt);

  useEffect(() => {
    if (!hasResetIndicator) return;
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, [hasResetIndicator]);

  return (
    <div className={clsx('text-base-content w-full rounded-md text-base sm:text-sm', className)}>
      {quotas.map((quota) => {
        const usageRatio = quota.total > 0 ? quota.used / quota.total : 0;
        const usagePercentage = Math.min(100, usageRatio * 100);
        const usagePercentageRounded = Math.round(usagePercentage);
        let bgColor = 'bg-green-500';
        if (usagePercentage > 80) {
          bgColor = 'bg-red-500';
        } else if (usagePercentage > 50) {
          bgColor = 'bg-yellow-500';
        }

        const showResetRow = showProgress && quota.resetAt;
        const totalMinutes = showResetRow
          ? Math.floor(Math.max(0, quota.resetAt! - now) / 60_000)
          : 0;
        const resetHours = Math.floor(totalMinutes / 60);
        const resetMinutes = totalMinutes % 60;

        return (
          <div key={quota.name} className='w-full'>
            <div
              className={clsx(
                'relative w-full overflow-hidden rounded-md',
                showProgress && 'bg-base-300',
              )}
            >
              {showProgress && (
                <div
                  className={`absolute left-0 top-0 h-full ${bgColor}`}
                  style={{ width: `${usagePercentage}%` }}
                ></div>
              )}

              <div
                className={clsx(
                  'relative flex items-center justify-between gap-4 p-2',
                  labelClassName,
                )}
              >
                <span className='truncate' title={quota.tooltip}>
                  {quota.name}
                </span>
                <div className='text-right text-sm'>
                  {quota.used} / {quota.total} {quota.unit}
                </div>
              </div>
            </div>
            {showResetRow && (
              <div
                className={clsx(
                  'text-base-content/70 mt-1.5 flex items-center justify-between text-xs',
                  labelClassName,
                )}
              >
                <span>{_('{{percentage}}% used', { percentage: usagePercentageRounded })}</span>
                <span>
                  {_('Resets in {{hours}} hr {{minutes}} min', {
                    hours: resetHours,
                    minutes: resetMinutes,
                  })}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default Quota;
