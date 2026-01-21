import clsx from 'clsx';
import React from 'react';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';

const Spinner: React.FC<{
  loading: boolean;
  className?: string;
}> = ({ loading, className }) => {
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
      <span
        className={clsx('loading loading-lg not-eink:loading-dots eink:loading-spinner', className)}
      ></span>
      <span className='sr-only'>{_('Loading...')}</span>
    </div>
  );
};

export default Spinner;
