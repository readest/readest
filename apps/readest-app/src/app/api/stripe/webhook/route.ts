import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';
import {
  getStripe,
  createOrUpdateSubscription,
  createOrUpdatePayment,
} from '@/libs/payment/stripe/server';
import { createSupabaseAdminClient } from '@/utils/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 401 });
    }

    const stripe = getStripe();

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        process.env['STRIPE_WEBHOOK_SECRET']!,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Webhook signature verification failed: ${message}`);
      return NextResponse.json(
        {
          error: `Webhook signature verification failed: ${message}`,
        },
        { status: 400 },
      );
    }

    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        const userId = session.metadata?.['userId'];
        if (userId) {
          if (session.mode === 'subscription') {
            await handleSuccessfulSubscription(session, userId);
          } else {
            await handleSuccessfulPayment(session, userId);
          }
        }
        break;

      case 'invoice.payment_succeeded':
        await handleSuccessfulInvoice(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleFailedInvoice(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object);
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Webhook error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleSuccessfulPayment(session: Stripe.Checkout.Session, userId: string) {
  const customerId = session.customer as string;

  await createOrUpdatePayment(userId, customerId, session.id);
}

async function handleSuccessfulSubscription(session: Stripe.Checkout.Session, userId: string) {
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  await createOrUpdateSubscription(userId, customerId, subscriptionId);
}

async function handleSuccessfulInvoice(invoice: Stripe.Invoice) {
  const customerId = invoice.customer;
  const subscriptionId = invoice.parent?.subscription_details?.subscription;

  if (!subscriptionId) {
    return;
  }

  const supabase = createSupabaseAdminClient();
  const { data: customerData } = await supabase
    .from('customers')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!customerData?.user_id) {
    console.error('Customer not found:', customerId);
    return;
  }

  await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_end: new Date(invoice.lines.data[0]!.period.end * 1000).toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId);

  await supabase
    .from('plans')
    .update({
      status: 'active',
    })
    .eq('user_id', customerData.user_id);
}

async function handleFailedInvoice(invoice: Stripe.Invoice) {
  const customerId = invoice.customer;
  const subscriptionId = invoice.parent?.subscription_details?.subscription;

  if (!subscriptionId) {
    return;
  }

  const supabase = createSupabaseAdminClient();
  const { data: customerData } = await supabase
    .from('customers')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!customerData?.user_id) {
    console.error('Customer not found:', customerId);
    return;
  }

  await supabase
    .from('subscriptions')
    .update({
      status: 'past_due',
    })
    .eq('stripe_subscription_id', subscriptionId);

  await supabase
    .from('plans')
    .update({
      status: 'past_due',
    })
    .eq('id', customerData.user_id);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const subscriptionId = subscription.id;

  const supabase = createSupabaseAdminClient();
  const { data: subscriptionData } = await supabase
    .from('subscriptions')
    .select('user_id, stripe_customer_id')
    .eq('stripe_subscription_id', subscriptionId)
    .single();

  if (!subscriptionData) {
    console.error('Subscription not found:', subscriptionId);
    return;
  }
  const { user_id, stripe_customer_id } = subscriptionData;
  await createOrUpdateSubscription(user_id, stripe_customer_id, subscriptionId);
}

async function handleSubscriptionCancelled(subscription: Stripe.Subscription) {
  const subscriptionId = subscription.id;

  const supabase = createSupabaseAdminClient();
  await supabase
    .from('subscriptions')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId);

  const { data: subscriptionData } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', subscriptionId)
    .single();

  if (subscriptionData?.user_id) {
    await supabase
      .from('plans')
      .update({
        plan: 'free',
        status: 'cancelled',
      })
      .eq('id', subscriptionData.user_id);
  }
}
