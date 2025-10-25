import Stripe from 'stripe';
import { UserPlan } from '@/types/quota';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { PaymentStatus, StripePaymentData, StripeProductMetadata } from '@/types/payment';
import { updateUserStorage } from '../storage';

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

export const createOrUpdateSubscription = async (
  userId: string,
  customerId: string,
  subscriptionId: string,
) => {
  const stripe = getStripe();
  const supabase = createSupabaseAdminClient();

  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price.product'],
  });
  const subscriptionItem = subscription.items.data[0]!;
  const priceId = subscriptionItem.price.id;
  const product = subscriptionItem.price.product as Stripe.Product & {
    metadata: StripeProductMetadata;
  };
  const plan = product.metadata?.plan || 'free';

  try {
    const { data: existingSubscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('stripe_subscription_id', subscriptionId)
      .single();

    const period_start = new Date(subscriptionItem.current_period_start * 1000).toISOString();
    const period_end = new Date(subscriptionItem.current_period_end * 1000).toISOString();
    if (existingSubscription) {
      await supabase
        .from('subscriptions')
        .update({
          status: subscription.status,
          current_period_start: period_start,
          current_period_end: period_end,
        })
        .eq('id', existingSubscription.id);
    } else {
      await supabase.from('subscriptions').insert({
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        stripe_price_id: priceId,
        status: subscription.status,
        current_period_start: period_start,
        current_period_end: period_end,
        created_at: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Error checking existing subscription:', error);
  }

  await supabase
    .from('plans')
    .update({
      plan: ['active', 'trialing'].includes(subscription.status) ? plan : 'free',
      status: subscription.status,
    })
    .eq('id', userId);
};

export const COMPLETED_PAYMENT_STATUSES: PaymentStatus[] = ['completed', 'succeeded'];

export const createOrUpdatePayment = async (
  userId: string,
  customerId: string,
  checkoutSessionId: string,
) => {
  const stripe = getStripe();
  const supabase = createSupabaseAdminClient();

  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
    expand: ['line_items.data.price.product', 'payment_intent'],
  });

  if (!session.payment_intent) {
    throw new Error('No payment intent in checkout session');
  }

  const paymentIntent = session.payment_intent as Stripe.PaymentIntent;
  const lineItem = session.line_items?.data[0];
  const product = lineItem?.price?.product as Stripe.Product & {
    metadata: { plan: UserPlan; storageGB: string };
  };
  const productMetadata = product?.metadata;

  try {
    const paymentData: Partial<StripePaymentData> = {
      user_id: userId,
      provider: 'stripe',
      stripe_customer_id: customerId,
      stripe_checkout_id: checkoutSessionId,
      stripe_payment_intent_id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: paymentIntent.status as PaymentStatus,
      payment_method: paymentIntent.payment_method as string | null,
      product_id: product?.id,
      storage_gb: productMetadata?.storageGB ? parseInt(productMetadata.storageGB) : 0,
      metadata: product?.metadata,
    };

    const { error } = await supabase.from('payments').upsert(paymentData, {
      onConflict: 'stripe_payment_intent_id',
      ignoreDuplicates: false,
    });

    if (error) {
      throw error;
    }
    await updateUserStorage(userId);
  } catch (error) {
    console.error('Error creating or updating payment:', error);
    throw error;
  }
};
