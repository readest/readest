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
        className={clsx(
          'alert flex items-center justify-between',
          'bg-base-300 rounded-lg border-none p-4 shadow-2xl',
          'w-full max-w-[90vw] sm:max-w-[70vw] md:max-w-[50vw] lg:max-w-[40vw] xl:max-w-[40vw]',
          'min-w-[70vw] flex-col sm:min-w-[40vw] sm:flex-row',
        )}
      >
        <div className='labels flex items-center space-x-2 self-start sm:space-x-4 sm:self-center'>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            fill='none'
            viewBox='0 0 24 24'
            className='stroke-info h-6 w-6 shrink-0'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth='2'
              d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
            ></path>
          </svg>
          <div className='flex flex-col gap-y-2'>
            <h3 className='text-start text-sm font-medium sm:text-center'>{title}</h3>
            <div className='text-start text-sm sm:text-center'>{message}</div>
          </div>
        </div>
        <div className='buttons flex flex-wrap items-center justify-end gap-2 self-end sm:max-w-[20vw] sm:self-center'>
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
