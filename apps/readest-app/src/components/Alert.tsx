import clsx from 'clsx';
import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';

const Alert: React.FC<{
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ title, message, onCancel, onConfirm }) => {
  const _ = useTranslation();
  return (
    <div className={clsx('z-[100] flex justify-center px-4')}>
      <div
        role='alert'
        className={clsx(
          'alert flex items-center justify-between',
          'bg-base-300 rounded-lg border-none p-4 shadow-2xl',
          'w-full max-w-[90vw] sm:max-w-[70vw] md:max-w-[50vw] lg:max-w-[40vw] xl:max-w-[40vw]',
        )}
      >
        <div className='flex items-center space-x-2'>
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
          <div className=''>
            <h3 className='font-sm text-base'>{title}</h3>
            <div className='text-xs'>{message}</div>
          </div>
        </div>
        <div className='flex flex-wrap items-center justify-center gap-2'>
          <button className='btn btn-sm' onClick={onCancel}>
            {_('Cancel')}
          </button>
          <button className='btn btn-sm btn-warning' onClick={onConfirm}>
            {_('Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Alert;
