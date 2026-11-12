// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { VocabularyRow } from '@/services/vocabulary/wire';

// /api/sync/vocabulary (#789): keyset-paged pull on the server-stamped
// (updated_at, id), and a push that merges with the stored row instead of
// overwriting it.

type Call = { method: string; args: unknown[] };
const queries: Call[][] = [];
const responses: Array<{ data: unknown; error: { message: string } | null }> = [];

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
  for (const m of ['select', 'eq', 'or', 'gt', 'in', 'order', 'limit', 'upsert']) {
    builder[m] = rec(m);
  }
  // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder is intentionally thenable
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(responses.shift() ?? { data: [], error: null });
  return builder;
};

const fromMock = vi.fn((_table: string) => makeBuilder());
let authed = true;

vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: () => ({ from: fromMock }),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () =>
    authed ? { user: { id: 'u1' }, token: 'tok' } : { user: null, token: null },
}));

import { GET, POST } from '@/pages/api/sync/vocabulary';

const URL_BASE = 'https://web.readest.com/api/sync/vocabulary';
const get = (qs: string) =>
  GET(
    new Request(`${URL_BASE}?${qs}`, {
      headers: { authorization: 'Bearer tok' },
    }) as unknown as NextRequest,
  );
const post = (body: unknown) =>
  POST(
    new Request(URL_BASE, {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );

const row = (patch: Partial<VocabularyRow> = {}): VocabularyRow => ({
  id: 'en:run',
  lang: 'en',
  word_key: 'run',
  word: 'run',
  state: 'none',
  hint: null,
  occurrences: [],
  created_at: 1,
  modified_at: 1,
  deleted_at: null,
  ...patch,
});

beforeEach(() => {
  authed = true;
  queries.length = 0;
  responses.length = 0;
  fromMock.mockClear();
});

describe('GET /api/sync/vocabulary', () => {
  it('pages by (updated_at, id) after the cursor, quoting the values', async () => {
    responses.push({ data: [row({ updated_at: '2026-11-03T00:00:01.000Z' })], error: null });
    const res = await get(
      `since_ts=${encodeURIComponent('2026-11-03T00:00:00.000+00:00')}&since_id=${encodeURIComponent('en:a,b')}&limit=500`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: VocabularyRow[] };
    expect(body.rows).toHaveLength(1);
    const chain = queries[0]!;
    expect(fromMock).toHaveBeenCalledWith('vocabulary');
    expect(chain).toContainEqual({ method: 'eq', args: ['user_id', 'u1'] });
    expect(chain).toContainEqual({
      method: 'or',
      args: [
        'updated_at.gt."2026-11-03T00:00:00.000+00:00",and(updated_at.eq."2026-11-03T00:00:00.000+00:00",id.gt."en:a,b")',
      ],
    });
    expect(chain.filter((c) => c.method === 'order').map((c) => c.args[0])).toEqual([
      'updated_at',
      'id',
    ]);
    expect(chain).toContainEqual({ method: 'limit', args: [500] });
  });

  it('pulls from the start without a cursor and caps the page size', async () => {
    await get('limit=99999');
    const chain = queries[0]!;
    expect(chain.some((c) => c.method === 'or')).toBe(false);
    expect(chain).toContainEqual({ method: 'limit', args: [1000] });
  });

  it('rejects a since_ts that is not a timestamp before querying', async () => {
    const res = await get('since_ts=nope');
    expect(res.status).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it('keeps database error details out of the response', async () => {
    responses.push({ data: null, error: { message: 'column "secret" does not exist' } });
    const res = await get('');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });

  it('rejects an unauthenticated request', async () => {
    authed = false;
    expect((await get('')).status).toBe(401);
  });
});

describe('POST /api/sync/vocabulary', () => {
  it('merges sentences with the stored row and stamps updated_at', async () => {
    const stored = row({ occurrences: [{ sentence: 'Old.', at: 5 }], modified_at: 1 });
    const incoming = row({
      state: 'learning',
      modified_at: 9,
      occurrences: [{ sentence: 'New.', at: 8 }],
    });
    responses.push({ data: [stored], error: null }); // existing rows
    responses.push({ data: [{ ...incoming, updated_at: 'x' }], error: null }); // upsert
    const res = await post({ rows: [{ ...incoming, user_id: 'someone-else' }] });
    expect(res.status).toBe(200);

    const upsert = queries[1]!.find((c) => c.method === 'upsert')!;
    const [written] = upsert.args[0] as (VocabularyRow & { user_id: string })[];
    expect(written!.user_id).toBe('u1');
    expect(written!.state).toBe('learning');
    expect(written!.occurrences.map((o) => o.sentence)).toEqual(['New.', 'Old.']);
    expect(Number.isNaN(Date.parse(written!.updated_at!))).toBe(false);
    expect(upsert.args[1]).toEqual({ onConflict: 'user_id,id' });
    expect(queries[0]!).toContainEqual({ method: 'in', args: ['id', ['en:run']] });
  });

  it('skips malformed rows, reports them, and still writes the rest', async () => {
    const occurrences = Array.from({ length: 21 }, (_, i) => ({ sentence: `S${i}.`, at: i }));
    responses.push({ data: [], error: null }); // existing rows
    responses.push({ data: [{ ...row(), updated_at: 'x' }], error: null }); // upsert
    const res = await post({
      rows: [
        row({ id: 'en:big', word_key: 'big', occurrences }),
        row({ id: 'en:walk' }),
        row({ id: 'en:a"b', word_key: 'a"b' }),
        row(),
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rejected: string[] };
    expect(body.rejected).toEqual(['en:big', 'en:walk', 'en:a"b']);
    const upsert = queries[1]!.find((c) => c.method === 'upsert')!;
    expect((upsert.args[0] as VocabularyRow[]).map((r) => r.id)).toEqual(['en:run']);
  });

  it('keeps database error details out of a failed push', async () => {
    responses.push({ data: null, error: { message: 'relation "secret" does not exist' } });
    const res = await post({ rows: [row()] });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });

  it('rejects more than 100 rows', async () => {
    const rows = Array.from({ length: 101 }, (_, i) =>
      row({ id: `en:w${i}`, word_key: `w${i}`, word: `w${i}` }),
    );
    expect((await post({ rows })).status).toBe(413);
  });
});
