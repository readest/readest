import { UserPlan } from '@/types/quota';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { mapProductIdToUserPlan } from './iap/utils';

type IapSubscriptionRow = { product_id: string; status: string };

// A user can hold subscriptions from several providers at once — most often
// while migrating between card billing and a mobile store, where the old
// subscription outlives the new one by a billing period. Rank the plans so the
// account always reflects the highest one, whichever provider's event fires.
const PLAN_RANK: Record<UserPlan, number> = {
  free: 0,
  purchase: 0,
  plus: 1,
  pro: 2,
};

export const higherPlan = (a: UserPlan, b: UserPlan): UserPlan =>
  PLAN_RANK[b] > PLAN_RANK[a] ? b : a;

const IAP_SUBSCRIPTION_TABLES = ['google_iap_subscriptions', 'apple_iap_subscriptions'] as const;

// The IAP tables collapse a purchase's status down to `active` / `expired`
// (see the upserts in `iap/*/server.ts`), so `active` is the only stored value
// that means "entitled". A subscription in its billing grace period is stored
// as `expired` even though the user still has access — which is why a handler
// processing such an event passes its own `entitledPlan` in below rather than
// relying on the row it just wrote.
const ENTITLED_STORED_IAP_STATUSES = ['active'];

/**
 * Highest plan still entitled by a stored in-app-purchase subscription. Reads
 * the IAP tables rather than the store APIs: every IAP handler persists its own
 * row before it touches `plans`, so the rows are already current by the time we
 * get here.
 */
export const getHighestActiveIapPlan = async (userId: string): Promise<UserPlan> => {
  const supabase = createSupabaseAdminClient();
  const results = await Promise.all(
    IAP_SUBSCRIPTION_TABLES.map((table) =>
      supabase
        .from(table)
        .select('product_id, status')
        .eq('user_id', userId)
        .in('status', ENTITLED_STORED_IAP_STATUSES),
    ),
  );

  let plan: UserPlan = 'free';
  for (const { data, error } of results) {
    // Never swallow this. A failed read is indistinguishable from "no store
    // subscription", and treating it as such downgrades a paying user to free.
    // Throwing instead lets the caller's webhook be retried by the provider.
    if (error) throw error;
    for (const row of (data ?? []) as IapSubscriptionRow[]) {
      plan = higherPlan(plan, mapProductIdToUserPlan(row.product_id, true));
    }
  }
  return plan;
};

/** Highest plan still entitled by an active (or trialing) Stripe subscription. */
export const getHighestActiveStripePlan = async (
  userId: string,
  stripeCustomerId?: string,
): Promise<UserPlan> => {
  let customerId = stripeCustomerId;
  if (!customerId) {
    const supabase = createSupabaseAdminClient();
    // `maybeSingle`, so that "this user has no Stripe customer" comes back as a
    // null row rather than as an error the way `single` reports it — otherwise
    // the two are indistinguishable here. And as with the IAP reads above, a
    // failed lookup must never be mistaken for "no Stripe subscription": that
    // would persist a downgrade for a user who is still paying by card.
    const { data, error } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    customerId = data?.stripe_customer_id;
  }
  if (!customerId) return 'free';

  // Imported lazily so the IAP handlers don't pull the Stripe SDK in at module
  // load, and so this module and `stripe/server` can reference each other.
  const { getStripe, getHighestActivePlan } = await import('./stripe/server');
  return getHighestActivePlan(getStripe(), customerId);
};

/**
 * The highest plan the user is entitled to across EVERY billing provider.
 *
 * Every writer of `plans.plan` must go through this. Resolving the plan from a
 * single provider is what let a Stripe cancellation wipe the plan of a user who
 * had moved to Google Play, and let a store expiry wipe the plan of a user who
 * had moved the other way.
 */
export const resolveUserPlan = async (
  userId: string,
  options: {
    /** Known Stripe customer, to skip the `customers` lookup. */
    stripeCustomerId?: string;
    /**
     * A plan the caller already knows the user is entitled to from the event it
     * is processing. Needed because the IAP tables cannot express a billing
     * grace period — see {@link ENTITLED_STORED_IAP_STATUSES}.
     */
    entitledPlan?: UserPlan;
  } = {},
): Promise<UserPlan> => {
  const [stripePlan, iapPlan] = await Promise.all([
    getHighestActiveStripePlan(userId, options.stripeCustomerId),
    getHighestActiveIapPlan(userId),
  ]);
  return higherPlan(higherPlan(stripePlan, iapPlan), options.entitledPlan ?? 'free');
};
