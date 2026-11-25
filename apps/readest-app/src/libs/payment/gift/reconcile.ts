import { GiftCardRow } from '@/types/gift';
import { UserPlan } from '@/types/quota';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { higherPlan } from '../entitlements';
import { syncUserPlan } from './claim';
import { giftTimeline } from './timeline';

const HOUR_MS = 3_600_000;
const DRAFT_TTL_MS = 7 * 24 * HOUR_MS;
// The cron runs every 10 minutes; the window is wide enough to survive missed
// runs, and a repeated sync is harmless.
const WINDOW_MS = 2 * HOUR_MS;
// How long after a gift ends its sync is still checked against the stored
// plan, in case it failed through the whole window.
const LOOKBACK_MS = 7 * 24 * HOUR_MS;
export const RECONCILE_PAGE_SIZE = 1000;
// Ids per `plans` read: they go in the query string.
const PLAN_READ_CHUNK = 200;

/**
 * The cron's jobs: hand cards to newly confirmed emails; re-sync every
 * recipient whose gift began, ended or was refunded since the last runs, or
 * whose stored plan is below their gift; and drop drafts that were never paid.
 */
export const reconcileGiftCards = async (
  now: Date = new Date(),
): Promise<{ claimed: number; synced: number; draftsDeleted: number }> => {
  const supabase = createSupabaseAdminClient();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const inWindow = (t: Date) => t > windowStart && t <= now;
  const lookbackStart = new Date(now.getTime() - LOOKBACK_MS);
  const recent = (t: Date) => t > lookbackStart && t <= windowStart;

  const swept = await supabase.rpc('claim_gifts_for_confirmed_emails');
  if (swept.error) throw swept.error;
  const claimedIds = (swept.data ?? []) as string[];
  const picked = new Set(claimedIds);

  // PostgREST answers at most `max-rows` rows (1000 on Supabase), so the
  // claimed cards are read a page at a time, after the last id read: an
  // offset would skip a card when one ahead of it leaves the set meanwhile.
  const active: GiftCardRow[] = [];
  for (let lastId: string | null = null; ; ) {
    let query = supabase
      .from('gift_cards')
      .select('*')
      .eq('status', 'active')
      .not('redeemed_at', 'is', null)
      .not('redeemed_by', 'is', null)
      .order('id');
    if (lastId) query = query.gt('id', lastId);
    const page = await query.range(0, RECONCILE_PAGE_SIZE - 1);
    if (page.error) throw page.error;
    const rows = (page.data ?? []) as GiftCardRow[];
    active.push(...rows);
    if (rows.length < RECONCILE_PAGE_SIZE) break;
    lastId = rows[rows.length - 1]!.id;
  }
  const byRecipient = new Map<string, GiftCardRow[]>();
  for (const card of active) {
    byRecipient.set(card.redeemed_by!, [...(byRecipient.get(card.redeemed_by!) ?? []), card]);
  }
  // What each holder's stored plan is checked against: their gift plan now,
  // and the tiers of any gift that ended within the lookback.
  const expected = new Map<string, { plan: UserPlan; ended: UserPlan[] }>();
  for (const [userId, cards] of byRecipient) {
    const { plan, boundaries, perCard } = giftTimeline(
      cards.map((c) => ({
        id: c.id,
        tier: c.tier,
        days: c.days,
        redeemedAt: new Date(c.redeemed_at!),
      })),
      now,
    );
    if (boundaries.some(inWindow)) {
      picked.add(userId);
      continue;
    }
    const ended = cards.filter((c) => recent(perCard[c.id]!.endsAt)).map((c) => c.tier);
    if (plan !== 'free' || ended.length > 0) expected.set(userId, { plan, ended });
  }

  // A sync that failed through the whole window would otherwise never be
  // retried. Every plan write counts the gift, so a stored plan below it can
  // only be a missed start; one still on a tier whose gift just ended, above
  // the gift now, is a missed end (or a payment the sync will keep). Once a
  // sync lands, neither matches.
  const holders = [...expected.keys()];
  for (let i = 0; i < holders.length; i += PLAN_READ_CHUNK) {
    const plans = await supabase
      .from('plans')
      .select('id, plan')
      .in('id', holders.slice(i, i + PLAN_READ_CHUNK));
    if (plans.error) throw plans.error;
    for (const row of (plans.data ?? []) as { id: string; plan: UserPlan }[]) {
      const { plan, ended } = expected.get(row.id)!;
      const missedStart = higherPlan(row.plan, plan) !== row.plan;
      const missedEnd = ended.includes(row.plan) && row.plan !== plan;
      if (missedStart || missedEnd) picked.add(row.id);
    }
  }

  // A refund can land between a claim and its plan sync; sync the recipient
  // again so a stale plan doesn't outlive the refund.
  const refunded = await supabase
    .from('gift_cards')
    .select('redeemed_by')
    .eq('status', 'refunded')
    .gt('updated_at', windowStart.toISOString())
    .lte('updated_at', now.toISOString())
    .not('redeemed_by', 'is', null);
  if (refunded.error) throw refunded.error;
  for (const row of (refunded.data ?? []) as Pick<GiftCardRow, 'redeemed_by'>[]) {
    picked.add(row.redeemed_by!);
  }

  let synced = 0;
  for (const userId of picked) {
    try {
      await syncUserPlan(userId);
      synced++;
    } catch (error) {
      console.error('gift reconcile: sync failed', error instanceof Error ? error.message : error);
    }
  }

  const drafts = await supabase
    .from('gift_cards')
    .delete()
    .eq('status', 'pending')
    .lt('created_at', new Date(now.getTime() - DRAFT_TTL_MS).toISOString())
    .select('id');
  if (drafts.error) throw drafts.error;

  return { claimed: claimedIds.length, synced, draftsDeleted: (drafts.data ?? []).length };
};
