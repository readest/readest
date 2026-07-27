import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// A 10k-book library made GET /api/sync?type=books collapse: the whole delta
// was accumulated and serialized in one Worker response, exceeding Cloudflare's
// resource limits (error 1102) for the calibre plugin's since=0 pull and for
// devices whose pending delta had grown to the whole library. `limit` turns the
// books pull into a client-driven page: rows ordered by synced_at ASCENDING,
// completed to the trailing synced_at (batch upserts stamp one now() per
// statement, so rows share boundary timestamps) — a strict `> cursor` re-pull
// never skips rows, and a page shorter than `limit` means the delta is done.

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
  // Every chain terminal is awaited and destructured as { data, error }; the
  // real PostgREST builder is itself thenable, so the mock must be too.
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
const row = (hash: string, syncedMs: number) => ({ book_hash: hash, synced_at: iso(syncedMs) });
const hashes = (body: { books: { book_hash: string }[] }) => body.books.map((b) => b.book_hash);
const findCalls = (chain: Call[], method: string) => chain.filter((c) => c.method === method);

beforeEach(() => {
  queries.length = 0;
  responses.length = 0;
  fromMock.mockClear();
});

describe('GET /api/sync?type=books&limit=N (paged pull)', () => {
  it('returns one ascending page bounded by limit, tie-completed at the trailing synced_at', async () => {
    responses.push({ data: [row('a', 2000), row('b', 3000)], error: null });
    // Tie-completion query: every row sharing the trailing synced_at, page rows included.
    responses.push({ data: [row('b', 3000), row('c', 3000)], error: null });

    const res = await GET(req('type=books&since=1000&limit=2'));
    const body = await res.json();

    expect(queries).toHaveLength(2);
    const [page, ties] = queries;
    expect(findCalls(page!, 'gt')[0]?.args).toEqual(['synced_at', iso(1000)]);
    expect(findCalls(page!, 'order')[0]?.args).toEqual(['synced_at', { ascending: true }]);
    expect(findCalls(page!, 'range')[0]?.args).toEqual([0, 1]);
    expect(findCalls(ties!, 'eq').map((c) => c.args)).toContainEqual(['synced_at', iso(3000)]);

    expect(hashes(body)).toEqual(['a', 'b', 'c']);
  });

  it('skips tie-completion and returns a short page as-is (delta exhausted)', async () => {
    responses.push({ data: [row('a', 2000)], error: null });

    const res = await GET(req('type=books&since=1000&limit=2'));
    const body = await res.json();

    expect(queries).toHaveLength(1);
    expect(hashes(body)).toEqual(['a']);
  });

  it('keeps the initial-race dummy tombstone for an empty since=0 page', async () => {
    responses.push({ data: [], error: null });

    const res = await GET(req('type=books&since=0&limit=2'));
    const body = await res.json();

    expect(body.books).toHaveLength(1);
    expect(body.books[0].book_hash).toBe('00000000000000000000000000000000');
    expect(body.books[0].deleted_at).toBeTruthy();
  });

  it('leaves the no-limit pull on the full-delta path for old clients', async () => {
    responses.push({ data: [row('a', 2000)], error: null });

    const res = await GET(req('type=books&since=1000'));
    const body = await res.json();

    expect(queries).toHaveLength(1);
    const [q] = queries;
    expect(findCalls(q!, 'order')[0]?.args).toEqual(['synced_at', { ascending: false }]);
    expect(findCalls(q!, 'range')[0]?.args).toEqual([0, 999]);
    expect(hashes(body)).toEqual(['a']);
  });
});
