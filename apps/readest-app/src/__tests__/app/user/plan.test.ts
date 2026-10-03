import { describe, it, expect } from 'vitest';
import {
  getPlanDetails,
  getSubscriptionIntervals,
  getYearlySavingsPercent,
  shouldUseBillingPortal,
} from '@/app/user/utils/plan';
import { AvailablePlan, UserPlan, PlanInterval, QuotaFeature } from '@/types/quota';
import { StripeProductMetadata } from '@/types/payment';

// getPlanDetails expects (AvailablePlan & StripeAvailablePlan)[].
// StripeAvailablePlan = AvailablePlan & { metadata?: StripeProductMetadata; product?: Stripe.Product }
// We build the exact shape needed to satisfy the type.

type TestPlan = AvailablePlan & {
  metadata?: StripeProductMetadata;
};

function makePlan(overrides: Partial<TestPlan> = {}): TestPlan {
  return {
    plan: 'free' as UserPlan,
    productId: 'prod_test',
    price: 0,
    currency: 'USD',
    interval: 'month' as PlanInterval,
    productName: 'Test Plan',
    ...overrides,
  };
}

describe('getPlanDetails', () => {
  describe('free plan', () => {
    it('should return free plan details with no available plans', () => {
      const result = getPlanDetails('free', []);
      expect(result.name).toBe('Free Plan');
      expect(result.plan).toBe('free');
      expect(result.type).toBe('subscription');
      expect(result.price).toBe(0);
      expect(result.currency).toBe('USD');
    });

    it('should use currency from available plans', () => {
      const plans = [makePlan({ plan: 'free', currency: 'EUR' })];
      const result = getPlanDetails('free', plans);
      expect(result.currency).toBe('EUR');
    });

    it('should include features array', () => {
      const result = getPlanDetails('free', []);
      expect(result.features.length).toBeGreaterThan(0);
      const labels = result.features.map((f) => f.label);
      expect(labels).toContain('Cross-Platform Sync');
      expect(labels).toContain('AI Read Aloud');
    });

    it('should include limits', () => {
      const result = getPlanDetails('free', []);
      expect(result.limits).toBeDefined();
      expect(Object.keys(result.limits!).length).toBeGreaterThan(0);
    });

    it('should use month interval label by default', () => {
      const result = getPlanDetails('free', []);
      expect(result.interval).toBe('month');
    });

    it('should use year interval label when specified', () => {
      const result = getPlanDetails('free', [], 'year');
      expect(result.interval).toBe('year');
    });

    it('should set productId from matching available plan', () => {
      const plans = [makePlan({ plan: 'free', productId: 'prod_free_123' })];
      const result = getPlanDetails('free', plans);
      expect(result.productId).toBe('prod_free_123');
    });
  });

  describe('plus plan', () => {
    it('should return plus plan details', () => {
      const plans = [makePlan({ plan: 'plus', price: 499 })];
      const result = getPlanDetails('plus', plans);
      expect(result.name).toBe('Plus Plan');
      expect(result.plan).toBe('plus');
      expect(result.type).toBe('subscription');
      expect(result.price).toBe(499);
    });

    it('should use default price when no matching plan found', () => {
      const result = getPlanDetails('plus', []);
      expect(result.price).toBe(499);
    });

    it('should include expected features', () => {
      const result = getPlanDetails('plus', []);
      const labels = result.features.map((f) => f.label);
      expect(labels).toContain('Includes All Free Plan Benefits');
      expect(labels).toContain('Unlimited AI Read Aloud Hours');
      expect(labels).toContain('Priority Support');
    });

    it('should include limits with storage and translation', () => {
      const result = getPlanDetails('plus', []);
      expect(result.limits).toBeDefined();
      const limitKeys = Object.keys(result.limits!);
      expect(limitKeys.some((k) => k.includes('Storage'))).toBe(true);
      expect(limitKeys.some((k) => k.includes('Translation'))).toBe(true);
    });

    it('should match correct plan by interval', () => {
      const plans = [
        makePlan({ plan: 'plus', price: 499, interval: 'month' }),
        makePlan({ plan: 'plus', price: 3999, interval: 'year' }),
      ];
      const monthResult = getPlanDetails('plus', plans, 'month');
      expect(monthResult.price).toBe(499);

      const yearResult = getPlanDetails('plus', plans, 'year');
      expect(yearResult.price).toBe(3999);
    });
  });

  describe('pro plan', () => {
    it('should return pro plan details', () => {
      const plans = [makePlan({ plan: 'pro', price: 999 })];
      const result = getPlanDetails('pro', plans);
      expect(result.name).toBe('Pro Plan');
      expect(result.plan).toBe('pro');
      expect(result.type).toBe('subscription');
      expect(result.price).toBe(999);
    });

    it('should use default price when no matching plan found', () => {
      const result = getPlanDetails('pro', []);
      expect(result.price).toBe(999);
    });

    it('should include expected features', () => {
      const result = getPlanDetails('pro', []);
      const labels = result.features.map((f) => f.label);
      expect(labels).toContain('Includes All Plus Plan Benefits');
      expect(labels).toContain('Early Feature Access');
      expect(labels).toContain('Advanced AI Tools');
    });

    it('should have higher storage limit than plus', () => {
      const proResult = getPlanDetails('pro', []);
      const plusResult = getPlanDetails('plus', []);

      // Both should have limits
      expect(proResult.limits).toBeDefined();
      expect(plusResult.limits).toBeDefined();

      // Find storage limit values
      const proStorageKey = Object.keys(proResult.limits!).find((k) => k.includes('Storage'));
      const plusStorageKey = Object.keys(plusResult.limits!).find((k) => k.includes('Storage'));
      expect(proStorageKey).toBeDefined();
      expect(plusStorageKey).toBeDefined();

      // Pro should have 20 GB, Plus should have 5 GB
      expect(proResult.limits![proStorageKey!]).toBe('20 GB');
      expect(plusResult.limits![plusStorageKey!]).toBe('5 GB');
    });
  });

  describe('purchase plan', () => {
    it('should return purchase plan details', () => {
      const plans = [makePlan({ plan: 'purchase', price: 1999 })];
      const result = getPlanDetails('purchase', plans);
      expect(result.name).toBe('Lifetime Plan');
      expect(result.plan).toBe('purchase');
      expect(result.type).toBe('purchase');
      expect(result.interval).toBe('lifetime');
    });

    it('should use default price when no matching plan found', () => {
      const result = getPlanDetails('purchase', []);
      expect(result.price).toBe(1999);
    });

    it('should include products sorted by price', () => {
      const plans = [
        makePlan({
          plan: 'purchase',
          productId: 'prod_expensive',
          price: 5000,
          productName: 'Expensive',
        }),
        makePlan({ plan: 'purchase', productId: 'prod_cheap', price: 1000, productName: 'Cheap' }),
        makePlan({ plan: 'purchase', productId: 'prod_mid', price: 3000, productName: 'Mid' }),
      ];
      const result = getPlanDetails('purchase', plans);
      expect(result.products).toBeDefined();
      expect(result.products).toHaveLength(3);
      expect(result.products![0]!.price).toBe(1000);
      expect(result.products![1]!.price).toBe(3000);
      expect(result.products![2]!.price).toBe(5000);
    });

    it('should derive feature from productId when metadata.feature is missing', () => {
      const plans = [
        makePlan({
          plan: 'purchase',
          productId: 'prod_storage_100gb',
          price: 1000,
          productName: 'Storage',
        }),
        makePlan({
          plan: 'purchase',
          productId: 'prod_translation_pack',
          price: 500,
          productName: 'Translation',
        }),
        makePlan({
          plan: 'purchase',
          productId: 'prod_tokens_bundle',
          price: 2000,
          productName: 'Tokens',
        }),
        makePlan({
          plan: 'purchase',
          productId: 'prod_customization_pro',
          price: 1500,
          productName: 'Custom',
        }),
      ];
      const result = getPlanDetails('purchase', plans);
      expect(result.products![0]!.feature).toBe('translation');
      expect(result.products![1]!.feature).toBe('storage');
      expect(result.products![2]!.feature).toBe('customization');
      expect(result.products![3]!.feature).toBe('tokens');
    });

    it('should use metadata.feature when present', () => {
      const plans = [
        makePlan({
          plan: 'purchase',
          productId: 'prod_xyz',
          price: 1000,
          productName: 'XYZ',
          metadata: { plan: 'purchase', feature: 'storage' as QuotaFeature },
        }),
      ];
      const result = getPlanDetails('purchase', plans);
      expect(result.products![0]!.feature).toBe('storage');
    });

    it('should fall back to generic when productId does not match any feature', () => {
      const plans = [
        makePlan({
          plan: 'purchase',
          productId: 'prod_unknown_thing',
          price: 1000,
          productName: 'Unknown',
        }),
      ];
      const result = getPlanDetails('purchase', plans);
      expect(result.products![0]!.feature).toBe('generic');
    });

    it('should include expected features', () => {
      const result = getPlanDetails('purchase', []);
      const labels = result.features.map((f) => f.label);
      expect(labels).toContain('One-Time Payment');
      expect(labels).toContain('Expand Cloud Sync Storage');
    });
  });

  describe('default / unknown plan', () => {
    it('should fall back to free plan for unknown plan code', () => {
      const result = getPlanDetails('unknown_plan' as UserPlan, []);
      expect(result.plan).toBe('free');
      expect(result.name).toBe('Free Plan');
    });
  });

  describe('plan color and hintColor', () => {
    it('should assign distinct colors per plan', () => {
      const colors: Record<string, string> = {};
      const planCodes: UserPlan[] = ['free', 'plus', 'pro', 'purchase'];
      for (const code of planCodes) {
        const details = getPlanDetails(code, []);
        colors[code] = details.color;
      }
      // Each plan should have a unique color
      const uniqueColors = new Set(Object.values(colors));
      expect(uniqueColors.size).toBe(4);
    });

    it('should provide hintColor for all plans', () => {
      const planCodes: UserPlan[] = ['free', 'plus', 'pro', 'purchase'];
      for (const code of planCodes) {
        const details = getPlanDetails(code, []);
        expect(details.hintColor).toBeTruthy();
      }
    });
  });

  describe('plan without interval match', () => {
    it('should handle plan with no interval specified', () => {
      // A plan with no interval should match any interval request
      const plans = [
        makePlan({ plan: 'purchase', price: 1999, interval: undefined as unknown as PlanInterval }),
      ];
      // When interval is not set on available plan, it should still be found
      const result = getPlanDetails('purchase', plans);
      expect(result.price).toBe(1999);
    });
  });
});

describe('yearly billing', () => {
  const catalog = [
    makePlan({ plan: 'plus', productId: 'price_month_plus', price: 499, interval: 'month' }),
    makePlan({ plan: 'plus', productId: 'price_year_plus', price: 3999, interval: 'year' }),
    makePlan({ plan: 'pro', productId: 'price_month_pro', price: 999, interval: 'month' }),
    makePlan({ plan: 'pro', productId: 'price_year_pro', price: 7999, interval: 'year' }),
  ];

  describe('getPlanDetails with a yearly interval', () => {
    it('selects the yearly price and productId', () => {
      const result = getPlanDetails('plus', catalog, 'year');
      expect(result.price).toBe(3999);
      expect(result.productId).toBe('price_year_plus');
    });

    it('selects the monthly price and productId', () => {
      const result = getPlanDetails('plus', catalog, 'month');
      expect(result.price).toBe(499);
      expect(result.productId).toBe('price_month_plus');
    });

    it('falls back to a yearly default rather than the monthly price', () => {
      // A tier with no yearly price must never present the monthly amount as
      // if it were the annual one.
      const result = getPlanDetails('pro', [], 'year');
      expect(result.price).not.toBe(999);
      expect(result.price).toBeGreaterThan(999);
    });
  });

  describe('getSubscriptionIntervals', () => {
    it('offers only monthly when the store has no yearly price', () => {
      const monthlyOnly = catalog.filter((p) => p.interval === 'month');
      expect(getSubscriptionIntervals(monthlyOnly)).toEqual(['month']);
    });

    it('offers yearly once any subscription tier has a yearly price', () => {
      expect(getSubscriptionIntervals(catalog)).toEqual(['month', 'year']);
    });

    it('ignores lifetime purchases when deciding', () => {
      const purchases = [
        makePlan({ plan: 'purchase', productId: 'price_1gb', price: 199, interval: 'lifetime' }),
      ];
      expect(getSubscriptionIntervals(purchases)).toEqual(['month']);
    });

    it('offers only monthly for an empty catalog', () => {
      expect(getSubscriptionIntervals([])).toEqual(['month']);
    });
  });

  describe('getYearlySavingsPercent', () => {
    it('computes the discount against twelve monthly payments', () => {
      // plus: 3999 vs 5988 -> 33.2%, pro: 7999 vs 11988 -> 33.3%
      expect(getYearlySavingsPercent(catalog)).toBe(33);
    });

    it('reports the largest saving across tiers', () => {
      const uneven = [
        makePlan({ plan: 'plus', price: 500, interval: 'month' }),
        makePlan({ plan: 'plus', price: 3000, interval: 'year' }), // 50%
        makePlan({ plan: 'pro', price: 1000, interval: 'month' }),
        makePlan({ plan: 'pro', price: 10800, interval: 'year' }), // 10%
      ];
      expect(getYearlySavingsPercent(uneven)).toBe(50);
    });

    it('returns null when a tier lacks one of the two intervals', () => {
      const monthlyOnly = catalog.filter((p) => p.interval === 'month');
      expect(getYearlySavingsPercent(monthlyOnly)).toBeNull();
    });

    it('returns null when the yearly price is not actually cheaper', () => {
      const noSaving = [
        makePlan({ plan: 'plus', price: 499, interval: 'month' }),
        makePlan({ plan: 'plus', price: 5988, interval: 'year' }),
      ];
      expect(getYearlySavingsPercent(noSaving)).toBeNull();
    });
  });

  describe('shouldUseBillingPortal', () => {
    it('sends an existing subscriber to the portal so Stripe swaps in place', () => {
      expect(shouldUseBillingPortal('plus', 'subscription')).toBe(true);
      expect(shouldUseBillingPortal('pro', 'subscription')).toBe(true);
    });

    it('sends a free user to checkout', () => {
      expect(shouldUseBillingPortal('free', 'subscription')).toBe(false);
    });

    it('sends a lifetime/storage-only user to checkout', () => {
      // `purchase` means storage add-ons with no active subscription, so there
      // is nothing for the portal to switch.
      expect(shouldUseBillingPortal('purchase', 'subscription')).toBe(false);
    });

    it('never routes a one-time purchase through the portal', () => {
      expect(shouldUseBillingPortal('plus', 'purchase')).toBe(false);
      expect(shouldUseBillingPortal('pro', 'purchase')).toBe(false);
    });
  });
});
