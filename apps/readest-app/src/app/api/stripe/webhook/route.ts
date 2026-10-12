import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';
import {
  getStripe,
  createOrUpdateSubscription,
  createOrUpdatePayment,
} from '@/libs/payment/stripe/server';
import { resolveUserPlan } from '@/libs/payment/entitlements';
import { createSupabaseAdminClient } from '@/utils/supabase';

// supabase-js resolves with `{ error }` rather than throwing. A webhook handler
// that ignores it returns 200 on a failed write, so Stripe treats the event as
// delivered and never retries — the user's billing state then diverges
// permanently. Convert a write error into a throw so the POST handler answers
// 500 and Stripe redelivers.
const throwIfError = (result: { error: { message: string } | null }, context: string): void => {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
};

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

  throwIfError(
    await supabase
      .from('subscriptions')
      .update({
        status: 'active',
        current_period_end: new Date(invoice.lines.data[0]!.period.end * 1000).toISOString(),
      })
      .eq('stripe_subscription_id', subscriptionId),
    'subscriptions update (invoice succeeded)',
  );

  throwIfError(
    await supabase
      .from('plans')
      .update({
        status: 'active',
      })
      .eq('user_id', customerData.user_id),
    'plans update (invoice succeeded)',
  );
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

  throwIfError(
    await supabase
      .from('subscriptions')
      .update({
        status: 'past_due',
      })
      .eq('stripe_subscription_id', subscriptionId),
    'subscriptions update (invoice failed)',
  );

  throwIfError(
    await supabase
      .from('plans')
      .update({
        status: 'past_due',
      })
      .eq('id', customerData.user_id),
    'plans update (invoice failed)',
  );
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
  throwIfError(
    await supabase
      .from('subscriptions')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('stripe_subscription_id', subscriptionId),
    'subscriptions update (subscription cancelled)',
  );

  const { data: subscriptionData } = await supabase
    .from('subscriptions')
    .select('user_id, stripe_customer_id')
    .eq('stripe_subscription_id', subscriptionId)
    .single();

  if (subscriptionData?.user_id) {
    // The user may still hold other active subscriptions — another Stripe one
    // (e.g. cancelling the old Plus after upgrading to Pro), or a Google Play
    // / App Store one they migrated to. Reflect the highest plan that remains
    // entitled anywhere rather than always dropping to free.
    const plan = await resolveUserPlan(subscriptionData.user_id, {
      stripeCustomerId: subscriptionData.stripe_customer_id,
    });
    throwIfError(
      await supabase
        .from('plans')
        .update({
          plan,
          status: plan === 'free' ? 'cancelled' : 'active',
        })
        .eq('id', subscriptionData.user_id),
      'plans update (subscription cancelled)',
    );
  }
}
