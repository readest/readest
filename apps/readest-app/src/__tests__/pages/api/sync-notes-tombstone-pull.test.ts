import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Issue #5818, end to end through the route: GET /api/sync?type=notes must
// hand a peer the tombstone of a note that also exists as a live row under the
// other device's book_hash. The tombstone only enters the delta through the
// `deleted_at > since` clause (its updated_at is the highlight's original
// stamp), and the id-dedupe must then rank it above the live duplicate.

type Call = { method: string; args: unknown[] };
const queries: Call[][] = [];
const responses: Array<{ data: unknown[] | null; error: { message: string } | null }> = [];

const makeBuilder = () => {
  const chain: Call[] = [];
  queries.push(chain);
  const builder: Record<string, unknown> = {};
  const rec =
    (method: string) =>
    (...args: unknown[]) => {
      chain.push({ method, args });
      return builder;
    };
  for (const m of ['select', 'eq', 'or', 'gt', 'lt', 'in', 'is', 'order', 'range']) {
    builder[m] = rec(m);
  }
  // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder is intentionally thenable
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(responses.shift() ?? { data: [], error: null });
  return builder;
};

const fromMock = vi.fn(() => makeBuilder());

vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: () => ({ from: fromMock }),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({ user: { id: 'u1' }, token: 'tok' }),
}));

import { GET } from '@/pages/api/sync';

const req = (qs: string) =>
  new Request(`https://web.readest.com/api/sync?${qs}`, {
    headers: { authorization: 'Bearer tok' },
  }) as unknown as NextRequest;

const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  queries.length = 0;
  responses.length = 0;
  fromMock.mockClear();
});

describe('GET /api/sync?type=notes with a duplicate note under two book hashes', () => {
  it('returns the tombstone instead of the live duplicate with the newer updated_at', async () => {
    // The DB orders by updated_at DESC, so the live row comes first.
    const live = { book_hash: 'r', id: 'n1', updated_at: iso(3000), deleted_at: null };
    const tombstone = { book_hash: 'k', id: 'n1', updated_at: iso(1000), deleted_at: iso(5000) };
    responses.push({ data: [live, tombstone], error: null });

    const res = await GET(req('since=2000&type=notes&book=r&meta_hash=m1'));
    const body = (await res.json()) as { notes: { book_hash: string; deleted_at: string }[] };

    expect(body.notes).toEqual([tombstone]);
    // The delta clause must admit rows by deleted_at, or the tombstone (whose
    // updated_at is older than `since`) would never be queried at all.
    const orArgs = queries[0]!.filter((c) => c.method === 'or').map((c) => String(c.args[0]));
    expect(orArgs.some((a) => a.includes('updated_at.gt.') && a.includes('deleted_at.gt.'))).toBe(
      true,
    );
  });
});
