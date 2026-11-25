import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { getStripe } from '@/libs/payment/stripe/server';
import { GiftPrice } from '@/types/gift';
import { StripeProductMetadata } from '@/types/payment';

// The same catalog `/api/stripe/plans` reads; Stripe pages at 10 by default.
const PRICE_PAGE_SIZE = 100;

/** The one-time Stripe prices of the gift card products. */
export async function GET() {
  try {
    const prices = await getStripe().prices.list({
      expand: ['data.product'],
      active: true,
      limit: PRICE_PAGE_SIZE,
    });

    const giftPrices = prices.data.flatMap((price): GiftPrice[] => {
      const product = price.product as Stripe.Product & { metadata: StripeProductMetadata };
      const tier = product.metadata.gift;
      if (!product.active || price.recurring || price.unit_amount === null) return [];
      if (tier !== 'plus' && tier !== 'pro') return [];
      return [{ tier, productId: price.id, price: price.unit_amount, currency: price.currency }];
    });

    return NextResponse.json(giftPrices);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Error fetching gift prices' }, { status: 500 });
  }
}
