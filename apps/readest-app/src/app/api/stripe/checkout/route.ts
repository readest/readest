import { type NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/libs/payment/stripe/server';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';

const CHECKOUT_ERROR = 'Error creating checkout session';
const STRIPE_CHECKOUT_ERROR = 'Stripe rejected the checkout request';

export async function POST(request: NextRequest) {
  const {
    priceId,
    planType = 'subscription',
    embedded = true,
    metadata = {},
  } = await request.json();

  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  const enhancedMetadata = {
    ...metadata,
    userId: user.id,
  };

  try {
    const supabase = createSupabaseAdminClient();
    const { data: customerData } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    let customerId: string;
    if (!customerData?.stripe_customer_id) {
      const stripe = getStripe();
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user.id,
        },
      });
      customerId = customer.id;
      await supabase.from('customers').insert({
        user_id: user.id,
        stripe_customer_id: customerId,
      });
    } else {
      customerId = customerData.stripe_customer_id;
    }

    const stripe = getStripe();
    const successUrl = `${request.headers.get('origin')}/user/subscription/success?payment=stripe&session_id={CHECKOUT_SESSION_ID}`;
    const returnUrl = `${request.headers.get('origin')}/user`;
    const session = await stripe.checkout.sessions.create({
      ui_mode: embedded ? 'embedded_page' : 'hosted_page',
      customer: customerId,
      mode: planType === 'subscription' ? 'subscription' : 'payment',
      allow_promotion_codes: true,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: enhancedMetadata,
      success_url: embedded ? undefined : successUrl,
      cancel_url: embedded ? undefined : returnUrl,
      redirect_on_completion: embedded ? 'never' : undefined,
    });

    return NextResponse.json({
      url: session.url,
      sessionId: session.id,
      clientSecret: session.client_secret,
    });
  } catch (error) {
    console.error(error);

    if (!(error instanceof Stripe.errors.StripeError)) {
      return NextResponse.json({ error: CHECKOUT_ERROR }, { status: 500 });
    }

    const code = typeof error.code === 'string' ? error.code : undefined;
    const param = typeof error.param === 'string' ? error.param : undefined;
    return NextResponse.json(
      {
        error: CHECKOUT_ERROR,
        message: STRIPE_CHECKOUT_ERROR,
        code,
        param,
      },
      { status: 500 },
    );
  }
}
