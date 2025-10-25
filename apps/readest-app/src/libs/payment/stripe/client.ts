import { loadStripe, Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null>;

export const getStripe = () => {
  if (!stripePromise) {
    const publishableKey =
      process.env.NODE_ENV === 'production'
        ? process.env['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_BASE64']
        : process.env['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_DEV_BASE64'];
    stripePromise = loadStripe(atob(publishableKey!));
  }
  return stripePromise;
};
