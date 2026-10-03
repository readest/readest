import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { getStripe } from '@/libs/payment/stripe/server';
import { StripeProductMetadata } from '@/types/payment';

// Stripe pages list endpoints at 10 by default. The catalog (monthly +
// yearly Plus/Pro, plus the one-time storage add-ons) is already larger than
// that, and truncation drops the *oldest* prices first — i.e. the original
// monthly plans would silently vanish from the store front.
const PRICE_PAGE_SIZE = 100;

// Clients older than 0.9.69 pick a plan with `availablePlans.find((p) => p.plan
// === userPlan)`: no interval filter, so they take whatever the API returns
// first. Stripe lists newest-first, which would put a freshly created yearly
// price ahead of its monthly sibling and make those clients render the yearly
// amount labelled "/month". Pinning monthly ahead of yearly keeps them on the
// price they have always shown; current clients filter on `interval` and are
// indifferent to the order.
const INTERVAL_ORDER: Record<string, number> = { month: 0, year: 1 };
const intervalRank = (price: Stripe.Price) => {
  const interval = price.recurring?.interval;
  if (!interval) return 2; // one-time purchases sort after subscriptions
  return INTERVAL_ORDER[interval] ?? 3;
};

export async function GET() {
  try {
    const stripe = getStripe();
    const prices = await stripe.prices.list({
      expand: ['data.product'],
      active: true,
      limit: PRICE_PAGE_SIZE,
    });

    const plans = prices.data
      .filter((price) => {
        const product = price.product as Stripe.Product;
        return product.active === true;
      })
      // Array.prototype.sort is stable, so prices sharing an interval keep the
      // order Stripe returned them in.
      .sort((a, b) => intervalRank(a) - intervalRank(b))
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
