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

// A user can hold several subscriptions at once (e.g. right after upgrading
// Plus -> Pro, before the old Plus subscription is cancelled). Rank the plans
// so we can always reflect the highest one on the account.
const PLAN_RANK: Record<UserPlan, number> = {
  free: 0,
  purchase: 0,
  plus: 1,
  pro: 2,
};

const getSubscriptionPlan = (subscription: Stripe.Subscription): UserPlan => {
  const product = subscription.items.data[0]?.price.product as
    | (Stripe.Product & { metadata: StripeProductMetadata })
    | undefined;
  return product?.metadata?.plan || 'free';
};

/**
 * Resolve the highest plan among a customer's currently active (or trialing)
 * Stripe subscriptions. Returns `'free'` when none are active. This keeps the
 * `plans` table correct regardless of the order in which subscription webhooks
 * arrive when multiple subscriptions overlap.
 */
export const getHighestActivePlan = async (
  stripe: Stripe,
  customerId: string,
): Promise<UserPlan> => {
  const { data: subscriptions } = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  });
  const activeSubscriptions = subscriptions.filter((sub) =>
    ['active', 'trialing'].includes(sub.status),
  );
  const plans = await Promise.all(
    activeSubscriptions.map(async (sub) => {
      const detailed = await stripe.subscriptions.retrieve(sub.id, {
        expand: ['items.data.price.product'],
      });
      return getSubscriptionPlan(detailed);
    }),
  );
  return plans.reduce<UserPlan>(
    (highest, plan) => (PLAN_RANK[plan] > PLAN_RANK[highest] ? plan : highest),
    'free',
  );
};

export const createOrUpdateSubscription = async (
  userId: string,
  customerId: string,
  subscriptionId: string,
) => {
  const stripe = getStripe();
  const supabase = createSupabaseAdminClient();

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const subscriptionItem = subscription.items.data[0]!;
  const priceId = subscriptionItem.price.id;

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

  const plan = await getHighestActivePlan(stripe, customerId);
  await supabase
    .from('plans')
    .update({
      plan,
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
