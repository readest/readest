'use client';

import clsx from 'clsx';
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { GiBookshelf } from 'react-icons/gi';
import { IoChevronBack, IoChevronForward, IoHome } from 'react-icons/io5';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { navigateToLibrary } from '@/utils/nav';

interface NavigationProps {
  currentURL: string;
  startURL?: string;
  onNavigate: (url: string) => void;
  onBack?: () => void;
  onForward?: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}

export function Navigation({
  startURL,
  onNavigate,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
}: NavigationProps) {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();

  const { isTrafficLightVisible } = useTrafficLight();

  const handleGoHome = useCallback(() => {
    if (startURL) {
      onNavigate(startURL);
    }
  }, [startURL, onNavigate]);

  const handleGoLibrary = useCallback(() => {
    navigateToLibrary(router, '', {}, true);
  }, [router]);

  return (
    <header
      className={clsx(
        'navbar min-h-0 px-2',
        'flex h-[48px] w-full items-center',
        appService?.isMobile ? '' : 'border-base-300 bg-base-200 border-b',
      )}
    >
      <div className={clsx('navbar-start gap-1', isTrafficLightVisible && '!pl-16')}>
        {onBack && (
          <button
            className='btn btn-ghost btn-sm px-3 disabled:bg-transparent'
            onClick={onBack}
            disabled={!canGoBack}
            title={_('Back')}
          >
            <IoChevronBack className='h-6 w-6' />
          </button>
        )}
        {onForward && (
          <button
            className='btn btn-ghost btn-sm disabled:bg-transparent'
            onClick={onForward}
            disabled={!canGoForward}
            title={_('Forward')}
          >
            <IoChevronForward className='h-6 w-6' />
          </button>
        )}
      </div>

      <div className='navbar-center'>
        <h1 className='max-w-md truncate text-base font-semibold'>{_('OPDS Catalog')}</h1>
      </div>

      <div className='navbar-end gap-2'>
        <button className='btn btn-ghost btn-sm' onClick={handleGoHome} title={_('Home')}>
          <IoHome className='h-5 w-5' />
        </button>
        <button className='btn btn-ghost btn-sm' onClick={handleGoLibrary} title={_('Library')}>
          <GiBookshelf className='h-5 w-5' />
        </button>
      </div>
    </header>
  );
}
