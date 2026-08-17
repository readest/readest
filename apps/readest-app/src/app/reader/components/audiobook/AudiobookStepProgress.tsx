'use client';

import clsx from 'clsx';

import { useTranslation } from '@/hooks/useTranslation';

const StepProgress = ({ current }: { current: number }) => {
  const _ = useTranslation();
  const labels = [_('Files'), _('Align'), _('Review')];

  return (
    <ul
      className='steps steps-horizontal mb-5 w-full'
      role='progressbar'
      aria-label={_('Audiobook pairing progress')}
      aria-valuemin={1}
      aria-valuemax={3}
      aria-valuenow={current}
    >
      {labels.map((label, index) => {
        const step = index + 1;
        return (
          <li
            key={step}
            className={clsx('step', step <= current && 'step-neutral')}
            aria-label={_('Step {{step}}: {{label}}', { step, label })}
            aria-current={step === current ? 'step' : undefined}
          >
            {label}
          </li>
        );
      })}
    </ul>
  );
};

export default StepProgress;
