import React from 'react';

type QuotaProps = {
  quotas: {
    name: string;
    tooltip: string;
    used: number;
    total: number;
    unit: string;
  }[];
};

const Quota: React.FC<QuotaProps> = ({ quotas }) => {
  return (
    <div className='w-full max-w-lg rounded-md pl-4 pr-2 text-base sm:text-sm'>
      <div>
        {quotas.map((quota) => (
          <div key={quota.name} className='flex h-10 items-center justify-between'>
            <div className='lg:tooltip lg:tooltip-bottom' data-tip={quota.tooltip}>
              <div className='flex max-w-28 items-center gap-x-2'>
                <span className='truncate'>{quota.name}</span>
              </div>
            </div>

            <div className='py-3 text-right text-xs'>
              {quota.used} / {quota.total} {quota.unit}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Quota;
