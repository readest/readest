'use client';

import { Toast } from '@/components/Toast';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import clsx from 'clsx';

export default function MangaDexPage() {
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();
  const { appService } = useEnv();

  return (
    <div
      className={clsx(
        'bg-base-100 flex h-screen select-none flex-col',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
    >
      <div
        className='relative top-0 z-40 w-full'
        style={{
          paddingTop: `${safeAreaInsets?.top || 0}px`,
        }}
      >
        <Toast />
      </div>
      <h1>hello world!!!!!!!</h1>
    </div>
  );
}
