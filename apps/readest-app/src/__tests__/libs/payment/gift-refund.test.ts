// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GiftDb } from '../../helpers/gift-db';

// A refunded gift is taken back through the same path that already revokes a
// refunded storage add-on. If the card was redeemed, the recipient's plan is
// recomputed from every source, so the refund drops them to whatever else
// they have. Plan resolution runs for real against the in-memory tables.

const h = vi.hoisted(() => ({
  db: null as GiftDb | null,
  updateUserStorage: vi.fn(),
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => h.db!.client,
}));

vi.mock('@/libs/payment/storage', () => ({
  updateUserStorage: (...args: unknown[]) => h.updateUserStorage(...args),
}));

import { markPaymentRefunded } from '@/libs/payment/iap/payments';

const db = () => h.db!;

const giftCard = (redeemedBy: string | null) =>
  db().addCard({
    buyer_id: 'buyer-1',
    status: 'active',
    tier: 'pro',
    provider: 'stripe',
    stripe_payment_intent_id: 'pi_gift',
    purchased_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    redeemed_by: redeemedBy,
    redeemed_at: redeemedBy ? new Date(Date.now() - 86_400_000).toISOString() : null,
  });

beforeEach(() => {
  h.db = new GiftDb();
  h.updateUserStorage.mockReset();
});

describe('markPaymentRefunded — gift cards', () => {
  it("markPaymentRefunded on a gift's stripe_payment_intent_id marks the card refunded and re-syncs the recipient's plan", async () => {
    const card = giftCard('friend-1');
    // Review (CodeRabbit): check the stored row, not the recorded write, which
    // the helper records even when it matches nothing.
    db().rows('payments').push({
      user_id: 'buyer-1',
      stripe_payment_intent_id: 'pi_gift',
      status: 'succeeded',
    });

    await markPaymentRefunded('buyer-1', 'stripe_payment_intent_id', 'pi_gift');

    expect(db().rows('payments')[0]?.['status']).toBe('refunded');
    expect(db().card(card.id)?.status).toBe('refunded');
    expect(db().planWrites()).toEqual([{ id: 'friend-1', plan: 'free' }]);
    expect(h.updateUserStorage).toHaveBeenCalledWith('buyer-1');
  });

  it('a refund of an unclaimed card syncs nobody', async () => {
    const card = giftCard(null);

    await markPaymentRefunded('buyer-1', 'stripe_payment_intent_id', 'pi_gift');

    expect(db().card(card.id)?.status).toBe('refunded');
    expect(db().planWrites()).toEqual([]);
  });

  it('a refund of a payment with no gift touches no card', async () => {
    const card = giftCard('friend-1');

    await markPaymentRefunded('buyer-1', 'stripe_payment_intent_id', 'pi_storage');

    expect(db().card(card.id)?.status).toBe('active');
    expect(db().planWrites()).toEqual([]);
    expect(h.updateUserStorage).toHaveBeenCalledWith('buyer-1');
  });
});
