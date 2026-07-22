import type { SupabaseClient } from '@supabase/supabase-js';

// Pure reconciliation logic, unit-tested from the app suite
// (src/__tests__/workers/iap-reconcile.test.ts). Kept separate from index.ts so
// it has no dependency on the Worker runtime globals.

export interface SubscriptionDrift {
  appleDrift: number;
  googleDrift: number;
}

const IAP_SUBSCRIPTION_TABLES = {
  apple: 'apple_iap_subscriptions',
  google: 'google_iap_subscriptions',
} as const;

const countDrift = async (supabase: SupabaseClient, table: string): Promise<number> => {
  // Drift = a subscription still marked active in our DB whose store expiry has
  // already passed, i.e. a renewal/expiry webhook we never received.
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .lt('expires_date', new Date().toISOString());

  if (error) {
    throw new Error(`Failed to count drift in ${table}: ${error.message}`);
  }
  return count ?? 0;
};

export async function countSubscriptionDrift(supabase: SupabaseClient): Promise<SubscriptionDrift> {
  const [appleDrift, googleDrift] = await Promise.all([
    countDrift(supabase, IAP_SUBSCRIPTION_TABLES.apple),
    countDrift(supabase, IAP_SUBSCRIPTION_TABLES.google),
  ]);
  return { appleDrift, googleDrift };
}

export interface ReconcileDataPoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

/** Build the Analytics Engine data point for a reconciliation sweep. Writes to
 *  the same `iap_webhooks` dataset the main worker uses for webhook events. */
export function buildReconcileDataPoint(
  event: SubscriptionDrift & { durationMs: number },
): ReconcileDataPoint {
  return {
    indexes: ['reconcile'],
    blobs: ['reconcile', event.appleDrift + event.googleDrift > 0 ? 'drift' : 'ok'],
    doubles: [event.appleDrift, event.googleDrift, event.durationMs],
  };
}
