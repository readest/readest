import {
  GiftCardPatch,
  GiftCardRow,
  GiftCardsResponse,
  GiftDraftInput,
  GiftPaymentColumn,
  GiftTier,
  ReceivedGiftCard,
  SentGiftCard,
  SentGiftStatus,
} from '@/types/gift';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { getHighestActiveIapPlan, getHighestActiveStripePlan, higherPlan } from '../entitlements';
import { claimGiftCardsForEmail, syncUserPlan } from './claim';
import { formatGiftCode, generateGiftCode } from './code';
import { giftTimeline } from './timeline';

const UNIQUE_VIOLATION = '23505';

const readCard = async (id: string): Promise<GiftCardRow> => {
  const { data, error } = await createSupabaseAdminClient()
    .from('gift_cards')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as GiftCardRow;
};

/** Insert the `pending` card the buyer writes before paying. */
export const createGiftDraft = async (
  buyerId: string,
  input: GiftDraftInput,
): Promise<{ id: string }> => {
  const draft = {
    buyer_id: buyerId,
    status: 'pending',
    tier: input.tier,
    recipient_name: input.recipientName,
    sender_name: input.senderName,
    message: input.message,
    recipient_email: input.recipientEmail,
  };
  // A draft has no payment reference yet, so a unique violation can only be
  // on `code`.
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await createSupabaseAdminClient()
      .from('gift_cards')
      .insert({ ...draft, code: generateGiftCode() })
      .select('id')
      .single();
    if (error?.code === UNIQUE_VIOLATION && attempt === 0) continue;
    if (error) throw error;
    return { id: (data as { id: string }).id };
  }
};

/**
 * An addressed card goes to the confirmed account with its email at once, if
 * there is one. Otherwise the recipient claims it at sign-in, or the cron does.
 */
const claimForRecipient = async (card: GiftCardRow): Promise<GiftCardRow> => {
  if (card.status !== 'active' || !card.recipient_email || card.redeemed_by) return card;
  const { data: userId, error } = await createSupabaseAdminClient().rpc('gift_user_id_for_email', {
    p_email: card.recipient_email,
  });
  if (error) throw error;
  if (!userId) return card;
  const claimed = await claimGiftCardsForEmail(userId as string, card.recipient_email);
  return claimed > 0 ? readCard(card.id) : card;
};

/**
 * The payment reached us before its draft did (a store notification, a
 * restore), so a card with an empty message exists. Fill it from the draft the
 * buyer wrote and drop the draft. A claimed card is frozen and left as it is.
 */
const mergeDraft = async (card: GiftCardRow, draft: GiftCardRow): Promise<GiftCardRow> => {
  const supabase = createSupabaseAdminClient();
  const setEmail = card.recipient_email === null && draft.recipient_email !== null;
  let update = supabase
    .from('gift_cards')
    .update({
      recipient_name: draft.recipient_name,
      sender_name: draft.sender_name,
      message: draft.message,
      ...(setEmail ? { recipient_email: draft.recipient_email } : {}),
    })
    .eq('id', card.id)
    .is('redeemed_by', null);
  if (setEmail) update = update.is('recipient_email', null);
  const { data, error } = await update.select();
  if (error) throw error;

  const { error: deleteError } = await supabase
    .from('gift_cards')
    .delete()
    .eq('id', draft.id)
    .eq('status', 'pending');
  if (deleteError) throw deleteError;

  return ((data ?? []) as GiftCardRow[])[0] ?? readCard(card.id);
};

interface GiftPayment {
  buyerId: string;
  tier: GiftTier;
  provider: 'stripe' | 'apple' | 'google';
  column: GiftPaymentColumn;
  paymentRef: string;
  giftCardId?: string;
}

const activate = async ({
  buyerId,
  tier,
  provider,
  column,
  paymentRef,
  giftCardId,
}: GiftPayment): Promise<GiftCardRow> => {
  const supabase = createSupabaseAdminClient();
  // One payment is reported from several places (the webhook, the client's
  // verify, a store notification, a restore), possibly at once. Losing a race
  // shows up as a unique violation on the reference or a draft that is no
  // longer pending, and the second pass then finds the card the winner made.
  for (let attempt = 0; attempt < 2; attempt++) {
    const [existing, draft] = await Promise.all([
      supabase.from('gift_cards').select('*').eq(column, paymentRef).maybeSingle(),
      giftCardId
        ? supabase
            .from('gift_cards')
            .select('*')
            .eq('id', giftCardId)
            .eq('buyer_id', buyerId)
            .eq('status', 'pending')
            .maybeSingle()
        : { data: null, error: null },
    ]);
    if (existing.error) throw existing.error;
    if (draft.error) throw draft.error;
    const card = existing.data as GiftCardRow | null;
    const pending = draft.data as GiftCardRow | null;
    // Never write one buyer's draft onto another buyer's card: its email
    // would redirect the gift.
    if (card && pending && card.buyer_id === buyerId) return mergeDraft(card, pending);
    if (card) return card;

    const paid = {
      status: 'active',
      provider,
      tier,
      [column]: paymentRef,
      purchased_at: new Date().toISOString(),
    };
    const { data, error } = pending
      ? await supabase
          .from('gift_cards')
          .update(paid)
          .eq('id', pending.id)
          .eq('status', 'pending')
          .select()
      : await supabase
          .from('gift_cards')
          .insert({ ...paid, buyer_id: buyerId, code: generateGiftCode(), message: '' })
          .select();
    if (error && error.code !== UNIQUE_VIOLATION) throw error;
    const activated = ((data ?? []) as GiftCardRow[])[0];
    if (activated) return activated;
  }
  // Throwing lets the provider retry, and a retry is idempotent.
  throw new Error(`Gift card activation for ${column} ${paymentRef} lost two races`);
};

/**
 * Turn a gift payment into an active card, idempotent on the payment
 * reference: the buyer's draft when there is one, otherwise a card with an
 * empty message for the buyer to fill in.
 */
export const activateGiftCard = async (payment: GiftPayment): Promise<GiftCardRow> =>
  claimForRecipient(await activate(payment));

const sentStatus = (card: GiftCardRow): SentGiftStatus => {
  if (card.status === 'refunded') return 'refunded';
  if (card.redeemed_by) return 'redeemed';
  if (card.recipient_email) return 'waiting';
  return 'unredeemed';
};

const cardFace = (card: GiftCardRow) => ({
  tier: card.tier,
  recipientName: card.recipient_name ?? '',
  senderName: card.sender_name ?? '',
  message: card.message ?? '',
});

// Built field by field: the buyer must never learn who redeemed a code.
const toSentCard = (card: GiftCardRow): SentGiftCard => ({
  ...cardFace(card),
  id: card.id,
  status: sentStatus(card),
  recipientEmail: card.recipient_email,
  code: card.redeemed_by ? null : formatGiftCode(card.code),
  purchasedAt: card.purchased_at ?? card.created_at,
  redeemedAt: card.redeemed_at,
});

/**
 * Edit a card the buyer sent, until it is claimed. The email can be set once.
 */
export const updateSentGiftCard = async (
  buyerId: string,
  cardId: string,
  patch: GiftCardPatch,
): Promise<SentGiftCard | 'not_found' | 'email_locked'> => {
  const email = patch.recipientEmail || null;
  const values = {
    ...(patch.recipientName !== undefined ? { recipient_name: patch.recipientName } : {}),
    ...(patch.senderName !== undefined ? { sender_name: patch.senderName } : {}),
    ...(patch.message !== undefined ? { message: patch.message } : {}),
    ...(email ? { recipient_email: email } : {}),
    // Keeps the update non-empty for a patch with nothing to write; the
    // trigger stamps the real time.
    updated_at: new Date().toISOString(),
  };
  let update = createSupabaseAdminClient()
    .from('gift_cards')
    .update(values)
    .eq('id', cardId)
    .eq('buyer_id', buyerId)
    .eq('status', 'active')
    .is('redeemed_by', null);
  if (email) update = update.is('recipient_email', null);
  const { data, error } = await update.select();
  if (error) throw error;

  const card = ((data ?? []) as GiftCardRow[])[0];
  if (!card) return email ? 'email_locked' : 'not_found';
  return toSentCard(email ? await claimForRecipient(card) : card);
};

/** Take back the gift bought with a refunded payment. */
export const revokeGiftCardForPayment = async (
  column: GiftPaymentColumn,
  value: string,
): Promise<void> => {
  const { data, error } = await createSupabaseAdminClient()
    .from('gift_cards')
    .update({ status: 'refunded' })
    .eq(column, value)
    .select('redeemed_by');
  if (error) throw error;
  const recipient = ((data ?? []) as Pick<GiftCardRow, 'redeemed_by'>[])[0]?.redeemed_by;
  if (recipient) await syncUserPlan(recipient);
};

/** The cards a user sent and received, and where their gifts stand at `now`. */
export const listGiftCards = async (
  userId: string,
  now: Date = new Date(),
): Promise<GiftCardsResponse> => {
  const supabase = createSupabaseAdminClient();
  const [sent, received] = await Promise.all([
    supabase
      .from('gift_cards')
      .select('*')
      .eq('buyer_id', userId)
      .neq('status', 'pending')
      .order('purchased_at', { ascending: false }),
    supabase
      .from('gift_cards')
      .select('*')
      .eq('redeemed_by', userId)
      .eq('status', 'active')
      .order('redeemed_at', { ascending: false }),
  ]);
  if (sent.error) throw sent.error;
  if (received.error) throw received.error;

  const receivedCards = (received.data ?? []) as GiftCardRow[];
  const timeline = giftTimeline(
    receivedCards.map((card) => ({
      id: card.id,
      tier: card.tier,
      days: card.days,
      redeemedAt: new Date(card.redeemed_at!),
    })),
    now,
  );

  let giftOnly = false;
  if (timeline.plan !== 'free') {
    const [stripePlan, iapPlan] = await Promise.all([
      getHighestActiveStripePlan(userId),
      getHighestActiveIapPlan(userId),
    ]);
    giftOnly = higherPlan(stripePlan, iapPlan) === 'free';
  }

  return {
    sent: ((sent.data ?? []) as GiftCardRow[]).map(toSentCard),
    received: receivedCards.map(
      (card): ReceivedGiftCard => ({
        ...cardFace(card),
        id: card.id,
        startsAt: timeline.perCard[card.id]!.startsAt.toISOString(),
        endsAt: timeline.perCard[card.id]!.endsAt.toISOString(),
      }),
    ),
    giftPlan: timeline.plan,
    giftActiveUntil: timeline.activeUntil?.toISOString() ?? null,
    giftOnly,
  };
};
