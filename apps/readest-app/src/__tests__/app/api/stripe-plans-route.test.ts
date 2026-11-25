// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

// Adding yearly prices to the existing Plus/Pro products has to stay invisible
// to clients older than 0.9.69, whose `getPlanDetails` predates the interval
// filter and simply takes `availablePlans.find((p) => p.plan === userPlan)` —
// the *first* match in API order. Stripe lists prices newest-first, so a fresh
// yearly price would otherwise land in front of the monthly one and those
// clients would render the yearly amount labelled "/month".

const listMock = vi.fn();

vi.mock('@/libs/payment/stripe/server', () => ({
  getStripe: () => ({ prices: { list: (...a: unknown[]) => listMock(...a) } }),
}));

import { GET } from '@/app/api/stripe/plans/route';
import { GET as getGiftPrices } from '@/app/api/gift/prices/route';

type PriceFixture = {
  id: string;
  unit_amount: number;
  currency: string;
  recurring: { interval: string } | null;
  product: Partial<Stripe.Product>;
};

const price = (
  id: string,
  plan: string,
  interval: 'month' | 'year' | null,
  unit_amount: number,
): PriceFixture => ({
  id,
  unit_amount,
  currency: 'usd',
  recurring: interval ? { interval } : null,
  product: {
    id: `prod_${plan}`,
    active: true,
    name: plan,
    metadata: { plan },
  } as Partial<Stripe.Product>,
});

// Gift cards are one-time prices on products marked `metadata.gift` and no
// `metadata.plan`.
const giftPrice = (id: string, gift: string, unit_amount: number, active = true): PriceFixture => ({
  id,
  unit_amount,
  currency: 'usd',
  recurring: null,
  product: {
    id: `prod_gift_${gift}`,
    active,
    name: `Gift ${gift}`,
    metadata: { gift },
  } as Partial<Stripe.Product>,
});

const giftPrices = [
  giftPrice('price_gift_plus', 'plus', 3999),
  giftPrice('price_gift_pro', 'pro', 7999),
  giftPrice('price_gift_pro_archived', 'pro', 6999, false),
];

// The order Stripe itself returns: most recently created first, so the newly
// added yearly prices come before the long-lived monthly ones.
const newestFirst = [
  price('price_year_plus', 'plus', 'year', 3999),
  price('price_year_pro', 'pro', 'year', 7999),
  price('price_month_plus', 'plus', 'month', 499),
  price('price_month_pro', 'pro', 'month', 999),
  price('price_storage_1gb', 'purchase', null, 199),
];

beforeEach(() => {
  listMock.mockReset().mockResolvedValue({ data: newestFirst });
});

describe('GET /api/stripe/plans', () => {
  it('asks Stripe for the whole catalog instead of the default page of 10', async () => {
    await GET();

    expect(listMock).toHaveBeenCalledTimes(1);
    const params = listMock.mock.calls[0]![0] as Stripe.PriceListParams;
    // Without an explicit limit Stripe returns 10 and silently truncates the
    // oldest entries — which are the original monthly Plus/Pro prices.
    expect(params.limit).toBe(100);
  });

  it('returns the monthly price before the yearly one for the same plan', async () => {
    const plans = await GET().then((res) => res.json());

    const plusIds = plans.filter((p: { plan: string }) => p.plan === 'plus');
    expect(plusIds[0].productId).toBe('price_month_plus');
    expect(plusIds[1].productId).toBe('price_year_plus');

    const proIds = plans.filter((p: { plan: string }) => p.plan === 'pro');
    expect(proIds[0].productId).toBe('price_month_pro');
    expect(proIds[1].productId).toBe('price_year_pro');
  });

  it('leaves a legacy client that takes the first match on the monthly price', async () => {
    const plans = await GET().then((res) => res.json());

    // Exactly what pre-0.9.69 getPlanDetails does.
    const legacyPick = plans.find((p: { plan: string }) => p.plan === 'plus');
    expect(legacyPick.productId).toBe('price_month_plus');
    expect(legacyPick.price).toBe(499);
  });

  it('still returns one-time purchase prices', async () => {
    const plans = await GET().then((res) => res.json());

    const purchases = plans.filter((p: { plan: string }) => p.plan === 'purchase');
    expect(purchases).toHaveLength(1);
    expect(purchases[0].productId).toBe('price_storage_1gb');
    expect(purchases[0].interval).toBeUndefined();
  });

  it('exposes the recurring interval so current clients can filter on it', async () => {
    const plans = await GET().then((res) => res.json());

    const yearly = plans.find((p: { productId: string }) => p.productId === 'price_year_plus');
    expect(yearly.interval).toBe('year');
  });

  it('leaves gift products out of the plan list', async () => {
    listMock.mockResolvedValue({ data: [...giftPrices, ...newestFirst] });

    const plans = await GET().then((res) => res.json());

    expect(plans.map((p: { productId: string }) => p.productId)).toEqual([
      'price_month_plus',
      'price_month_pro',
      'price_year_plus',
      'price_year_pro',
      'price_storage_1gb',
    ]);
  });
});

describe('GET /api/gift/prices', () => {
  it('returns { tier, productId, price, currency } only for gift products', async () => {
    listMock.mockResolvedValue({ data: [...newestFirst, ...giftPrices] });

    const res = await getGiftPrices();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { tier: 'plus', productId: 'price_gift_plus', price: 3999, currency: 'usd' },
      { tier: 'pro', productId: 'price_gift_pro', price: 7999, currency: 'usd' },
    ]);
    const params = listMock.mock.calls[0]![0] as Stripe.PriceListParams;
    expect(params).toMatchObject({ active: true, limit: 100 });
  });
});
