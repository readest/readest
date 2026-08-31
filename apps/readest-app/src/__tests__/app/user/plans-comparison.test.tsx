import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PlansComparison from '@/app/user/components/PlansComparison';
import { AvailablePlan, PlanInterval, UserPlan } from '@/types/quota';

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
});
