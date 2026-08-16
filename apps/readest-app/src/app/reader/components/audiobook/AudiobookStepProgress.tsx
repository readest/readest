'use client';

import clsx from 'clsx';

import { useTranslation } from '@/hooks/useTranslation';

const StepProgress = ({ current }: { current: number }) => {
  const _ = useTranslation();

  return (
    <ul
      className='steps steps-horizontal mb-5 w-full'
      role='progressbar'
      aria-label={_('Audiobook pairing progress')}
      aria-valuemin={1}
      aria-valuemax={3}
      aria-valuenow={current}
    >
      {[1, 2, 3].map((step) => (
        <li
          key={step}
          className={clsx('step', step <= current && 'step-neutral')}
          aria-label={_('Step {{step}}', { step })}
          aria-current={step === current ? 'step' : undefined}
        />
      ))}
    </ul>
  );
};

export default StepProgress;
