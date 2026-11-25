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
  if (card.status !== 'active' || !card.recipient_email || card.redeemed_at) return card;
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
    .is('redeemed_at', null);
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
  /** Bought in a store's sandbox, so paid for by no one: never claimable. */
  test?: boolean;
}

const activate = async ({
  buyerId,
  tier,
  provider,
  column,
  paymentRef,
  giftCardId,
  test = false,
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
    // Never hand one buyer's card (and its code) to another, nor write their
    // draft onto it: its email would redirect the gift.
    if (card && card.buyer_id !== buyerId) throw new Error('gift card belongs to another buyer');
    if (card && pending) return mergeDraft(card, pending);
    if (card) return card;

    const paid = {
      status: 'active',
      provider,
      tier,
      test,
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
// Handing a card to its recipient never fails the call that made or saved
// it: the payment (Play refunds a purchase left unconsumed) or the email
// already stands, and the cron's email sweep claims the card later.
const claimOrKeep = async (card: GiftCardRow): Promise<GiftCardRow> => {
  try {
    return await claimForRecipient(card);
  } catch (error) {
    console.error('Gift card: claim for the recipient failed', { cardId: card.id }, error);
    return card;
  }
};

export const activateGiftCard = async (payment: GiftPayment): Promise<GiftCardRow> =>
  claimOrKeep(await activate(payment));

const sentStatus = (card: GiftCardRow): SentGiftStatus => {
  if (card.status === 'refunded') return 'refunded';
  if (card.redeemed_at) return 'redeemed';
  if (card.recipient_email) return 'waiting';
  return 'unredeemed';
};

const cardFace = (card: GiftCardRow) => ({
  tier: card.tier,
  recipientName: card.recipient_name ?? '',
  senderName: card.sender_name ?? '',
  message: card.message ?? '',
});

/**
 * What the buyer may see of a card they sent. Routes return this, never the
 * row: it is built field by field so the buyer never learns who redeemed a
 * code.
 */
export const toSentGiftCard = (card: GiftCardRow): SentGiftCard => ({
  ...cardFace(card),
  id: card.id,
  status: sentStatus(card),
  test: card.test,
  recipientEmail: card.recipient_email,
  code: card.redeemed_at ? null : formatGiftCode(card.code),
  purchasedAt: card.purchased_at ?? card.created_at,
  redeemedAt: card.redeemed_at,
});

/**
 * Edit a card the buyer sent, until it is claimed. The email can be set once;
 * sending the email the card already has leaves it as it is.
 */
export const updateSentGiftCard = async (
  buyerId: string,
  cardId: string,
  patch: GiftCardPatch,
): Promise<SentGiftCard | 'not_found' | 'email_locked'> => {
  const face = {
    ...(patch.recipientName !== undefined ? { recipient_name: patch.recipientName } : {}),
    ...(patch.senderName !== undefined ? { sender_name: patch.senderName } : {}),
    ...(patch.message !== undefined ? { message: patch.message } : {}),
    // Keeps the update non-empty for a patch with nothing to write; the
    // trigger stamps the real time.
    updated_at: new Date().toISOString(),
  };
  const editable = (values: Record<string, string>) =>
    createSupabaseAdminClient()
      .from('gift_cards')
      .update(values)
      .eq('id', cardId)
      .eq('buyer_id', buyerId)
      .eq('status', 'active')
      .is('redeemed_at', null);
  const firstRow = ({ data, error }: { data: unknown; error: unknown }) => {
    if (error) throw error;
    return ((data ?? []) as GiftCardRow[])[0];
  };

  const email = patch.recipientEmail || null;
  if (!email) {
    const card = firstRow(await editable(face).select());
    return card ? toSentGiftCard(card) : 'not_found';
  }

  const added = firstRow(
    await editable({ ...face, recipient_email: email })
      .is('recipient_email', null)
      .select(),
  );
  if (added) return toSentGiftCard(await claimOrKeep(added));
  const unchanged = firstRow(await editable(face).eq('recipient_email', email).select());
  return unchanged ? toSentGiftCard(unchanged) : 'email_locked';
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
  if (!recipient) return;
  // The card is refunded either way. A failed sync fails the call: every
  // caller is a refund webhook or a refunded checkout, whose provider
  // redelivers for days, and each redelivery re-stamps the card and reopens
  // the cron's window. Logging it instead left the cron two hours, then
  // nothing.
  await syncUserPlan(recipient);
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
    sent: ((sent.data ?? []) as GiftCardRow[]).map(toSentGiftCard),
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
