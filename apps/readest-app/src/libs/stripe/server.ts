import Stripe from 'stripe';

let stripe: Stripe | null;

export const getStripe = () => {
  if (!stripe) {
    const stripeSecretKey =
      process.env.NODE_ENV === 'production'
        ? process.env['STRIPE_SECRET_KEY']
        : process.env['STRIPE_SECRET_KEY_DEV'];
    stripe = new Stripe(stripeSecretKey!, {
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return stripe;
};
