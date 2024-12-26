import React from 'react';
import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';

const Alert: React.FC<{
  title: string;
  message: string;
  onClickCancel: () => void;
  onClickConfirm: () => void;
}> = ({ title, message, onClickCancel, onClickConfirm }) => {
  const _ = useTranslation();
  return (
    <div
      role='alert'
      className={clsx(
        'alert fixed bottom-4 left-1/2 flex -translate-x-1/2 transform items-center justify-between',
        'rounded-lg bg-gray-100 p-4 shadow-2xl',
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
          <h3 className='font-bold'>{title}</h3>
          <div className='text-xs'>{message}</div>
        </div>
      </div>
      <div className='flex space-x-2'>
        <button className='btn btn-sm' onClick={onClickCancel}>
          {_('Cancel')}
        </button>
        <button className='btn btn-sm btn-warning' onClick={onClickConfirm}>
          {_('Confirm')}
        </button>
      </div>
    </div>
  );
};

export default Alert;
