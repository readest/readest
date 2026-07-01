import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Unit tests for the dedicated reconcile cron Worker's pure logic. The Worker
// itself (workers/iap-reconcile) is a self-contained Cloudflare project; only
// its runtime-agnostic helpers are exercised here.
import {
  buildReconcileDataPoint,
  countSubscriptionDrift,
} from '../../../workers/iap-reconcile/src/reconcile';

const makeSupabase = (counts: Record<string, number>) =>
  ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          lt: () => Promise.resolve({ count: counts[table] ?? 0, error: null }),
        }),
      }),
    }),
  }) as unknown as SupabaseClient;

describe('countSubscriptionDrift', () => {
  it('counts active-but-expired rows in both store tables', async () => {
    const supabase = makeSupabase({
      apple_iap_subscriptions: 2,
      google_iap_subscriptions: 1,
    });

    await expect(countSubscriptionDrift(supabase)).resolves.toEqual({
      appleDrift: 2,
      googleDrift: 1,
    });
  });

  it('reports zero drift when the stores are clean', async () => {
    await expect(countSubscriptionDrift(makeSupabase({}))).resolves.toEqual({
      appleDrift: 0,
      googleDrift: 0,
    });
  });

  it('throws when a query fails', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            lt: () => Promise.resolve({ count: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(countSubscriptionDrift(supabase)).rejects.toThrow(/boom/);
  });
});

describe('buildReconcileDataPoint', () => {
  it('flags drift and records counts as doubles', () => {
    expect(buildReconcileDataPoint({ appleDrift: 2, googleDrift: 1, durationMs: 30 })).toEqual({
      indexes: ['reconcile'],
      blobs: ['reconcile', 'drift'],
      doubles: [2, 1, 30],
    });
  });

  it('flags ok when there is no drift', () => {
    expect(buildReconcileDataPoint({ appleDrift: 0, googleDrift: 0, durationMs: 9 }).blobs).toEqual(
      ['reconcile', 'ok'],
    );
  });
});
