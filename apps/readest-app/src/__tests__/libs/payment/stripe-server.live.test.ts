import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';

// Live integration test for `getHighestActivePlan` against the real Stripe API.
//
// Skipped by default (including in CI) — it only runs when you explicitly opt
// in by providing a live key and a target customer id. To run it locally:
//
//   STRIPE_SECRET_KEY=sk_live_xxx \
//   STRIPE_TEST_CUSTOMER_ID=cus_xxx \
//   STRIPE_TEST_EXPECTED_PLAN=pro \
//   pnpm test src/__tests__/libs/payment/stripe-server.live.test.ts
//
// Point STRIPE_TEST_CUSTOMER_ID at a customer that holds overlapping active
// subscriptions (e.g. Plus + Pro after an upgrade) to verify the helper
// resolves to the highest plan. STRIPE_TEST_EXPECTED_PLAN is optional; when
// omitted the test just asserts a valid plan and logs the resolved value.
//
// The module under test is imported dynamically inside the test body so that
// when the test is skipped the file stays import-safe (it pulls in Supabase,
// whose top-level setup needs env that CI does not provide for this lane).

const stripeKey = process.env['STRIPE_SECRET_KEY'] || process.env['STRIPE_SECRET_KEY_DEV'];
const customerId = process.env['STRIPE_TEST_CUSTOMER_ID'];
const expectedPlan = process.env['STRIPE_TEST_EXPECTED_PLAN'];

describe('getHighestActivePlan (live Stripe)', () => {
  it.skipIf(!stripeKey || !customerId)(
    'resolves the highest active plan for a real customer',
    async () => {
      const { getHighestActivePlan } = await import('@/libs/payment/stripe/server');

      const stripe = new Stripe(stripeKey!, {
        httpClient: Stripe.createFetchHttpClient(),
      });
      const plan = await getHighestActivePlan(stripe, customerId!);
      console.info(`[live] highest active plan for ${customerId}: ${plan}`);

      if (expectedPlan) {
        expect(plan).toBe(expectedPlan);
      } else {
        expect(['free', 'plus', 'pro', 'purchase']).toContain(plan);
      }
    },
  );
});
