import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { getStripe } from '@/libs/stripe/server';
import { UserPlan } from '@/types/user';

export async function GET() {
  try {
    const stripe = getStripe();
    const prices = await stripe.prices.list({
      expand: ['data.product'],
      active: true,
      type: 'recurring',
    });

    const plans = prices.data
      .filter((price) => {
        const product = price.product as Stripe.Product;
        return product.active === true;
      })
      .map((price) => {
        const product = price.product as Stripe.Product & {
          metadata: { plan: UserPlan };
        };
        return {
          plan: product.metadata.plan,
          price_id: price.id,
          price: price.unit_amount,
          currency: price.currency,
          interval: price.recurring?.interval,
          product: price.product,
        };
      });

    return NextResponse.json(plans);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Error fetching subscription plans' }, { status: 500 });
  }
}
