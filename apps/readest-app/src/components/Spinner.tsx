import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';

const Spinner: React.FC<{
  loading: boolean;
}> = ({ loading }) => {
  const _ = useTranslation();
  if (!loading) return null;

  return (
    <div
      className='absolute left-1/2 top-4 -translate-x-1/2 transform pt-16 text-center'
      role='status'
    >
      <span className='loading loading-dots loading-lg'></span>
      <span className='hidden'>{_('Loading...')}</span>
    </div>
  );
};

export default Spinner;
