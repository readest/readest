import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { getStripe } from '@/libs/payment/stripe/server';
import { StripeProductMetadata } from '@/types/payment';

export async function GET() {
  try {
    const stripe = getStripe();
    const prices = await stripe.prices.list({
      expand: ['data.product'],
      active: true,
    });

    const plans = prices.data
      .filter((price) => {
        const product = price.product as Stripe.Product;
        return product.active === true;
      })
      .map((price) => {
        const product = price.product as Stripe.Product & {
          metadata: StripeProductMetadata;
        };
        return {
          plan: product.metadata.plan,
          productId: price.id,
          price: price.unit_amount,
          currency: price.currency,
          interval: price.recurring?.interval,
          product: price.product,
          productName: product.name,
          metadata: product.metadata,
          price_id: price.id, // deprecated
        };
      });

    return NextResponse.json(plans);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Error fetching subscription plans' }, { status: 500 });
  }
}
