import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { getStripe } from '@/libs/stripe/server';
import { createOrUpdateSubscription } from '@/utils/stripe';
import { validateUserAndToken } from '@/utils/access';

export async function POST(request: Request) {
  const { sessionId } = await request.json();

  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;
      await createOrUpdateSubscription(user.id, customerId, subscriptionId);
    }

    return NextResponse.json({ session });
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
