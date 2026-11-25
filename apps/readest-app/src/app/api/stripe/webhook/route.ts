import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';
import {
  getStripe,
  createOrUpdateSubscription,
  createOrUpdatePayment,
} from '@/libs/payment/stripe/server';
import { resolveUserPlan } from '@/libs/payment/entitlements';
import { markPaymentRefunded } from '@/libs/payment/iap/payments';
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

      // A renewal, a retry, or a failed payment: re-read the subscription
      // from Stripe rather than guess its status from the event.
      case 'invoice.paid':
      case 'invoice.payment_failed':
        await handleInvoice(event.data.object);
        break;

      case 'customer.subscription.updated':
        await syncStoredSubscription(event.data.object.id);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object);
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

// Only a full refund revokes; a partial refund leaves the purchase in place.
// Charges without a payments row (subscription invoices) are ignored.
async function handleChargeRefunded(charge: Stripe.Charge) {
  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!charge.refunded || !paymentIntentId) return;

  const supabase = createSupabaseAdminClient();
  const { data: payment, error } = await supabase
    .from('payments')
    .select('user_id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  // Throw so the webhook answers 500 and Stripe retries the refund.
  if (error) throw new Error(`Failed to look up refunded payment: ${error.message}`);
  if (!payment?.user_id) return;

  await markPaymentRefunded(payment.user_id, 'stripe_payment_intent_id', paymentIntentId);
}

async function handleSuccessfulSubscription(session: Stripe.Checkout.Session, userId: string) {
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  await createOrUpdateSubscription(userId, customerId, subscriptionId);
}

// The live endpoint sends 2024-11-20.acacia payloads, where an invoice names
// its subscription in `subscription`. From 2025-03-31.basil on, which the
// SDK's types follow, it is in `parent.subscription_details`.
type InvoicePayload = Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };

async function handleInvoice(invoice: InvoicePayload) {
  const subscription = invoice.parent?.subscription_details?.subscription ?? invoice.subscription;
  if (!subscription) return;
  await syncStoredSubscription(typeof subscription === 'string' ? subscription : subscription.id);
}

// Only a subscription already stored is updated. checkout.session.completed
// stores it, and the first invoice can arrive before that.
async function syncStoredSubscription(subscriptionId: string) {
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
    await supabase
      .from('plans')
      .update({
        plan,
        status: plan === 'free' ? 'cancelled' : 'active',
      })
      .eq('id', subscriptionData.user_id);
  }
}
