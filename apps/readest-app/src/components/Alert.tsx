import clsx from 'clsx';
import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';

const Alert: React.FC<{
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ title, message, onCancel, onConfirm }) => {
  const _ = useTranslation();
  const [isProcessing, setIsProcessing] = React.useState(false);
  const divRef = useKeyDownActions({ onCancel, onConfirm });

  return (
    <div className={clsx('z-[100] flex justify-center px-4')}>
      <div
        ref={divRef}
        role='alert'
        // Always stack the title/message block above the actions row. The
        // previous side-by-side layout flex-wrapped at narrow widths and
        // produced the cramped two-column-with-stacked-buttons shape from
        // Image #3. Avoid the daisyUI `alert` class here — it applies a
        // `display: grid` with `justify-items: center` that collapses the
        // actions row to content width and pulls it toward the centre,
        // defeating `justify-end`. We want a plain flex-column surface.
        className={clsx(
          'flex flex-col gap-3',
          'bg-base-300 rounded-lg p-4 shadow-2xl',
          'w-full max-w-md sm:max-w-lg md:max-w-xl',
        )}
      >
        <div className='labels flex items-start gap-3'>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            fill='none'
            viewBox='0 0 24 24'
            className='stroke-info mt-0.5 h-6 w-6 shrink-0'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth='2'
              d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
            ></path>
          </svg>
          <div className='flex min-w-0 flex-col gap-1'>
            <h3 className='text-start text-sm font-medium'>{title}</h3>
            <div className='text-start text-sm'>{message}</div>
          </div>
        </div>
        <div className='buttons flex items-center justify-end gap-2'>
          <button className='btn btn-sm btn-neutral' onClick={onCancel}>
            {_('Cancel')}
          </button>
          <button
            className={clsx('btn btn-sm btn-warning', { 'btn-disabled': isProcessing })}
            onClick={() => {
              setIsProcessing(true);
              onConfirm();
            }}
          >
            {_('Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Alert;
