import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import {
  getStripe,
  createOrUpdatePayment,
  createOrUpdateSubscription,
} from '@/libs/payment/stripe/server';
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

    // Bind the entitlement to the session's owner, not the caller. `sessionId`
    // is client-supplied and Stripe sessions share a global id space, so without
    // this check any authenticated user could replay one paid session id to
    // upgrade their own (or many) accounts (GHSA-pv88-3727-j7v8). The checkout
    // route stamps `metadata.userId`; the webhook relies on the same field.
    if (session.metadata?.['userId'] !== user.id) {
      return NextResponse.json({ error: 'Session does not belong to user' }, { status: 403 });
    }

    const customerId = session.customer as string;
    if (session.payment_status === 'paid' && session.subscription) {
      await createOrUpdateSubscription(user.id, customerId, session.subscription as string);
    } else if (session.payment_status === 'paid' && session.payment_intent) {
      await createOrUpdatePayment(user.id, customerId, sessionId);
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
