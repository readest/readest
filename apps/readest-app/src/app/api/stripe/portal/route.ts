import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/libs/payment/stripe/server';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';

// Stripe subscription states that still represent a live subscription the user
// can switch between billing periods.
const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];

export async function POST(request: NextRequest) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  // Callers before the monthly/yearly switch shipped send no body at all.
  const { flow } = await request
    .json()
    .catch(() => ({ flow: undefined }) as { flow?: string })
    .then((body) => (body ?? {}) as { flow?: string });

  try {
    const supabase = createSupabaseAdminClient();
    const { data: customerData } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (!customerData?.stripe_customer_id) {
      throw new Error('Customer not found');
    }

    // Deep-link straight to the plan picker so "Change billing period" lands
    // where the user expects instead of the portal's front page. Requires
    // "Customers can switch plans" to be enabled in the portal configuration;
    // without a live subscription on file we fall back to the portal home.
    let flowData: Stripe.BillingPortal.SessionCreateParams['flow_data'];
    if (flow === 'subscription_update') {
      const { data: subscriptions } = await supabase
        .from('subscriptions')
        .select('stripe_subscription_id')
        .eq('user_id', user.id)
        .in('status', LIVE_SUBSCRIPTION_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1);

      const subscriptionId = subscriptions?.[0]?.stripe_subscription_id;
      if (subscriptionId) {
        flowData = {
          type: 'subscription_update',
          subscription_update: { subscription: subscriptionId },
        };
      }
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerData.stripe_customer_id,
      return_url: `${request.headers.get('origin')}/user`,
      ...(flowData ? { flow_data: flowData } : {}),
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Error creating portal session' }, { status: 500 });
  }
}
