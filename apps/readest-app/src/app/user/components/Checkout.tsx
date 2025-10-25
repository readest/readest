'use client';

import clsx from 'clsx';
import React, { useCallback } from 'react';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { getStripe } from '@/libs/payment/stripe/client';
import { useTranslation } from '@/hooks/useTranslation';

interface CheckoutProps {
  clientSecret: string;
  sessionId: string;
  planName?: string;
  className?: string;
  onSuccess?: (sessionId: string) => void;
}

const Checkout: React.FC<CheckoutProps> = ({
  clientSecret,
  sessionId,
  planName,
  onSuccess,
  className = '',
}) => {
  const _ = useTranslation();
  const stripe = getStripe();

  const options = {
    clientSecret,
    onComplete: useCallback(() => {
      onSuccess?.(sessionId);
    }, [onSuccess, sessionId]),
  };

  return (
    <div className={clsx('w-full', className)}>
      <div className='mb-4 flex items-center justify-center'>
        <h3 className='text-center text-lg font-semibold'>
          {planName
            ? _('Upgrade to {{plan}}', { plan: _(planName) })
            : _('Complete Your Subscription')}
        </h3>
      </div>

      <div className='border-base-300 overflow-hidden rounded-lg border'>
        <EmbeddedCheckoutProvider stripe={stripe} options={options}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    </div>
  );
};

export default Checkout;
