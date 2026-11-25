// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GiftCardRow } from '@/types/gift';

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  account: { email: 'a@b.co', email_confirmed_at: '2026-01-01' as string | null },
  update: 'ok' as 'ok' | 'not_found' | 'email_locked',
  claimByCode: null as unknown,
  testCode: false,
  claimForEmail: 0,
  claimedEmailArgs: [] as unknown[],
  listFails: false,
}));

vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () =>
    h.user ? { user: h.user, token: 't' } : { user: null, token: null },
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: h.account } }) } },
  }),
}));

vi.mock('@/libs/payment/gift/server', () => ({
  createGiftDraft: async () => ({ id: 'draft-id' }),
  updateSentGiftCard: async () => (h.update === 'ok' ? { id: 'x' } : h.update),
  listGiftCards: async () => {
    if (h.listFails) throw new Error('stripe down');
    return { received: [{ id: 'c1', startsAt: 's', endsAt: 'e' }] };
  },
}));

vi.mock('@/libs/payment/gift/claim', () => ({
  claimGiftCardByCode: async () => h.claimByCode,
  isTestGiftCode: async () => h.testCode,
  claimGiftCardsForEmail: async (...args: unknown[]) => {
    h.claimedEmailArgs = args;
    return h.claimForEmail;
  },
}));

vi.mock('@/libs/payment/gift/reconcile', () => ({
  reconcileGiftCards: async () => ({ claimed: 0, synced: 0, draftsDeleted: 0 }),
}));

import { POST as draft } from '@/app/api/gift/draft/route';
import { GET as cards, PATCH as patchCard } from '@/app/api/gift/cards/route';
import { POST as claim } from '@/app/api/gift/claim/route';
import { POST as redeem } from '@/app/api/gift/redeem/route';
import { POST as reconcile } from '@/app/api/gift/reconcile/route';

const ID = '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b';
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/gift', {
    method,
    headers: { authorization: 'Bearer t', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const DRAFT = { tier: 'plus', recipientName: 'A', senderName: 'B', message: 'hi' };

beforeEach(() => {
  h.user = { id: 'u1' };
  h.account = { email: 'a@b.co', email_confirmed_at: '2026-01-01' };
  h.update = 'ok';
  h.claimByCode = null;
  h.testCode = false;
  h.claimForEmail = 0;
  h.claimedEmailArgs = [];
  delete process.env['GIFT_RECONCILE_TOKEN'];
});
afterEach(() => {
  delete process.env['GIFT_RECONCILE_TOKEN'];
});

describe('gift routes', () => {
  it('every route returns 403 without auth', async () => {
    h.user = null;
    const responses = await Promise.all([
      draft(req('POST', DRAFT)),
      cards(req('GET')),
      patchCard(req('PATCH', { id: ID })),
      claim(req('POST')),
      redeem(req('POST', { code: 'X' })),
    ]);
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
  });

  it('draft 400 on a 301-character message', async () => {
    const res = await draft(req('POST', { ...DRAFT, message: 'x'.repeat(301) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
  });

  it('draft returns the new id', async () => {
    const res = await draft(req('POST', DRAFT));
    expect(await res.json()).toEqual({ id: 'draft-id' });
  });

  it('PATCH 409 when the email is locked', async () => {
    h.update = 'email_locked';
    const res = await patchCard(req('PATCH', { id: ID, recipientEmail: 'a@b.co' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'email_locked' });
  });

  it('PATCH 404 for an unknown card and 400 for a malformed id', async () => {
    h.update = 'not_found';
    expect((await patchCard(req('PATCH', { id: ID }))).status).toBe(404);
    expect((await patchCard(req('PATCH', { id: 'nope' }))).status).toBe(400);
  });

  it('claim returns { claimed: 0 } for an unconfirmed email', async () => {
    h.account = { email: 'a@b.co', email_confirmed_at: null };
    h.claimForEmail = 3;
    const res = await claim(req('POST'));
    expect(await res.json()).toEqual({ claimed: 0 });
    expect(h.claimedEmailArgs).toEqual([]);
  });

  it('claim counts cards for a confirmed email', async () => {
    h.claimForEmail = 2;
    expect(await (await claim(req('POST'))).json()).toEqual({ claimed: 2 });
    expect(h.claimedEmailArgs).toEqual(['u1', 'a@b.co']);
  });

  it('redeem says a test card is a test card', async () => {
    h.claimByCode = null;
    h.testCode = true;
    const res = await redeem(req('POST', { code: 'TEST' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'test_card' });
  });

  it('redeem 404 shares one body for invalid and used codes', async () => {
    h.claimByCode = null;
    const a = await redeem(req('POST', { code: 'AAAA' }));
    const b = await redeem(req('POST', { code: 'BBBB' }));
    expect(a.status).toBe(404);
    expect(await a.json()).toEqual({ error: 'invalid_or_used' });
    expect(await b.json()).toEqual({ error: 'invalid_or_used' });
  });

  it('redeem returns the card with its timeline dates', async () => {
    h.claimByCode = { id: 'c1' } as GiftCardRow;
    const res = await redeem(req('POST', { code: 'AAAA' }));
    expect(await res.json()).toEqual({ card: { id: 'c1', startsAt: 's', endsAt: 'e' } });
  });

  it('redeem answers 200 with no card when the claim committed but the listing failed', async () => {
    h.claimByCode = { id: 'c1' } as GiftCardRow;
    h.listFails = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await redeem(req('POST', { code: 'AAAA' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ card: null });
    } finally {
      h.listFails = false;
    }
  });

  it('redeem answers 200 with no card when the claimed card is missing from the listing', async () => {
    h.claimByCode = { id: 'other' } as GiftCardRow;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await redeem(req('POST', { code: 'AAAA' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ card: null });
  });

  it('reconcile 503 without a token and 401 with a wrong one', async () => {
    expect((await reconcile(req('POST', undefined, { 'x-gift-token': 'a' }))).status).toBe(503);
    process.env['GIFT_RECONCILE_TOKEN'] = 'secret';
    expect((await reconcile(req('POST', undefined, { 'x-gift-token': 'wrong' }))).status).toBe(401);
    const ok = await reconcile(req('POST', undefined, { 'x-gift-token': 'secret' }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ claimed: 0, synced: 0, draftsDeleted: 0 });
  });
});
