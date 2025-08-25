import clsx from 'clsx';
import React from 'react';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';

const Spinner: React.FC<{
  loading: boolean;
}> = ({ loading }) => {
  const _ = useTranslation();
  const { safeAreaInsets } = useThemeStore();
  if (!loading) return null;

  return (
    <div
      className={clsx('absolute left-1/2 top-4 -translate-x-1/2 transform text-center')}
      style={{
        paddingTop: `${(safeAreaInsets?.top || 0) + 64}px`,
      }}
      role='status'
    >
      <span className='loading loading-dots loading-lg'></span>
      <span className='hidden'>{_('Loading...')}</span>
    </div>
  );
};

export default Spinner;
