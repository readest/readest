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
import { revokeGiftCardForPayment } from '@/libs/payment/gift/server';

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

  // Review (CodeRabbit): offset paging skips a card when one ahead of it
  // leaves the active set between pages.
  it('reads every claimed card when one leaves the active set between pages', async () => {
    for (let i = 0; i <= RECONCILE_PAGE_SIZE; i++) claimed(`ended-${i}`, 365 * DAY + HOUR);
    const byId = () =>
      [...h.db!.rows('gift_cards')].sort((a, b) => (String(a['id']) < String(b['id']) ? -1 : 1));
    const last = byId().at(-1)!;
    const client = h.db!.client;
    const from = client.from.bind(client);
    let cardReads = 0;
    client.from = ((table: string) => {
      // Before the second page, the first card is refunded.
      if (table === 'gift_cards' && ++cardReads === 2) byId()[0]!['status'] = 'refunded';
      return from(table);
    }) as typeof client.from;

    await reconcileGiftCards(NOW);

    expect(h.synced).toContain(last['redeemed_by']);
  });

  // Review (CodeRabbit): a gift's end whose sync failed through the whole
  // window left the recipient on the ended tier.
  it('re-syncs a recipient whose gift ended outside the window while plans still has it', async () => {
    claimed('ended-pro', 365 * DAY + 3 * HOUR, { tier: 'pro' });
    h.db!.rows('plans').push({ id: 'ended-pro', plan: 'pro' });

    await reconcileGiftCards(NOW);

    expect(h.synced).toEqual(['ended-pro']);
  });

  it('re-syncs when a Pro gift ended outside the window and a Plus gift carries on', async () => {
    claimed('pro-then-plus', 365 * DAY + 3 * HOUR, { tier: 'pro' });
    claimed('pro-then-plus', 300 * DAY);
    h.db!.rows('plans').push({ id: 'pro-then-plus', plan: 'pro' });

    await reconcileGiftCards(NOW);

    expect(h.synced).toEqual(['pro-then-plus']);
  });

  it('leaves a settled recipient alone once the recent boundary is past the lookback', async () => {
    claimed('long-ended', 365 * DAY + 10 * DAY, { tier: 'pro' });
    claimed('mid-plus', 100 * DAY);
    h.db!.rows('plans').push({ id: 'long-ended', plan: 'pro' }, { id: 'mid-plus', plan: 'pro' });

    await reconcileGiftCards(NOW);

    expect(h.synced).toEqual([]);
  });

  // Review (CodeRabbit): a refund whose recipient sync failed long ago is
  // retried by the provider; its redelivery re-stamps the card (the guard
  // trigger), which brings the recipient back into the cron's window.
  it('a redelivered refund brings its recipient back into the window', async () => {
    claimed('refunded-friend', 100 * DAY, {
      status: 'refunded',
      stripe_payment_intent_id: 'pi_old',
      updated_at: ago(30 * DAY),
    });
    h.db!.clock = () => ago(10 * 60_000);
    h.failFor = 'refunded-friend';
    await expect(revokeGiftCardForPayment('stripe_payment_intent_id', 'pi_old')).rejects.toThrow();
    h.failFor = null;

    await reconcileGiftCards(NOW);

    expect(h.synced).toEqual(['refunded-friend']);
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
