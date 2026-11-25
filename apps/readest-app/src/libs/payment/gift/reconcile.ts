import { GiftCardRow, GiftTier } from '@/types/gift';
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

  const swept = await supabase.rpc('claim_gifts_for_confirmed_emails');
  if (swept.error) throw swept.error;
  const claimedIds = (swept.data ?? []) as string[];
  const picked = new Set(claimedIds);

  // PostgREST answers at most `max-rows` rows (1000 on Supabase), so the
  // claimed cards are read a page at a time, in a stable order.
  const active: GiftCardRow[] = [];
  for (let from = 0; ; from += RECONCILE_PAGE_SIZE) {
    const page = await supabase
      .from('gift_cards')
      .select('*')
      .eq('status', 'active')
      .not('redeemed_at', 'is', null)
      .not('redeemed_by', 'is', null)
      .order('id')
      .range(from, from + RECONCILE_PAGE_SIZE - 1);
    if (page.error) throw page.error;
    const rows = (page.data ?? []) as GiftCardRow[];
    active.push(...rows);
    if (rows.length < RECONCILE_PAGE_SIZE) break;
  }
  const byRecipient = new Map<string, GiftCardRow[]>();
  for (const card of active) {
    byRecipient.set(card.redeemed_by!, [...(byRecipient.get(card.redeemed_by!) ?? []), card]);
  }
  const gifted = new Map<string, GiftTier>();
  for (const [userId, cards] of byRecipient) {
    const { plan, boundaries } = giftTimeline(
      cards.map((c) => ({
        id: c.id,
        tier: c.tier,
        days: c.days,
        redeemedAt: new Date(c.redeemed_at!),
      })),
      now,
    );
    if (boundaries.some(inWindow)) picked.add(userId);
    else if (plan !== 'free') gifted.set(userId, plan);
  }

  // A claim whose plan sync failed through the whole window would otherwise
  // never be retried. Every plan write counts the gift, so a stored plan below
  // it can only be a missed sync; once a sync lands it no longer matches.
  const holders = [...gifted.keys()];
  for (let i = 0; i < holders.length; i += PLAN_READ_CHUNK) {
    const plans = await supabase
      .from('plans')
      .select('id, plan')
      .in('id', holders.slice(i, i + PLAN_READ_CHUNK));
    if (plans.error) throw plans.error;
    for (const row of (plans.data ?? []) as { id: string; plan: UserPlan }[]) {
      const gift = gifted.get(row.id)!;
      if (higherPlan(row.plan, gift) !== row.plan) picked.add(row.id);
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
