import { GiftCardRow } from '@/types/gift';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { syncUserPlan } from './claim';
import { giftTimeline } from './timeline';

const HOUR_MS = 3_600_000;
const DRAFT_TTL_MS = 7 * 24 * HOUR_MS;
// The cron runs every 10 minutes; the window is wide enough to survive missed
// runs, and a repeated sync is harmless.
const WINDOW_MS = 2 * HOUR_MS;

/**
 * The cron's three jobs: hand cards to newly confirmed emails, re-sync every
 * recipient whose gift began, ended or was refunded since the last runs, and
 * drop drafts that were never paid.
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

  const active = await supabase
    .from('gift_cards')
    .select('*')
    .eq('status', 'active')
    .not('redeemed_at', 'is', null)
    .not('redeemed_by', 'is', null);
  if (active.error) throw active.error;
  const byRecipient = new Map<string, GiftCardRow[]>();
  for (const card of (active.data ?? []) as GiftCardRow[]) {
    byRecipient.set(card.redeemed_by!, [...(byRecipient.get(card.redeemed_by!) ?? []), card]);
  }
  for (const [userId, cards] of byRecipient) {
    const { boundaries } = giftTimeline(
      cards.map((c) => ({
        id: c.id,
        tier: c.tier,
        days: c.days,
        redeemedAt: new Date(c.redeemed_at!),
      })),
      now,
    );
    if (boundaries.some(inWindow)) picked.add(userId);
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
