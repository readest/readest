'use client';
import Stripe from 'stripe';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { getAPIBaseUrl, getNodeAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { supabase } from '@/utils/supabase';
import { PlanType } from '@/types/quota';
import Spinner from '@/components/Spinner';
import { VerifiedIAP } from '@/libs/payment/iap/types';

const STRIPE_CHECK_URL = `${getAPIBaseUrl()}/stripe/check`;
const APPLE_IAP_VERIFY_URL = `${getNodeAPIBaseUrl()}/apple/iap-verify`;
const ANDROID_IAP_VERIFY_URL = `${getNodeAPIBaseUrl()}/google/iap-verify`;

interface SessionStatus {
  status: 'loading' | 'completed' | 'failed' | 'processing';
  customerEmail: string;
  orderId?: string;
  planName?: string;
  planType: PlanType;
  amount?: number; // in cents
  currency?: string;
}

const SuccessPageWithSearchParams = () => {
  const _ = useTranslation();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>({
    status: 'loading',
    planType: 'subscription',
    customerEmail: '',
  });
  const [retryCount, setRetryCount] = useState(0);
  const searchParams = useSearchParams();
  const router = useRouter();
  const payment = searchParams?.get('payment');
  const platform = searchParams?.get('platform');
  const sessionId = searchParams?.get('session_id');

  // iOS parameters
  const transactionId = searchParams?.get('transaction_id');
  const originalTransactionId = searchParams?.get('original_transaction_id');

  // Android parameters
  const packageName = searchParams?.get('package_name');
  const productId = searchParams?.get('product_id');
  const purchaseToken = searchParams?.get('purchase_token');
  const orderId = searchParams?.get('order_id');

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const updateStripeSessionStatus = async () => {
    try {
      const token = await getAccessToken();
      const response = await fetch(STRIPE_CHECK_URL, {
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

      const { session: stripeCheckoutSession, error } = await response.json();

      if (error) {
        setSessionStatus((prev) => ({ ...prev, status: 'failed' }));
        console.error('Session check error:', error);
        return;
      }

      const session = stripeCheckoutSession as Stripe.Checkout.Session;
      setSessionStatus({
        status: session.payment_status === 'paid' ? 'completed' : 'failed',
        customerEmail: session.customer_email || session.customer_details?.email || '',
        orderId: (session.subscription || session.payment_intent || '') as string,
        planName: session.line_items?.data?.[0]?.description || '',
        planType: session.mode === 'payment' ? 'purchase' : 'subscription',
        amount: session.amount_total || undefined,
        currency: session.currency || undefined,
      });

      try {
        await supabase.auth.refreshSession();
      } catch {}
    } catch (error) {
      console.error('Failed to fetch session status:', error);
      setSessionStatus((prev) => ({ ...prev, status: 'failed' }));
    }
  };

  const updateIOSIAPSessionStatus = async (
    transactionId: string,
    originalTransactionId: string,
  ) => {
    if (!transactionId || !originalTransactionId) {
      setSessionStatus((prev) => ({ ...prev, status: 'failed' }));
      return;
    }
    try {
      const token = await getAccessToken();
      const response = await fetch(APPLE_IAP_VERIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          transactionId,
          originalTransactionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const { purchase: iOSPurchase, error } = await response.json();

      if (error) {
        setSessionStatus((prev) => ({ ...prev, status: 'failed' }));
        console.error('IAP verification error:', error);
        return;
      }

      const purchase = iOSPurchase as VerifiedIAP;
      setSessionStatus({
        status: purchase.status === 'active' ? 'completed' : 'failed',
        customerEmail: purchase.customerEmail || '',
        orderId: purchase.orderId,
        planName: purchase.planName,
        planType: purchase.planType,
      });

      try {
        await supabase.auth.refreshSession();
      } catch {}
    } catch (error) {
      console.error('Failed to verify IAP transaction:', error);
      setSessionStatus((prev) => ({ ...prev, status: 'failed' }));
    }
  };

  const updateAndroidIAPSessionStatus = async (
    packageName: string,
    productId: string,
    orderId: string,
    purchaseToken: string,
  ) => {
    if (!purchaseToken || !productId || !packageName) {
      console.error('Missing required Android IAP parameters');
      setSessionStatus((prev) => ({ ...prev, status: 'failed' }));
      return;
    }

    try {
      const token = await getAccessToken();
      const response = await fetch(ANDROID_IAP_VERIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          purchaseToken,
          orderId,
          productId,
          packageName,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const { purchase: androidPurchase, error } = await response.json();

      if (error) {
        setSessionStatus((prev) => ({ ...prev, status: 'failed' }));
        console.error('Android IAP verification error:', error);
        return;
      }

      const purchase = androidPurchase as VerifiedIAP;
      setSessionStatus({
        status: purchase.status === 'active' ? 'completed' : 'failed',
        customerEmail: purchase.customerEmail || '',
        orderId: purchase.orderId,
        planName: purchase.planName,
        planType: purchase.planType,
        amount: purchase.amount,
        currency: purchase.currency,
      });

      try {
        await supabase.auth.refreshSession();
      } catch {}
    } catch (error) {
      console.error('Failed to verify Android IAP transaction:', error);
      setSessionStatus((prev) => ({ ...prev, status: 'failed' }));
    }
  };

  const updateIAPSessionStatus = async () => {
    if (platform === 'ios' && transactionId && originalTransactionId) {
      await updateIOSIAPSessionStatus(transactionId, originalTransactionId);
    } else if (platform === 'android' && orderId && purchaseToken && productId && packageName) {
      await updateAndroidIAPSessionStatus(packageName, productId, orderId, purchaseToken);
    } else {
      console.error('Invalid IAP platform or missing parameters');
      setSessionStatus((prev) => ({ ...prev, status: 'failed' }));
    }
  };

  const updateSessionStatus = async () => {
    if (payment === 'stripe' && sessionId) {
      await updateStripeSessionStatus();
    } else if (payment === 'iap') {
      await updateIAPSessionStatus();
    } else {
      setSessionStatus((prev) => ({ ...prev, status: 'failed' }));
    }
  };

  const handleRetry = () => {
    setRetryCount(0);
    setSessionStatus((prev) => ({ ...prev, status: 'loading' }));
    updateSessionStatus();
  };

  const handleGoToLibrary = () => {
    router.push('/library');
  };

  const handleGoToProfile = () => {
    router.push('/user');
  };

  useEffect(() => {
    updateSessionStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, originalTransactionId, router]);

  useEffect(() => {
    if (sessionStatus.status === 'processing' && retryCount < 3) {
      const timer = setTimeout(() => {
        setRetryCount((prev) => prev + 1);
        updateSessionStatus();
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
        <div className='mx-auto max-w-2xl px-4 text-center'>
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
          🎉{' '}
          {sessionStatus.planType === 'purchase'
            ? _('Purchase Successful!')
            : _('Subscription Successful!')}
        </h1>

        <div className='mb-6 rounded-lg bg-white p-6 shadow-md'>
          <p className='mb-4 text-lg text-gray-700'>
            {sessionStatus.planType === 'purchase'
              ? _('Thank you for your purchase! Your payment has been processed successfully.')
              : _('Thank you for your subscription! Your payment has been processed successfully.')}
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
                <span>{_(sessionStatus.planName)}</span>
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
            {sessionStatus.orderId && (
              <div className='flex justify-between'>
                <span className='font-medium'>{_('Order ID:')}</span>
                <span className='font-mono text-xs'>{sessionStatus.orderId}</span>
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
