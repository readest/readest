// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PlansComparison from '@/app/user/components/PlansComparison';
import { GiftPrice, GiftTier } from '@/types/gift';
import { AvailablePlan, PlanInterval, UserPlan } from '@/types/quota';
import { getLocale } from '@/utils/misc';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, params?: Record<string, string | number>): string =>
      params ? key.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params[name] ?? '')) : key,
}));

const plan = (
  userPlan: UserPlan,
  interval: PlanInterval,
  price: number,
  productId: string,
): AvailablePlan => ({
  plan: userPlan,
  productId,
  price,
  currency: 'USD',
  interval,
  productName: userPlan,
});

const MONTHLY_ONLY = [
  plan('plus', 'month', 499, 'price_month_plus'),
  plan('pro', 'month', 999, 'price_month_pro'),
];

const WITH_YEARLY = [
  ...MONTHLY_ONLY,
  plan('plus', 'year', 3999, 'price_year_plus'),
  plan('pro', 'year', 7999, 'price_year_pro'),
];

const planCard = (name: string) => screen.getByText(name).closest('div.bg-base-100') as HTMLElement;

afterEach(cleanup);

describe('PlansComparison', () => {
  it('hides the interval toggle until the store offers a yearly price', () => {
    render(<PlansComparison availablePlans={MONTHLY_ONLY} userPlan='free' onSubscribe={vi.fn()} />);

    expect(screen.queryByRole('group', { name: 'Billing interval' })).toBeNull();
    expect(screen.queryByText('Yearly')).toBeNull();
  });

  it('offers the switch with the real discount once yearly prices exist', () => {
    render(<PlansComparison availablePlans={WITH_YEARLY} userPlan='free' onSubscribe={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'Billing interval' })).toBeTruthy();
    // 3999 against 12 x 499 = 33% off.
    expect(screen.getByText('Save 33%')).toBeTruthy();
  });

  it('starts on monthly and checks out the monthly price', () => {
    const onSubscribe = vi.fn();
    render(
      <PlansComparison availablePlans={WITH_YEARLY} userPlan='free' onSubscribe={onSubscribe} />,
    );

    const plusCard = planCard('Plus Plan');
    expect(plusCard.textContent).toContain('4.99');

    fireEvent.click(within(plusCard).getByText('Upgrade to Plus Plan'));
    expect(onSubscribe).toHaveBeenCalledWith('price_month_plus');
  });

  it('shows the per-month equivalent and the amount actually charged on yearly', () => {
    render(<PlansComparison availablePlans={WITH_YEARLY} userPlan='free' onSubscribe={vi.fn()} />);

    fireEvent.click(screen.getByText('Yearly'));

    const plusCard = planCard('Plus Plan');
    // 3999 / 12 leads, with the real annual charge underneath.
    expect(plusCard.textContent).toContain('3.33');
    expect(plusCard.textContent).toContain('39.99 billed yearly');
  });

  it('checks out the yearly price once yearly is selected', () => {
    const onSubscribe = vi.fn();
    render(
      <PlansComparison availablePlans={WITH_YEARLY} userPlan='free' onSubscribe={onSubscribe} />,
    );

    fireEvent.click(screen.getByText('Yearly'));
    fireEvent.click(within(planCard('Pro Plan')).getByText('Upgrade to Pro Plan'));

    expect(onSubscribe).toHaveBeenCalledWith('price_year_pro');
  });

  it('lets an existing subscriber change billing period from their own tier', () => {
    const onSubscribe = vi.fn();
    render(
      <PlansComparison availablePlans={WITH_YEARLY} userPlan='plus' onSubscribe={onSubscribe} />,
    );

    fireEvent.click(screen.getByText('Yearly'));

    const plusCard = planCard('Plus Plan');
    expect(within(plusCard).getByText('Current Plan')).toBeTruthy();

    fireEvent.click(within(plusCard).getByText('Change billing period'));
    expect(onSubscribe).toHaveBeenCalledWith('price_year_plus');
  });

  // Review (CodeRabbit): an Upgrade button needs a product to subscribe to.
  it('offers no Upgrade for a tier whose product has not loaded', () => {
    render(
      <PlansComparison
        availablePlans={[plan('plus', 'month', 499, 'price_month_plus')]}
        userPlan='free'
        onSubscribe={vi.fn()}
      />,
    );

    expect(within(planCard('Plus Plan')).getByText('Upgrade to Plus Plan')).toBeTruthy();
    expect(within(planCard('Pro Plan')).queryByText('Upgrade to Pro Plan')).toBeNull();
  });

  it('offers no period switch when only monthly is sold', () => {
    render(<PlansComparison availablePlans={MONTHLY_ONLY} userPlan='plus' onSubscribe={vi.fn()} />);

    expect(screen.queryByText('Change billing period')).toBeNull();
  });

  it('keeps the lifetime tier out of the interval switch', () => {
    render(
      <PlansComparison
        availablePlans={[...WITH_YEARLY, plan('purchase', 'lifetime', 199, 'price_storage_1gb')]}
        userPlan='free'
        onSubscribe={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Yearly'));

    const lifetimeCard = planCard('Lifetime Plan');
    expect(lifetimeCard.textContent).toContain('On-Demand Purchase');
    expect(lifetimeCard.textContent).not.toContain('billed yearly');
  });

  describe('the Gift Card button', () => {
    const product = (productId: string, price: number, productName: string): AvailablePlan => ({
      ...plan('purchase', 'lifetime', price, productId),
      productName,
    });
    const STORAGE = product('price_storage_1gb', 199, '1 GB Storage');
    const CUSTOMIZATION = product('price_customization', 999, 'Full Customization');

    it.each([
      ['for sale', [STORAGE, CUSTOMIZATION], false],
      ['coming soon', [STORAGE], false],
    ] as const)('follows Full Customization (%s) in the Lifetime card and opens the gift view', (_state, products, customizationPurchased) => {
      const onGiftCard = vi.fn();
      const onSubscribe = vi.fn();
      render(
        <PlansComparison
          availablePlans={[...WITH_YEARLY, ...products]}
          userPlan='free'
          customizationPurchased={customizationPurchased}
          onSubscribe={onSubscribe}
          onGiftCard={onGiftCard}
        />,
      );

      const card = within(planCard('Lifetime Plan'));
      const customization = card.getByText(/^Full Customization/);
      const giftCard = card.getByRole('button', { name: 'Gift Card' });
      expect(
        customization.compareDocumentPosition(giftCard) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(card.getAllByRole('button').at(-1)).toBe(giftCard);

      fireEvent.click(giftCard);
      expect(onGiftCard).toHaveBeenCalledTimes(1);
      expect(onSubscribe).not.toHaveBeenCalled();
    });

    const usd = (cents: number) =>
      new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'usd' }).format(
        cents / 100,
      );
    const lifetime = (props: Partial<Parameters<typeof PlansComparison>[0]> = {}) =>
      render(
        <PlansComparison
          availablePlans={[...WITH_YEARLY, STORAGE, CUSTOMIZATION]}
          userPlan='free'
          onSubscribe={vi.fn()}
          onGiftCard={vi.fn()}
          {...props}
        />,
      );

    // Owner: "When Full Customization is unlocked, put it at the end of the products".
    it('an unlocked Full Customization moves to the end, after the Gift Card', () => {
      lifetime({ customizationPurchased: true });

      const card = within(planCard('Lifetime Plan'));
      const giftCard = card.getByRole('button', { name: 'Gift Card' });
      const unlocked = card.getByText('Full Customization (Unlocked)');
      expect(
        giftCard.compareDocumentPosition(unlocked) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(card.getAllByRole('button').at(-1)).toBe(giftCard);
    });

    // Owner: "the unlocked full customization has darker color for other
    // clickable products, this is counterintuitive".
    it.each([
      ['unlocked', [STORAGE, CUSTOMIZATION], true, 'Full Customization (Unlocked)'],
      ['coming soon', [STORAGE], false, 'Full Customization (Coming Soon)'],
    ] as const)('a Full Customization tile you cannot tap (%s) is quieter than the ones you can', (_state, products, customizationPurchased, label) => {
      lifetime({ availablePlans: [...WITH_YEARLY, ...products], customizationPurchased });

      const card = within(planCard('Lifetime Plan'));
      const status = card.getByText(label).parentElement!;
      const buyable = card.getByText('1 GB Storage').closest('button')!;
      // The tiles you can tap carry the tier's fill; this one carries none.
      expect(buyable.className).toMatch(/bg-emerald-/);
      expect(status.className).not.toMatch(/bg-emerald-/);
      expect(status.className).toContain('text-base-content/60');
    });

    // Owner: "Gift Card also has a price on it (starts from $49.99)".
    it('starts from the lowest gift price', () => {
      const GIFT_PRICES: GiftPrice[] = [
        { tier: 'pro', productId: 'price_gift_pro', price: 9999, currency: 'usd' },
        { tier: 'plus', productId: 'price_gift_plus', price: 4999, currency: 'usd' },
      ];
      lifetime({ giftPrices: GIFT_PRICES });

      const giftCard = within(planCard('Lifetime Plan')).getByRole('button', {
        name: /^Gift Card/,
      });
      expect(giftCard.textContent).toBe(`Gift CardFrom ${usd(4999)}`);
    });

    it('shows no price until the gift prices load', () => {
      lifetime({ giftPrices: [] });

      expect(
        within(planCard('Lifetime Plan')).getByRole('button', { name: /^Gift Card/ }).textContent,
      ).toBe('Gift Card');
    });

    // Owner: "Full Customization when unlocked, also has a price on it, which
    // is used as the price anchor".
    it('an unlocked Full Customization keeps its price', () => {
      lifetime({ customizationPurchased: true });

      const unlocked = within(planCard('Lifetime Plan')).getByText('Full Customization (Unlocked)');
      expect(unlocked.parentElement!.textContent).toBe(`Full Customization (Unlocked)${usd(999)}`);
    });

    it.each([
      ['unlocked', [STORAGE, CUSTOMIZATION], true, 'Full Customization (Unlocked)'],
      ['coming soon', [STORAGE], false, 'Full Customization (Coming Soon)'],
    ] as const)('sets Full Customization (%s) in the type of the other products', (_state, products, customizationPurchased, label) => {
      lifetime({ availablePlans: [...WITH_YEARLY, ...products], customizationPurchased });

      const card = within(planCard('Lifetime Plan'));
      expect(card.getByText(label).className).toBe(card.getByText('1 GB Storage').className);
    });

    // The Gift Card view also lists the cards you bought, so it must stay
    // reachable while the one-time products are missing.
    it('shows with no one-time products loaded', () => {
      render(
        <PlansComparison
          availablePlans={WITH_YEARLY}
          userPlan='free'
          onSubscribe={vi.fn()}
          onGiftCard={vi.fn()}
        />,
      );

      expect(
        within(planCard('Lifetime Plan')).getByRole('button', { name: 'Gift Card' }),
      ).toBeTruthy();
    });
  });

  describe('gift holders', () => {
    const GIFT_UNTIL = '2027-06-15T12:00:00.000Z';
    const gift = (giftOnly: boolean, tier: GiftTier = 'plus') => ({
      plan: tier,
      activeUntil: GIFT_UNTIL,
      giftOnly,
    });

    it('shows the gift chip with its end date on the gifted tier', () => {
      render(
        <PlansComparison
          availablePlans={WITH_YEARLY}
          userPlan='plus'
          gift={gift(true)}
          onSubscribe={vi.fn()}
        />,
      );

      const date = new Date(GIFT_UNTIL).toLocaleDateString(getLocale());
      const plusCard = planCard('Plus Plan');
      expect(within(plusCard).getByText(`Gift, until ${date}`)).toBeTruthy();
      expect(within(plusCard).queryByText('Current Plan')).toBeNull();
      expect(within(planCard('Pro Plan')).queryByText(/^Gift, until/)).toBeNull();
    });

    it('a gift-only holder gets Subscribe, not Change billing period', () => {
      const onSubscribe = vi.fn();
      render(
        <PlansComparison
          availablePlans={WITH_YEARLY}
          userPlan='plus'
          gift={gift(true)}
          onSubscribe={onSubscribe}
        />,
      );

      const plusCard = planCard('Plus Plan');
      expect(within(plusCard).queryByText('Change billing period')).toBeNull();
      fireEvent.click(within(plusCard).getByText('Subscribe to Plus Plan'));
      expect(onSubscribe).toHaveBeenCalledWith('price_month_plus');
    });

    // Owner rule: a gift holder can buy any plan at any time.
    it('a gift-only holder can subscribe to a tier below their gift', () => {
      const onSubscribe = vi.fn();
      render(
        <PlansComparison
          availablePlans={WITH_YEARLY}
          userPlan='pro'
          gift={gift(true, 'pro')}
          onSubscribe={onSubscribe}
        />,
      );

      const plusCard = planCard('Plus Plan');
      // "Upgrade" would be wrong: Plus is below the Pro gift.
      expect(within(plusCard).queryByText('Upgrade to Plus Plan')).toBeNull();
      fireEvent.click(within(plusCard).getByText('Subscribe to Plus Plan'));
      expect(onSubscribe).toHaveBeenCalledWith('price_month_plus');
      // Their own tier keeps the gift chip and its Subscribe button.
      const proCard = planCard('Pro Plan');
      expect(within(proCard).getByText(/^Gift, until/)).toBeTruthy();
      expect(within(proCard).getByText('Subscribe to Pro Plan')).toBeTruthy();
    });

    // Review (CodeRabbit): a Subscribe button needs a product to subscribe to.
    it('a gift-only holder gets no Subscribe for a tier with no product loaded', () => {
      render(
        <PlansComparison
          availablePlans={[plan('pro', 'month', 999, 'price_month_pro')]}
          userPlan='pro'
          gift={gift(true, 'pro')}
          onSubscribe={vi.fn()}
        />,
      );

      expect(within(planCard('Plus Plan')).queryByText('Subscribe to Plus Plan')).toBeNull();
      expect(within(planCard('Pro Plan')).getByText('Subscribe to Pro Plan')).toBeTruthy();
    });

    it('a lower tier stays without a button for a paying subscriber', () => {
      render(
        <PlansComparison
          availablePlans={WITH_YEARLY}
          userPlan='pro'
          gift={gift(false, 'pro')}
          onSubscribe={vi.fn()}
        />,
      );
      expect(within(planCard('Plus Plan')).queryByText('Upgrade to Plus Plan')).toBeNull();
      cleanup();

      render(<PlansComparison availablePlans={WITH_YEARLY} userPlan='pro' onSubscribe={vi.fn()} />);
      expect(within(planCard('Plus Plan')).queryByText('Upgrade to Plus Plan')).toBeNull();
    });

    // The chip would read as their paid plan ending.
    it('a gift holder who also pays for the tier sees Current Plan, not the gift chip', () => {
      render(
        <PlansComparison
          availablePlans={WITH_YEARLY}
          userPlan='plus'
          gift={gift(false)}
          onSubscribe={vi.fn()}
        />,
      );

      const plusCard = planCard('Plus Plan');
      expect(within(plusCard).getByText('Current Plan')).toBeTruthy();
      expect(within(plusCard).queryByText(/^Gift, until/)).toBeNull();
    });

    it('a gift holder with a paid plan keeps Change billing period', () => {
      render(
        <PlansComparison
          availablePlans={WITH_YEARLY}
          userPlan='plus'
          gift={gift(false)}
          onSubscribe={vi.fn()}
        />,
      );

      const plusCard = planCard('Plus Plan');
      expect(within(plusCard).getByText('Change billing period')).toBeTruthy();
      expect(within(plusCard).queryByText('Subscribe to Plus Plan')).toBeNull();
    });
  });
});
