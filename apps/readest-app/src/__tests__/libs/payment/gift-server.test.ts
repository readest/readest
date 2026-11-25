// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserPlan } from '@/types/quota';
import type { GiftDraftInput } from '@/types/gift';
import { GiftDb } from '../../helpers/gift-db';

// A gift card is money the buyer has already paid. Activation runs from several
// places for one payment (the Stripe webhook, the client's verify call, a store
// notification, a restore), so it has to land on exactly one card whichever
// arrives first, and the buyer must never see who redeemed a code.

const h = vi.hoisted(() => ({
  db: null as GiftDb | null,
  codes: [] as string[],
  resolved: 'free' as UserPlan,
  stripe: 'free' as UserPlan,
  iap: 'free' as UserPlan,
  paidLookups: 0,
  resolveError: null as Error | null,
  claimError: null as Error | null,
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => h.db!.client,
}));

vi.mock('@/libs/payment/gift/code', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/payment/gift/code')>();
  return { ...actual, generateGiftCode: () => h.codes.shift() ?? actual.generateGiftCode() };
});

// Plan resolution has its own tests; here it only has to report a plan. The
// gift reads stay real and run against the in-memory table.
vi.mock('@/libs/payment/entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/payment/entitlements')>();
  return {
    ...actual,
    resolveUserPlan: async () => {
      if (h.resolveError) throw h.resolveError;
      return h.resolved;
    },
    getHighestActiveStripePlan: async () => {
      h.paidLookups++;
      return h.stripe;
    },
    getHighestActiveIapPlan: async () => {
      h.paidLookups++;
      return h.iap;
    },
  };
});

// The email claim stays real unless a test makes it fail.
vi.mock('@/libs/payment/gift/claim', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/payment/gift/claim')>();
  return {
    ...actual,
    claimGiftCardsForEmail: (userId: string, email: string) =>
      h.claimError ? Promise.reject(h.claimError) : actual.claimGiftCardsForEmail(userId, email),
  };
});

import {
  activateGiftCard,
  createGiftDraft,
  listGiftCards,
  revokeGiftCardForPayment,
  toSentGiftCard,
  updateSentGiftCard,
} from '@/libs/payment/gift/server';
import { claimGiftCardByCode } from '@/libs/payment/gift/claim';

const DAY = 86_400_000;
const NOW = new Date('2026-12-01T00:00:00Z');

const draftInput = (overrides: Partial<GiftDraftInput> = {}): GiftDraftInput => ({
  tier: 'plus',
  recipientName: 'Sam',
  senderName: 'Alex',
  message: 'Happy holidays!',
  recipientEmail: null,
  ...overrides,
});

const stripePayment = (paymentRef = 'pi_1', giftCardId?: string) => ({
  buyerId: 'buyer-1',
  tier: 'pro' as const,
  provider: 'stripe' as const,
  column: 'stripe_payment_intent_id' as const,
  paymentRef,
  giftCardId,
});

const applePayment = (giftCardId?: string) => ({
  buyerId: 'buyer-1',
  tier: 'pro' as const,
  provider: 'apple' as const,
  column: 'apple_original_transaction_id' as const,
  paymentRef: 'orig-tx-1',
  giftCardId,
});

const inserts = () =>
  h.db!.writes.filter((write) => write.table === 'gift_cards' && write.op === 'insert');

const db = () => h.db!;

beforeEach(() => {
  h.db = new GiftDb([{ id: 'friend-1', email: 'sam@example.com', confirmed: true }]);
  h.codes = [];
  h.resolved = 'free';
  h.stripe = 'free';
  h.iap = 'free';
  h.paidLookups = 0;
  h.resolveError = null;
  h.claimError = null;
});

describe('createGiftDraft', () => {
  it('inserts a pending card with a fresh code', async () => {
    const { id } = await createGiftDraft('buyer-1', draftInput());

    expect(db().card(id)).toMatchObject({
      buyer_id: 'buyer-1',
      status: 'pending',
      tier: 'plus',
      recipient_name: 'Sam',
      sender_name: 'Alex',
      message: 'Happy holidays!',
      recipient_email: null,
    });
    expect(db().card(id)?.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
  });

  it('retries once with a new code when the code is taken', async () => {
    db().addCard({ code: 'TAKEN000TAKEN000', status: 'active' });
    h.codes = ['TAKEN000TAKEN000'];

    const { id } = await createGiftDraft('buyer-1', draftInput());

    expect(db().card(id)?.code).not.toBe('TAKEN000TAKEN000');
    expect(db().cards).toHaveLength(2);
  });
});

describe('activateGiftCard', () => {
  it("activates the buyer's draft on payment", async () => {
    const { id } = await createGiftDraft('buyer-1', draftInput({ tier: 'plus' }));

    const card = await activateGiftCard(stripePayment('pi_1', id));

    expect(card).toMatchObject({
      id,
      status: 'active',
      provider: 'stripe',
      stripe_payment_intent_id: 'pi_1',
      // The tier the buyer paid for, not the one the draft was written for.
      tier: 'pro',
      message: 'Happy holidays!',
      redeemed_by: null,
    });
    expect(card.purchased_at).not.toBeNull();
    expect(db().cards).toHaveLength(1);
  });

  it('activation is idempotent on the payment reference', async () => {
    const { id } = await createGiftDraft('buyer-1', draftInput());
    const first = await activateGiftCard(stripePayment('pi_1', id));
    const writesBefore = inserts().length;

    const replay = await activateGiftCard(stripePayment('pi_1', id));
    const replayWithoutDraft = await activateGiftCard(stripePayment('pi_1'));

    expect(replay.id).toBe(first.id);
    expect(replayWithoutDraft.id).toBe(first.id);
    expect(inserts()).toHaveLength(writesBefore);
    expect(db().cards).toHaveLength(1);
  });

  it('makes one card when the webhook and the verify call race', async () => {
    const { id } = await createGiftDraft('buyer-1', draftInput());

    const [a, b, c] = await Promise.all([
      activateGiftCard(applePayment(id)),
      activateGiftCard(applePayment()),
      activateGiftCard(applePayment(id)),
    ]);

    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(db().cards).toHaveLength(1);
    expect(db().cards[0]).toMatchObject({
      status: 'active',
      apple_original_transaction_id: 'orig-tx-1',
      message: 'Happy holidays!',
    });
  });

  it('two payments naming one draft make two cards', async () => {
    const { id } = await createGiftDraft('buyer-1', draftInput());

    const [a, b] = await Promise.all([
      activateGiftCard(stripePayment('pi_1', id)),
      activateGiftCard(stripePayment('pi_2', id)),
    ]);

    expect(a.id).not.toBe(b.id);
    expect(
      db()
        .cards.map((card) => card.stripe_payment_intent_id)
        .sort(),
    ).toEqual(['pi_1', 'pi_2']);
    expect(db().cards.every((card) => card.status === 'active')).toBe(true);
  });

  it('merges a draft into a card the notification already made', async () => {
    const { id: draftId } = await createGiftDraft(
      'buyer-1',
      draftInput({ message: 'Enjoy the year', recipientEmail: 'new@example.com' }),
    );
    // Apple's ONE_TIME_CHARGE notification arrives before the app's verify.
    const made = await activateGiftCard(applePayment());
    expect(made.message).toBe('');

    const card = await activateGiftCard(applePayment(draftId));

    expect(card).toMatchObject({
      id: made.id,
      status: 'active',
      recipient_name: 'Sam',
      sender_name: 'Alex',
      message: 'Enjoy the year',
      recipient_email: 'new@example.com',
    });
    expect(db().card(draftId)).toBeUndefined();
    expect(db().cards.map((c) => c.id)).toEqual([made.id]);
  });

  it('a merge keeps an email the card already has', async () => {
    const { id: draftId } = await createGiftDraft(
      'buyer-1',
      draftInput({ recipientEmail: 'draft@example.com' }),
    );
    const made = await activateGiftCard(applePayment());
    await updateSentGiftCard('buyer-1', made.id, { recipientEmail: 'set@example.com' });

    const card = await activateGiftCard(applePayment(draftId));

    expect(card).toMatchObject({ id: made.id, recipient_email: 'set@example.com' });
    expect(card.message).toBe('Happy holidays!');
    expect(db().card(draftId)).toBeUndefined();
  });

  it('a merge leaves a claimed card as it is', async () => {
    const { id: draftId } = await createGiftDraft(
      'buyer-1',
      draftInput({ recipientEmail: 'late@example.com' }),
    );
    const made = await activateGiftCard(applePayment());
    await claimGiftCardByCode(made.code, 'friend-2');
    // Still claimed once the recipient's account is gone.
    db().deleteUser('friend-2');

    const card = await activateGiftCard(applePayment(draftId));

    expect(card).toMatchObject({
      id: made.id,
      redeemed_by: null,
      message: '',
      recipient_email: null,
    });
    expect(card.redeemed_at).not.toBeNull();
    expect(db().card(draftId)).toBeUndefined();
  });

  it("does not take another buyer's draft", async () => {
    const { id: otherDraft } = await createGiftDraft('buyer-2', draftInput());

    const card = await activateGiftCard(stripePayment('pi_1', otherDraft));

    expect(card.id).not.toBe(otherDraft);
    expect(card).toMatchObject({ buyer_id: 'buyer-1', status: 'active', message: '' });
    expect(db().card(otherDraft)).toMatchObject({
      buyer_id: 'buyer-2',
      status: 'pending',
      stripe_payment_intent_id: null,
      message: 'Happy holidays!',
    });
  });

  it("never hands back another buyer's card", async () => {
    const made = await activateGiftCard(applePayment());
    const { id: draftId } = await createGiftDraft(
      'buyer-2',
      draftInput({ recipientEmail: 'thief@example.com' }),
    );

    await expect(activateGiftCard({ ...applePayment(), buyerId: 'buyer-2' })).rejects.toThrow(
      'gift card belongs to another buyer',
    );
    await expect(
      activateGiftCard({ ...applePayment(draftId), buyerId: 'buyer-2' }),
    ).rejects.toThrow('gift card belongs to another buyer');
    expect(db().card(made.id)).toMatchObject({ buyer_id: 'buyer-1', recipient_email: null });
    expect(db().card(draftId)?.status).toBe('pending');
  });

  it('a payment replay after the refund keeps the card refunded', async () => {
    const { id } = await createGiftDraft('buyer-1', draftInput());
    await activateGiftCard(stripePayment('pi_1', id));
    await revokeGiftCardForPayment('stripe_payment_intent_id', 'pi_1');

    const replay = await activateGiftCard(stripePayment('pi_1', id));

    expect(replay).toMatchObject({ id, status: 'refunded' });
    expect(db().cards).toHaveLength(1);
    expect(await claimGiftCardByCode(replay.code, 'friend-2')).toBeNull();
  });

  it('a store payment with no draft makes a card with an empty message', async () => {
    const card = await activateGiftCard({
      buyerId: 'buyer-1',
      tier: 'plus',
      provider: 'google',
      column: 'google_purchase_token',
      paymentRef: 'token-1',
    });

    expect(card).toMatchObject({
      buyer_id: 'buyer-1',
      status: 'active',
      tier: 'plus',
      provider: 'google',
      google_purchase_token: 'token-1',
      message: '',
      recipient_email: null,
      redeemed_by: null,
    });
    expect(card.purchased_at).not.toBeNull();
    expect(card.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
  });

  it('claims at once when a confirmed account has the email', async () => {
    h.resolved = 'pro';
    const { id } = await createGiftDraft(
      'buyer-1',
      draftInput({ recipientEmail: 'sam@example.com' }),
    );

    const card = await activateGiftCard(stripePayment('pi_1', id));

    expect(card.redeemed_by).toBe('friend-1');
    expect(card.redeemed_at).not.toBeNull();
    expect(db().planWrites()).toEqual([{ id: 'friend-1', plan: 'pro', status: 'active' }]);
  });

  it('waits for the account when nobody has the email yet', async () => {
    const { id } = await createGiftDraft(
      'buyer-1',
      draftInput({ recipientEmail: 'nobody@example.com' }),
    );

    const card = await activateGiftCard(stripePayment('pi_1', id));

    expect(card.redeemed_by).toBeNull();
    expect(db().planWrites()).toEqual([]);
  });
});

// The buyer has paid and the card is live. Handing it to its recipient is
// best-effort: a failure there must not fail the payment call (Play refunds an
// unconsumed purchase), and the cron's email sweep and gift-boundary sync
// finish the job.
describe('activateGiftCard once the card is live', () => {
  const addressedDraft = () =>
    createGiftDraft('buyer-1', draftInput({ recipientEmail: 'sam@example.com' }));

  it('returns the card when the recipient lookup fails', async () => {
    const { id } = await addressedDraft();
    vi.spyOn(db().client, 'rpc').mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'lookup failed' },
    });

    await expect(activateGiftCard(stripePayment('pi_1', id))).resolves.toMatchObject({
      id,
      status: 'active',
      redeemed_by: null,
    });
  });

  it('returns the card when the claim fails', async () => {
    const { id } = await addressedDraft();
    h.claimError = new Error('claim failed');

    await expect(activateGiftCard(stripePayment('pi_1', id))).resolves.toMatchObject({
      id,
      status: 'active',
      redeemed_by: null,
    });
  });

  it("returns the claimed card when the recipient's plan sync fails", async () => {
    const { id } = await addressedDraft();
    h.resolveError = new Error('stripe unavailable');

    await expect(activateGiftCard(stripePayment('pi_1', id))).resolves.toMatchObject({
      id,
      status: 'active',
      redeemed_by: 'friend-1',
    });
    expect(db().planWrites()).toEqual([]);
  });

  // Review (CodeRabbit): a sync that fails here is retried by the provider,
  // which redelivers a refund that answers 500 for days; each redelivery
  // re-stamps the card and reopens the cron's window. Swallowing it left the
  // cron two hours, then nothing.
  it("a refund revokes the card, then fails the call when the recipient's plan sync fails", async () => {
    const card = await activateGiftCard(stripePayment());
    await claimGiftCardByCode(card.code, 'friend-2');
    h.resolveError = new Error('stripe unavailable');

    await expect(revokeGiftCardForPayment('stripe_payment_intent_id', 'pi_1')).rejects.toThrow(
      'stripe unavailable',
    );
    expect(db().card(card.id)?.status).toBe('refunded');
  });
});

// Owner chose "test cards": a gift bought in Apple's sandbox or by a Play
// license tester reaches production for free, so it shows in Sent but no one
// can claim it.
describe('test cards', () => {
  it('a test purchase makes a test card that no code or email can claim', async () => {
    const card = await activateGiftCard({ ...stripePayment(), test: true });
    expect(card.test).toBe(true);
    expect(card.status).toBe('active');

    expect(await claimGiftCardByCode(card.code, 'friend-1')).toBeNull();
    await updateSentGiftCard('buyer-1', card.id, { recipientEmail: 'sam@example.com' });

    expect(db().card(card.id)?.redeemed_at).toBeNull();
    expect(toSentGiftCard(db().card(card.id)!)).toMatchObject({ test: true });
  });

  it('a real purchase makes a card that claims as before', async () => {
    const card = await activateGiftCard(stripePayment());
    expect(card.test).toBe(false);
    expect(await claimGiftCardByCode(card.code, 'friend-1')).not.toBeNull();
  });
});

describe('updateSentGiftCard', () => {
  // Review (CodeRabbit): the email is saved (and locked) before the claim, so
  // a failed claim must not answer the save with an error; the cron's email
  // sweep claims it within minutes.
  it('adding an email returns the saved card when the claim fails', async () => {
    const card = await activateGiftCard(stripePayment());
    h.claimError = new Error('claim failed');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      updateSentGiftCard('buyer-1', card.id, { recipientEmail: 'sam@example.com' }),
    ).resolves.toMatchObject({ recipientEmail: 'sam@example.com' });
  });

  it('email can be set once', async () => {
    const card = await activateGiftCard(stripePayment());

    const first = await updateSentGiftCard('buyer-1', card.id, {
      recipientEmail: 'new@example.com',
    });
    const second = await updateSentGiftCard('buyer-1', card.id, {
      recipientEmail: 'other@example.com',
    });

    expect(first).toMatchObject({ status: 'waiting', recipientEmail: 'new@example.com' });
    expect(second).toBe('email_locked');
    expect(db().card(card.id)?.recipient_email).toBe('new@example.com');
    // The message stays editable while the card waits for its recipient.
    expect(await updateSentGiftCard('buyer-1', card.id, { message: 'See you soon' })).toMatchObject(
      { status: 'waiting', message: 'See you soon' },
    );
  });

  it("re-sending the card's own email doesn't lock the edit", async () => {
    const card = await activateGiftCard(stripePayment());
    await updateSentGiftCard('buyer-1', card.id, { recipientEmail: 'new@example.com' });

    const same = await updateSentGiftCard('buyer-1', card.id, {
      recipientEmail: 'new@example.com',
      message: 'Edited',
    });
    const different = await updateSentGiftCard('buyer-1', card.id, {
      recipientEmail: 'other@example.com',
      message: 'Lost',
    });

    expect(same).toMatchObject({
      status: 'waiting',
      recipientEmail: 'new@example.com',
      message: 'Edited',
    });
    expect(different).toBe('email_locked');
    expect(db().card(card.id)).toMatchObject({
      recipient_email: 'new@example.com',
      message: 'Edited',
    });
  });

  it('adding an email claims at once for a confirmed account', async () => {
    h.resolved = 'pro';
    const card = await activateGiftCard(stripePayment());

    const sent = await updateSentGiftCard('buyer-1', card.id, {
      recipientEmail: 'sam@example.com',
    });

    expect(sent).toMatchObject({ status: 'redeemed', code: null });
    expect(db().card(card.id)?.redeemed_by).toBe('friend-1');
    expect(db().planWrites()).toEqual([{ id: 'friend-1', plan: 'pro', status: 'active' }]);
  });

  it("a claimed card can't be edited", async () => {
    const card = await activateGiftCard(stripePayment());
    await claimGiftCardByCode(card.code, 'friend-2');

    expect(await updateSentGiftCard('buyer-1', card.id, { message: 'Too late' })).toBe('not_found');
    expect(db().card(card.id)?.message).toBe('');
  });

  it("another buyer can't edit the card", async () => {
    const card = await activateGiftCard(stripePayment());

    expect(await updateSentGiftCard('buyer-2', card.id, { message: 'Mine now' })).toBe('not_found');
    expect(
      await updateSentGiftCard('buyer-2', card.id, { recipientEmail: 'thief@example.com' }),
    ).toBe('email_locked');
    expect(db().card(card.id)).toMatchObject({ message: '', recipient_email: null });
  });
});

describe('listGiftCards', () => {
  const sentCards = () => {
    const draft = db().addCard({
      buyer_id: 'buyer-1',
      status: 'pending',
      code: 'DRAFT000DRAFT000',
    });
    const open = db().addCard({
      buyer_id: 'buyer-1',
      status: 'active',
      code: 'AAAABBBBCCCCDDDD',
      purchased_at: '2026-11-04T00:00:00Z',
    });
    const waiting = db().addCard({
      buyer_id: 'buyer-1',
      status: 'active',
      code: 'EEEEFFFFGGGGHHHH',
      recipient_email: 'later@example.com',
      purchased_at: '2026-11-03T00:00:00Z',
    });
    const redeemed = db().addCard({
      buyer_id: 'buyer-1',
      status: 'active',
      code: 'JJJJKKKKMMMMNNNN',
      redeemed_by: 'friend-1',
      redeemed_at: '2026-11-10T00:00:00Z',
      purchased_at: '2026-11-02T00:00:00Z',
    });
    const refunded = db().addCard({
      buyer_id: 'buyer-1',
      status: 'refunded',
      code: 'PPPPQQQQRRRRSSSS',
      purchased_at: '2026-11-01T00:00:00Z',
    });
    return { draft, open, waiting, redeemed, refunded };
  };

  it('listGiftCards hides drafts and shows the code only until claimed', async () => {
    const { draft, open, waiting, redeemed, refunded } = sentCards();

    const { sent } = await listGiftCards('buyer-1', NOW);

    expect(sent.map((card) => card.id)).toEqual([open.id, waiting.id, redeemed.id, refunded.id]);
    expect(sent.map((card) => card.id)).not.toContain(draft.id);
    expect(sent.map(({ status, code }) => ({ status, code }))).toEqual([
      { status: 'unredeemed', code: 'AAAA-BBBB-CCCC-DDDD' },
      { status: 'waiting', code: 'EEEE-FFFF-GGGG-HHHH' },
      { status: 'redeemed', code: null },
      { status: 'refunded', code: 'PPPP-QQQQ-RRRR-SSSS' },
    ]);
    expect(sent[1]?.recipientEmail).toBe('later@example.com');
    expect(sent[2]?.redeemedAt).toBe('2026-11-10T00:00:00Z');
  });

  it('buyer never sees the redeemer', async () => {
    const { redeemed } = sentCards();

    const response = await listGiftCards('buyer-1', NOW);
    const card = response.sent.find((c) => c.id === redeemed.id)!;

    expect(Object.keys(card).sort()).toEqual(
      [
        'code',
        'id',
        'message',
        'purchasedAt',
        'recipientEmail',
        'recipientName',
        'redeemedAt',
        'senderName',
        'status',
        'test',
        'tier',
      ].sort(),
    );
    expect(JSON.stringify(response)).not.toContain('friend-1');
    expect(toSentGiftCard(db().card(redeemed.id)!)).toEqual(card);
  });

  it('lists received cards with their timeline dates', async () => {
    const redeemedAt = new Date(NOW.getTime() - 10 * DAY).toISOString();
    const card = db().addCard({
      buyer_id: 'buyer-1',
      status: 'active',
      tier: 'pro',
      recipient_name: 'Sam',
      message: 'For you',
      redeemed_by: 'friend-1',
      redeemed_at: redeemedAt,
    });
    db().addCard({
      status: 'refunded',
      tier: 'pro',
      redeemed_by: 'friend-1',
      redeemed_at: redeemedAt,
    });

    const response = await listGiftCards('friend-1', NOW);

    expect(response.received).toEqual([
      {
        id: card.id,
        tier: 'pro',
        recipientName: 'Sam',
        senderName: '',
        message: 'For you',
        startsAt: redeemedAt,
        endsAt: new Date(NOW.getTime() + 355 * DAY).toISOString(),
      },
    ]);
    expect(response.giftPlan).toBe('pro');
    expect(response.giftActiveUntil).toBe(new Date(NOW.getTime() + 355 * DAY).toISOString());
    expect(response.sent).toEqual([]);
  });

  it('giftOnly is true only without a paid plan', async () => {
    db().addCard({
      status: 'active',
      tier: 'plus',
      redeemed_by: 'friend-1',
      redeemed_at: new Date(NOW.getTime() - DAY).toISOString(),
    });

    expect(await listGiftCards('friend-1', NOW)).toMatchObject({
      giftPlan: 'plus',
      giftOnly: true,
    });

    h.iap = 'plus';
    expect(await listGiftCards('friend-1', NOW)).toMatchObject({
      giftPlan: 'plus',
      giftOnly: false,
    });

    h.iap = 'free';
    h.stripe = 'pro';
    expect(await listGiftCards('friend-1', NOW)).toMatchObject({ giftOnly: false });

    h.paidLookups = 0;
    expect(await listGiftCards('nobody', NOW)).toMatchObject({
      giftPlan: 'free',
      giftActiveUntil: null,
      giftOnly: false,
    });
    expect(h.paidLookups).toBe(0);
  });
});
