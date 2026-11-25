// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GiftDb } from '../../helpers/gift-db';

// The cron claims cards for newly confirmed emails, re-syncs the plan of every
// recipient whose gift started or ended since the last run, and drops stale
// unpaid drafts.

const h = vi.hoisted(() => ({
  db: null as GiftDb | null,
  synced: [] as string[],
  failFor: null as string | null,
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => h.db!.client,
}));

vi.mock('@/libs/payment/gift/claim', () => ({
  syncUserPlan: async (userId: string) => {
    if (userId === h.failFor) throw new Error('boom');
    h.synced.push(userId);
    return 'free';
  },
}));

import { RECONCILE_PAGE_SIZE, reconcileGiftCards } from '@/libs/payment/gift/reconcile';

const NOW = new Date('2026-12-01T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const claimed = (redeemedBy: string, redeemedAgo: number, extra = {}) =>
  h.db!.addCard({
    tier: 'plus',
    status: 'active',
    redeemed_by: redeemedBy,
    redeemed_at: ago(redeemedAgo),
    ...extra,
  });

beforeEach(() => {
  h.db = new GiftDb();
  h.synced = [];
  h.failFor = null;
});

describe('reconcileGiftCards', () => {
  it('syncs recipients whose gift just ended', async () => {
    claimed('ended', 365 * DAY + HOUR);
    const result = await reconcileGiftCards(NOW);
    expect(h.synced).toEqual(['ended']);
    expect(result).toMatchObject({ claimed: 0, synced: 1 });
  });

  // PostgREST caps a response at max-rows, so one select would miss the rest.
  it('syncs recipients beyond the first page of claimed cards', async () => {
    for (let i = 0; i <= RECONCILE_PAGE_SIZE; i++) claimed(`ended-${i}`, 365 * DAY + HOUR);

    const result = await reconcileGiftCards(NOW);

    expect(result.synced).toBe(RECONCILE_PAGE_SIZE + 1);
  });

  it('skips recipients with no boundary in the window', async () => {
    claimed('long-ago', 400 * DAY);
    claimed('mid-gift', 100 * DAY);
    await reconcileGiftCards(NOW);
    expect(h.synced).toEqual([]);
  });

  it('syncs recipients the email sweep claimed', async () => {
    h.db!.sweepClaims = ['swept', 'swept'];
    claimed('swept', 100 * DAY);
    const result = await reconcileGiftCards(NOW);
    expect(h.synced).toEqual(['swept']);
    expect(result).toMatchObject({ claimed: 2, synced: 1 });
  });

  it('syncs recipients of a card refunded in the window', async () => {
    claimed('refunded-recently', 100 * DAY, { status: 'refunded', updated_at: ago(HOUR) });
    claimed('refunded-long-ago', 100 * DAY, { status: 'refunded', updated_at: ago(30 * DAY) });
    await reconcileGiftCards(NOW);
    expect(h.synced).toEqual(['refunded-recently']);
  });

  // Review (CodeRabbit): a claim whose plan sync failed for the whole window
  // was never retried. Every plan write counts the gift, so a stored plan
  // below it can only be a missed sync, whenever the claim was.
  it('syncs a recipient whose stored plan is below their gift, outside the window', async () => {
    claimed('stale', 3 * HOUR);
    h.db!.rows('plans').push({ id: 'stale', plan: 'free' });

    await reconcileGiftCards(NOW);

    expect(h.synced).toEqual(['stale']);
  });

  it('leaves a recipient whose stored plan already covers the gift', async () => {
    claimed('covered', 3 * HOUR);
    claimed('paying-pro', 3 * HOUR);
    h.db!.rows('plans').push({ id: 'covered', plan: 'plus' }, { id: 'paying-pro', plan: 'pro' });

    await reconcileGiftCards(NOW);

    expect(h.synced).toEqual([]);
  });

  it("one failing recipient doesn't stop the rest", async () => {
    claimed('a', 365 * DAY + HOUR);
    claimed('b', 365 * DAY + HOUR);
    h.failFor = 'a';
    const result = await reconcileGiftCards(NOW);
    expect(h.synced).toEqual(['b']);
    expect(result.synced).toBe(1);
  });

  it('deletes drafts older than 7 days', async () => {
    const old = h.db!.addCard({ status: 'pending', created_at: ago(8 * DAY) });
    const fresh = h.db!.addCard({ status: 'pending', created_at: ago(DAY) });
    const result = await reconcileGiftCards(NOW);
    expect(h.db!.card(old.id)).toBeUndefined();
    expect(h.db!.card(fresh.id)).toBeDefined();
    expect(result.draftsDeleted).toBe(1);
  });
});
