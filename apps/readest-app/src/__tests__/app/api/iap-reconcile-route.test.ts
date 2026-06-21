import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cron reconciliation endpoint: detects subscriptions that have drifted (still
// marked active in our DB while their store expiry has passed), which indicates
// a missed webhook. Detection-only; protected by CRON_SECRET.

const tel = vi.hoisted(() => ({ recordIapReconcile: vi.fn() }));
vi.mock('@/libs/payment/iap/telemetry', () => ({
  recordIapReconcile: tel.recordIapReconcile,
  recordIapWebhook: vi.fn(),
}));

const db = vi.hoisted(() => ({ counts: {} as Record<string, number> }));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          lt: () => Promise.resolve({ count: db.counts[table] ?? 0, error: null }),
        }),
      }),
    }),
  }),
}));

import { GET } from '@/app/api/cron/iap-reconcile/route';

const req = (auth?: string) =>
  new Request('https://web.readest.com/api/cron/iap-reconcile', {
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  tel.recordIapReconcile.mockReset();
  db.counts = {};
  process.env['CRON_SECRET'] = 'topsecret';
});

describe('GET /api/cron/iap-reconcile', () => {
  it('rejects requests without the cron secret', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('rejects a wrong secret', async () => {
    const res = await GET(req('Bearer nope'));
    expect(res.status).toBe(401);
  });

  it('returns 401 when CRON_SECRET is not configured', async () => {
    delete process.env['CRON_SECRET'];
    const res = await GET(req('Bearer topsecret'));
    expect(res.status).toBe(401);
  });

  it('reports drift counts from both stores and records a metric', async () => {
    db.counts = { apple_iap_subscriptions: 2, google_iap_subscriptions: 1 };

    const res = await GET(req('Bearer topsecret'));

    expect(res.status).toBe(200);
    const json = (await res.json()) as { appleDrift: number; googleDrift: number };
    expect(json).toMatchObject({ appleDrift: 2, googleDrift: 1 });
    expect(tel.recordIapReconcile).toHaveBeenCalledWith(
      expect.objectContaining({ appleDrift: 2, googleDrift: 1 }),
    );
  });

  it('reports zero drift when both stores are clean', async () => {
    const res = await GET(req('Bearer topsecret'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { appleDrift: number; googleDrift: number };
    expect(json).toMatchObject({ appleDrift: 0, googleDrift: 0 });
  });
});
