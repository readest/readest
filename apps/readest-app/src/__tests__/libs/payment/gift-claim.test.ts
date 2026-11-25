// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserPlan } from '@/types/quota';
import { GiftDb } from '../../helpers/gift-db';

// A card is claimed by its recipient's confirmed email or by its code,
// whichever comes first. Both are the same conditional update on an unclaimed,
// paid card, so the two can race without both winning, and an unpaid draft or
// a refunded card never grants a plan.

const h = vi.hoisted(() => ({
  db: null as GiftDb | null,
  resolved: 'free' as UserPlan,
  resolveError: null as Error | null,
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => h.db!.client,
}));

vi.mock('@/libs/payment/entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/payment/entitlements')>();
  return {
    ...actual,
    resolveUserPlan: async () => {
      if (h.resolveError) throw h.resolveError;
      return h.resolved;
    },
  };
});

import {
  claimGiftCardByCode,
  claimGiftCardsForEmail,
  syncUserPlan,
} from '@/libs/payment/gift/claim';
import { listGiftCards, updateSentGiftCard } from '@/libs/payment/gift/server';

const CODE = 'AB01CD23EF45GH67';

const db = () => h.db!;

beforeEach(() => {
  h.db = new GiftDb();
  h.resolved = 'free';
  h.resolveError = null;
});

describe('claimGiftCardByCode', () => {
  it('redeem by code works on a card with an email', async () => {
    h.resolved = 'plus';
    const card = db().addCard({
      status: 'active',
      tier: 'plus',
      code: CODE,
      recipient_email: 'typo@example.com',
    });

    const claimed = await claimGiftCardByCode(CODE, 'friend-2');

    expect(claimed).toMatchObject({ id: card.id, redeemed_by: 'friend-2' });
    expect(claimed?.redeemed_at).not.toBeNull();
    expect(db().planWrites()).toEqual([{ id: 'friend-2', plan: 'plus', status: 'active' }]);
  });

  // The claim is committed; a retry would find the code used. The cron syncs
  // the plan from `redeemed_at`.
  it('redeem by code returns the card when the plan sync fails', async () => {
    const card = db().addCard({ status: 'active', tier: 'plus', code: CODE });
    h.resolveError = new Error('stripe unavailable');

    await expect(claimGiftCardByCode(CODE, 'friend-2')).resolves.toMatchObject({
      id: card.id,
      redeemed_by: 'friend-2',
    });
    expect(db().planWrites()).toEqual([]);
  });

  it('the first claim wins', async () => {
    const card = db().addCard({
      status: 'active',
      code: CODE,
      recipient_email: 'sam@example.com',
    });

    expect(await claimGiftCardsForEmail('friend-1', 'sam@example.com')).toBe(1);
    expect(await claimGiftCardByCode(CODE, 'friend-2')).toBeNull();
    expect(db().card(card.id)?.redeemed_by).toBe('friend-1');
  });

  it('an email claim and a code redeemed at the same time: one wins', async () => {
    const card = db().addCard({
      status: 'active',
      code: CODE,
      recipient_email: 'sam@example.com',
    });

    const [byEmail, byCode] = await Promise.all([
      claimGiftCardsForEmail('friend-1', 'sam@example.com'),
      claimGiftCardByCode(CODE, 'friend-2'),
    ]);

    expect(byEmail + (byCode ? 1 : 0)).toBe(1);
    expect(db().card(card.id)?.redeemed_by).toBe(byEmail ? 'friend-1' : 'friend-2');
    expect(db().planWrites()).toHaveLength(1);
  });

  it('code is normalized', async () => {
    const card = db().addCard({ status: 'active', code: CODE });

    // Lowercase, dashes, and an "l" typed for the 1.
    const claimed = await claimGiftCardByCode('ab0l-cd23-ef45-gh67', 'friend-2');

    expect(claimed?.id).toBe(card.id);
  });

  it('a card stays claimed after the recipient account is deleted', async () => {
    const card = db().addCard({
      buyer_id: 'buyer-1',
      status: 'active',
      code: CODE,
      recipient_email: 'sam@example.com',
      purchased_at: '2026-11-01T00:00:00Z',
    });
    await claimGiftCardsForEmail('friend-1', 'sam@example.com');
    // redeemed_by is ON DELETE SET NULL; redeemed_at stays.
    db().deleteUser('friend-1');
    expect(db().card(card.id)).toMatchObject({ redeemed_by: null });
    expect(db().card(card.id)?.redeemed_at).not.toBeNull();

    expect(await claimGiftCardByCode(CODE, 'friend-2')).toBeNull();
    // The same address signing up again doesn't get a second year.
    expect(await claimGiftCardsForEmail('friend-3', 'sam@example.com')).toBe(0);
    expect(await updateSentGiftCard('buyer-1', card.id, { message: 'Again?' })).toBe('not_found');
    const { sent } = await listGiftCards('buyer-1');
    expect(sent).toMatchObject([{ id: card.id, status: 'redeemed', code: null }]);
    expect(db().card(card.id)?.redeemed_by).toBeNull();
  });

  it("a refunded card can't be redeemed", async () => {
    db().addCard({ status: 'refunded', code: CODE });

    expect(await claimGiftCardByCode(CODE, 'friend-2')).toBeNull();
    expect(db().planWrites()).toEqual([]);
  });

  it("an unpaid draft can't be claimed", async () => {
    db().addCard({ status: 'pending', code: CODE, recipient_email: 'sam@example.com' });

    expect(await claimGiftCardByCode(CODE, 'friend-2')).toBeNull();
    expect(await claimGiftCardsForEmail('friend-1', 'sam@example.com')).toBe(0);
    expect(db().planWrites()).toEqual([]);
  });
});

describe('claimGiftCardsForEmail', () => {
  it('claims every unclaimed card for the email and syncs once', async () => {
    h.resolved = 'pro';
    const a = db().addCard({ status: 'active', tier: 'pro', recipient_email: 'sam@example.com' });
    const b = db().addCard({ status: 'active', tier: 'plus', recipient_email: 'sam@example.com' });
    const other = db().addCard({ status: 'active', recipient_email: 'other@example.com' });

    // Compared trimmed and case-insensitively.
    expect(await claimGiftCardsForEmail('friend-1', ' Sam@Example.com ')).toBe(2);

    expect(db().card(a.id)?.redeemed_by).toBe('friend-1');
    expect(db().card(b.id)?.redeemed_by).toBe('friend-1');
    expect(db().card(other.id)?.redeemed_by).toBeNull();
    expect(db().planWrites()).toEqual([{ id: 'friend-1', plan: 'pro', status: 'active' }]);
  });

  it('syncs nobody when there is nothing to claim', async () => {
    expect(await claimGiftCardsForEmail('friend-1', 'sam@example.com')).toBe(0);
    expect(db().planWrites()).toEqual([]);
  });
});

describe('syncUserPlan', () => {
  it('syncUserPlan writes the resolved plan', async () => {
    // A paid plan with no gift: the provider owns plans.status.
    h.resolved = 'pro';
    expect(await syncUserPlan('payer-1')).toBe('pro');

    // A gift is what entitles this user, so the plan is active.
    db().addCard({
      status: 'active',
      tier: 'plus',
      redeemed_by: 'friend-1',
      redeemed_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    h.resolved = 'plus';
    expect(await syncUserPlan('friend-1')).toBe('plus');

    // A paid Pro above a Plus gift: the gift isn't what sets the plan.
    h.resolved = 'pro';
    await syncUserPlan('friend-1');

    h.resolved = 'free';
    await syncUserPlan('lapsed-1');

    expect(db().planWrites()).toEqual([
      { id: 'payer-1', plan: 'pro' },
      { id: 'friend-1', plan: 'plus', status: 'active' },
      { id: 'friend-1', plan: 'pro' },
      { id: 'lapsed-1', plan: 'free' },
    ]);
  });
});
