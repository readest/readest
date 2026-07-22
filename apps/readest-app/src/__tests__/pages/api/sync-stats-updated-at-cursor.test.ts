import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// The `type=stats` pull was the #1 query by total DB time (~43%). It filtered
// `(updated_at > since OR deleted_at > since)`, and that OR defeats the
// `(user_id, updated_at)` index: Postgres can no longer use `updated_at > since`
// as a range bound, so it walks the user's whole stat_pages history (one row per
// page-turn event) in updated_at order and filters. The OR is redundant, though:
// every stat push stamps `updated_at = now()` server-side (sync.ts), including
// deletes, so a delete always lands with updated_at greater than any peer's
// max(updated_at) pull cursor. `updated_at > since` alone therefore returns every
// change, and the query collapses to a clean forward index range scan.

type Call = { table: string; method: string; args: unknown[] };
const calls: Call[] = [];

const makeBuilder = (table: string) => {
  const builder: Record<string, unknown> = {};
  const rec =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ table, method, args });
      return builder;
    };
  for (const m of ['select', 'eq', 'or', 'gt', 'lt', 'in', 'is', 'order', 'range']) {
    builder[m] = rec(m);
  }
  // Every chain terminal is awaited and destructured as { data, error }; the
  // real PostgREST builder is itself thenable, so the mock must be too.
  // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder is intentionally thenable
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null });
  return builder;
};

const fromMock = vi.fn((table: string) => makeBuilder(table));

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

beforeEach(() => {
  calls.length = 0;
  fromMock.mockClear();
});

describe('GET /api/sync?type=stats pull cursor', () => {
  it('filters stat_pages/stat_books on updated_at only, without the redundant deleted_at OR', async () => {
    await GET(req('type=stats&since=1000&limit=100'));

    const statCalls = calls.filter((c) => c.table === 'stat_pages' || c.table === 'stat_books');
    expect(statCalls.length).toBeGreaterThan(0);

    const orDeleted = statCalls.filter(
      (c) => c.method === 'or' && String(c.args[0]).includes('deleted_at'),
    );
    expect(orDeleted).toHaveLength(0);

    const gtUpdated = statCalls.filter((c) => c.method === 'gt' && c.args[0] === 'updated_at');
    expect(gtUpdated.length).toBeGreaterThan(0);
  });

  it('also drops the deleted_at OR for the koplugin full-delta pull (no limit)', async () => {
    await GET(req('type=stats&since=1000'));

    const statPagesCalls = calls.filter((c) => c.table === 'stat_pages');
    expect(statPagesCalls.length).toBeGreaterThan(0);
    expect(
      statPagesCalls.filter((c) => c.method === 'or' && String(c.args[0]).includes('deleted_at')),
    ).toHaveLength(0);
    expect(
      statPagesCalls.filter((c) => c.method === 'gt' && c.args[0] === 'updated_at'),
    ).not.toHaveLength(0);
  });
});
