import { GiftCardRow } from '@/types/gift';
import { UserPlan } from '@/types/quota';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { getHighestActiveGiftPlan, resolveUserPlan } from '../entitlements';
import { normalizeGiftCode } from './code';
import { normalizeEmail } from './validate';

/**
 * Recompute the user's plan from every source and write it. `plans.status` is
 * set only when a gift is what entitles the user; a paid plan's status belongs
 * to its provider.
 */
export const syncUserPlan = async (userId: string): Promise<UserPlan> => {
  const now = new Date();
  const [plan, giftPlan] = await Promise.all([
    resolveUserPlan(userId, { now }),
    getHighestActiveGiftPlan(userId, now),
  ]);
  const { error } = await createSupabaseAdminClient()
    .from('plans')
    .update(plan !== 'free' && giftPlan === plan ? { plan, status: 'active' } : { plan })
    .eq('id', userId);
  if (error) throw error;
  return plan;
};

// Every claim, by email or by code, is this one conditional update on a paid,
// unclaimed card. An email claim and a code redeemed at the same moment race
// on the row lock, and the second finds no row. "Claimed" is `redeemed_at`:
// `redeemed_by` goes null when the recipient deletes their account, and the
// card must not be claimable again.
const claimCards = async (
  userId: string,
  column: 'code' | 'recipient_email',
  value: string,
): Promise<GiftCardRow[]> => {
  const { data, error } = await createSupabaseAdminClient()
    .from('gift_cards')
    .update({ redeemed_by: userId, redeemed_at: new Date().toISOString() })
    .eq(column, value)
    .eq('status', 'active')
    .eq('test', false)
    .is('redeemed_at', null)
    .select();
  if (error) throw error;
  const claimed = (data ?? []) as GiftCardRow[];
  if (claimed.length === 0) return claimed;
  // The claim is committed, so failing here would only make a retry report
  // the code as used. The cron re-syncs a recipient whose gift began since
  // its last runs.
  try {
    await syncUserPlan(userId);
  } catch (error) {
    console.error('Gift claim: plan sync failed', { column, userId }, error);
  }
  return claimed;
};

/** Redeem a code. `null` means it is invalid, refunded or already claimed. */
export const claimGiftCardByCode = async (
  code: string,
  userId: string,
): Promise<GiftCardRow | null> =>
  (await claimCards(userId, 'code', normalizeGiftCode(code)))[0] ?? null;

/** Whether a code is a test card's, which no one can claim. */
export const isTestGiftCode = async (code: string): Promise<boolean> => {
  const { data, error } = await createSupabaseAdminClient()
    .from('gift_cards')
    .select('id')
    .eq('code', normalizeGiftCode(code))
    .eq('test', true);
  if (error) throw error;
  return (data ?? []).length > 0;
};

/** Claim every unclaimed card addressed to this (confirmed) email. */
export const claimGiftCardsForEmail = async (userId: string, email: string): Promise<number> =>
  (await claimCards(userId, 'recipient_email', normalizeEmail(email))).length;
