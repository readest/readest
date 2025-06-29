import Stripe from 'stripe';
import { getStripe } from '@/libs/stripe/server';
import { createSupabaseAdminClient } from './supabase';
import { UserPlan } from '@/types/user';

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
    metadata: { plan: UserPlan };
  };
  const plan = product.metadata['plan'] || 'free';

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
