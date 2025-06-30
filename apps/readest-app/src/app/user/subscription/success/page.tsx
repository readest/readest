'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { supabase } from '@/utils/supabase';
import Spinner from '@/components/Spinner';

const WEB_STRIPE_CHECK_URL = `${getAPIBaseUrl()}/stripe/check`;

interface SessionStatus {
  status: 'loading' | 'complete' | 'failed' | 'processing';
  customerEmail: string;
  subscriptionId?: string;
  planName?: string;
  amount?: number;
  currency?: string;
}

const SuccessPageWithSearchParams = () => {
  const _ = useTranslation();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>({
    status: 'loading',
    customerEmail: '',
  });
  const [retryCount, setRetryCount] = useState(0);
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams?.get('session_id');

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function fetchSessionStatus() {
    try {
      const token = await getAccessToken();
      const response = await fetch(WEB_STRIPE_CHECK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const { session, error } = await response.json();

      if (error) {
        setSessionStatus((prev) => ({ ...prev, status: 'failed' }));
        console.error('Session check error:', error);
        return;
      }

      setSessionStatus({
        status:
          session.payment_status === 'paid' ? 'complete' : session.payment_status || 'processing',
        customerEmail: session.customer_email || session.customer_details?.email || '',
        subscriptionId: session.subscription,
        planName:
          session.display_items?.[0]?.custom?.name || session.line_items?.data?.[0]?.description,
        amount: session.amount_total,
        currency: session.currency,
      });

      try {
        await supabase.auth.refreshSession();
      } catch {}
    } catch (error) {
      console.error('Failed to fetch session status:', error);
      setSessionStatus((prev) => ({ ...prev, status: 'failed' }));
    }
  }

  const handleRetry = () => {
    setRetryCount(0);
    setSessionStatus((prev) => ({ ...prev, status: 'loading' }));
    fetchSessionStatus();
  };

  const handleGoToLibrary = () => {
    router.push('/library');
  };

  const handleGoToProfile = () => {
    router.push('/user');
  };

  useEffect(() => {
    if (!sessionId) {
      handleGoToProfile();
      return;
    }

    fetchSessionStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, router]);

  useEffect(() => {
    if (sessionStatus.status === 'processing' && retryCount < 3) {
      const timer = setTimeout(() => {
        setRetryCount((prev) => prev + 1);
        fetchSessionStatus();
      }, 2000);

      return () => clearTimeout(timer);
    } else {
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus.status, retryCount]);

  if (!mounted) {
    return null;
  }

  // Loading state
  if (sessionStatus.status === 'loading') {
    return (
      <div className='flex min-h-screen items-center justify-center bg-gray-50'>
        <div className='text-center'>
          <div className='mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600'></div>
          <h2 className='mb-2 text-xl font-semibold text-gray-800'>
            {_('Processing your payment...')}
          </h2>
          <p className='text-gray-600'>{_('Please wait while we confirm your subscription.')}</p>
        </div>
      </div>
    );
  }

  // Processing state (payment still being processed)
  if (sessionStatus.status === 'processing') {
    return (
      <div className='flex min-h-screen items-center justify-center bg-gray-50'>
        <div className='max-w-md text-center'>
          <div className='mx-auto mb-4 flex h-12 w-12 animate-pulse items-center justify-center rounded-full bg-yellow-400'>
            <svg
              className='h-6 w-6 text-white'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
              />
            </svg>
          </div>
          <h2 className='mb-2 text-xl font-semibold text-gray-800'>{_('Payment Processing')}</h2>
          <p className='mb-4 text-gray-600'>
            {_('Your payment is being processed. This usually takes a few moments.')}
          </p>
        </div>
      </div>
    );
  }

  // Failed state
  if (sessionStatus.status === 'failed') {
    return (
      <div className='flex min-h-screen items-center justify-center bg-gray-50'>
        <div className='max-w-md text-center'>
          <div className='mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100'>
            <svg
              className='h-6 w-6 text-red-600'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
          </div>
          <h2 className='mb-2 text-xl font-semibold text-gray-800'>{_('Payment Failed')}</h2>
          <p className='mb-6 text-gray-600'>
            {_(
              "We couldn't process your subscription. Please try again or contact support if the issue persists.",
            )}
          </p>
          <div className='space-y-3'>
            <button
              onClick={handleRetry}
              className='w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-blue-700'
            >
              {_('Try Again')}
            </button>
            <button
              onClick={handleGoToProfile}
              className='w-full rounded-lg bg-gray-200 px-4 py-2 font-medium text-gray-800 transition-colors duration-200 hover:bg-gray-300'
            >
              {_('Back to Profile')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Success state
  return (
    <div className='flex min-h-screen items-center justify-center bg-gray-50'>
      <div className='mx-auto max-w-2xl px-4 text-center'>
        {/* Success Icon */}
        <div className='mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100'>
          <svg
            className='h-8 w-8 text-green-600'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
          </svg>
        </div>

        {/* Success Message */}
        <h1 className='mb-4 text-3xl font-bold text-gray-800'>
          🎉 {_('Subscription Successful!')}
        </h1>

        <div className='mb-6 rounded-lg bg-white p-6 shadow-md'>
          <p className='mb-4 text-lg text-gray-700'>
            {_('Thank you for your subscription! Your payment has been processed successfully.')}
          </p>

          {/* Subscription Details */}
          <div className='space-y-2 text-left text-sm text-gray-600'>
            {sessionStatus.customerEmail && (
              <div className='flex justify-between'>
                <span className='font-medium'>{_('Email:')}</span>
                <span>{sessionStatus.customerEmail}</span>
              </div>
            )}
            {sessionStatus.planName && (
              <div className='flex justify-between'>
                <span className='font-medium'>{_('Plan:')}</span>
                <span>{sessionStatus.planName}</span>
              </div>
            )}
            {sessionStatus.amount && sessionStatus.currency && (
              <div className='flex justify-between'>
                <span className='font-medium'>{_('Amount:')}</span>
                <span>
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: sessionStatus.currency.toUpperCase(),
                  }).format(sessionStatus.amount / 100)}
                </span>
              </div>
            )}
            {sessionStatus.subscriptionId && (
              <div className='flex justify-between'>
                <span className='font-medium'>{_('Subscription ID:')}</span>
                <span className='font-mono text-xs'>{sessionStatus.subscriptionId}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className='space-y-3 sm:flex sm:justify-center sm:space-x-4 sm:space-y-0'>
          <button
            onClick={handleGoToLibrary}
            className='w-full rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors duration-200 hover:bg-blue-700 sm:w-auto'
          >
            {_('Go to Library')}
          </button>
          <button
            onClick={handleGoToProfile}
            className='w-full rounded-lg bg-gray-200 px-6 py-3 font-medium text-gray-800 transition-colors duration-200 hover:bg-gray-300 sm:w-auto'
          >
            {_('Back to Profile')}
          </button>
        </div>

        {/* Additional Info */}
        <div className='mt-8 text-xs text-gray-500'>
          <p>{_('Need help? Contact our support team at support@readest.com')}</p>
        </div>
      </div>
    </div>
  );
};

export default function SuccessPage() {
  return (
    <Suspense
      fallback={
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      }
    >
      <SuccessPageWithSearchParams />
    </Suspense>
  );
}
