/**
 * The plans grid replaced a one-card-at-a-time swipe carousel, so its layout
 * invariants now matter: at most two tiers abreast at any width, one on phones,
 * cards in a row flush to a common bottom edge, and never a horizontal scroll.
 *
 * Needs real layout and real Tailwind, so it runs as a browser test.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { page } from 'vitest/browser';

import { AvailablePlan, PlanInterval, UserPlan } from '@/types/quota';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, params?: Record<string, string | number>): string =>
      params ? key.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params[name] ?? '')) : key,
}));

const { default: PlansComparison } = await import('@/app/user/components/PlansComparison');
await import('@/styles/globals.css');

const plan = (
  userPlan: UserPlan,
  interval: PlanInterval,
  price: number,
  productId: string,
  productName: string = userPlan,
): AvailablePlan => ({ plan: userPlan, productId, price, currency: 'USD', interval, productName });

const CATALOG: AvailablePlan[] = [
  plan('plus', 'month', 499, 'price_month_plus'),
  plan('pro', 'month', 999, 'price_month_pro'),
  plan('plus', 'year', 3999, 'price_year_plus'),
  plan('pro', 'year', 7999, 'price_year_pro'),
  plan('purchase', 'lifetime', 199, 'com.bilingify.readest.storage.1gb.purchase', '1 GB'),
  plan('purchase', 'lifetime', 349, 'com.bilingify.readest.storage.2gb.purchase', '2 GB'),
  plan('purchase', 'lifetime', 799, 'com.bilingify.readest.storage.5gb.purchase', '5 GB'),
  plan('purchase', 'lifetime', 1499, 'com.bilingify.readest.storage.10gb.purchase', '10 GB'),
];

// The store front sits in the profile page's max-w-4xl column.
const renderGrid = (userPlan: UserPlan = 'free') =>
  render(
    <div className='bg-base-200 mx-auto w-full max-w-4xl p-6'>
      <PlansComparison availablePlans={CATALOG} userPlan={userPlan} onSubscribe={() => {}} />
    </div>,
  );

const cards = () =>
  Array.from(document.querySelectorAll('div.bg-base-100.rounded-lg')).filter((el) =>
    el.className.includes('h-full'),
  ) as HTMLElement[];

afterEach(() => cleanup());

beforeAll(async () => {
  await page.viewport(1280, 1024);
});

describe('plans grid layout', () => {
  it('never goes wider than two columns, however wide the viewport', async () => {
    for (const width of [1280, 1600, 2560]) {
      await page.viewport(width, 1024);
      renderGrid();

      expect(cards()).toHaveLength(4);
      const tops = cards().map((card) => Math.round(card.getBoundingClientRect().top));
      // Four cards over two columns is two rows, never one.
      expect(new Set(tops).size).toBe(2);
      cleanup();
    }
  });

  it('aligns the call-to-action buttons within a row', async () => {
    await page.viewport(1280, 1024);
    renderGrid();

    const bottoms = cards().map((card) => Math.round(card.getBoundingClientRect().bottom));
    // One shared bottom edge per row, so two distinct values across two rows.
    expect(new Set(bottoms).size).toBe(2);
  });

  it('drops to a single column on a phone', async () => {
    await page.viewport(390, 844);
    renderGrid();

    const rows = new Set(cards().map((c) => Math.round(c.getBoundingClientRect().top)));
    expect(rows.size).toBe(4);
  });

  it('never scrolls the page sideways on a phone', async () => {
    await page.viewport(390, 844);
    renderGrid();

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });

  it('keeps the interval toggle on one line', async () => {
    await page.viewport(390, 844);
    renderGrid();

    const group = screen.getByRole('group', { name: 'Billing interval' });
    const [monthly, yearly] = Array.from(group.querySelectorAll('button')) as HTMLElement[];
    expect(Math.round(monthly!.getBoundingClientRect().top)).toBe(
      Math.round(yearly!.getBoundingClientRect().top),
    );
  });
});
