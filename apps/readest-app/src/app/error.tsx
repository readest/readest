'use client';

import posthog from 'posthog-js';
import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { parseWebViewInfo } from '@/utils/ua';
import { handleGlobalError } from '@/utils/error';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorPageProps) {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [browserInfo, setBrowserInfo] = useState('');

  useEffect(() => {
    setBrowserInfo(parseWebViewInfo(appService));
  }, [appService]);

  useEffect(() => {
    posthog.captureException(error);
    handleGlobalError(error);
  }, [appService, error]);

  const handleGoHome = () => {
    window.location.href = '/library';
  };

  const handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      handleGoHome();
    }
  };

  return (
    <div className='hero bg-base-200 min-h-screen'>
      <div className='hero-content text-center'>
        <div className='w-full max-w-2xl p-1'>
          <div className='mb-8 mt-6'>
            <div className='text-error animate-pulse text-8xl'>⚠️</div>
          </div>

          <h1 className='text-base-content mb-4 text-5xl font-bold'>Oops!</h1>

          <p className='text-base-content/70 mb-8 text-lg'>
            {_(
              "Something went wrong. Don't worry, our team has been notified and we're working on a fix.",
            )}
          </p>

          <div className='alert alert-error mb-8'>
            <div className='flex-col items-start text-left'>
              <h3 className='mb-2 font-bold'>{_('Error Details:')}</h3>
              <p className='break-words font-mono text-sm'>{error.message}</p>
              {browserInfo && <p className='mt-2 font-mono text-sm'>Browser: {browserInfo}</p>}
              {error.stack && (
                <p className='mt-2 whitespace-pre-wrap break-all font-mono text-sm'>
                  {error.stack.split('\n').slice(0, 3).join('\n')}
                </p>
              )}
              {error.digest && <p className='mt-2 text-xs opacity-70'>Error ID: {error.digest}</p>}
            </div>
          </div>

          <div className='flex flex-col gap-4'>
            <button onClick={reset} className='btn btn-primary btn-lg'>
              <svg className='mr-2 h-5 w-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'
                />
              </svg>
              {_('Try Again')}
            </button>

            <div className='flex gap-3'>
              <button onClick={handleGoBack} className='btn btn-outline flex-1'>
                <svg className='mr-2 h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M10 19l-7-7m0 0l7-7m-7 7h18'
                  />
                </svg>
                {_('Go Back')}
              </button>

              <button onClick={handleGoHome} className='btn btn-outline flex-1'>
                <svg className='mr-2 h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6'
                  />
                </svg>
                {_('Your Library')}
              </button>
            </div>
          </div>

          <div className='border-base-300 mt-8 border-t pt-6'>
            <p className='text-base-content/60 text-sm'>
              {_('Need help?')}{' '}
              <a href='mailto:support@readest.com' className='link link-primary'>
                {_('Contact Support')}
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
