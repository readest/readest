import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { encodeSegment, SEGMENT_VERSION, type ArchivedPageRow } from '@/libs/statsArchive';

// Deleting a book's reading statistics (#7494) marks its stat_books row with
// deleted_at. Every page event of that book read before the mark is deleted on
// every device: the pull flags those events (hot and archived alike) instead
// of dropping them, so paging and cursors are unchanged, and an ordinary push
// from a device that hasn't pulled the deletion yet can't clear the mark.

type Call = { table: string; method: string; args: unknown[] };
const calls: Call[] = [];
const tableData: Record<string, Record<string, unknown>[]> = {};
const upserts: { table: string; rows: Record<string, unknown>[] }[] = [];

const makeBuilder = (table: string) => {
  const chain: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  const rec =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ table, method, args });
      chain.push({ method, args });
      return builder;
    };
  for (const m of ['select', 'eq', 'or', 'gt', 'lt', 'in', 'is', 'not', 'order', 'range']) {
    builder[m] = rec(m);
  }
  builder['upsert'] = (rows: Record<string, unknown>[]) => {
    upserts.push({ table, rows });
    return Promise.resolve({ data: null, error: null });
  };
  // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder is intentionally thenable
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) => {
    let rows = tableData[table] ?? [];
    for (const c of chain) {
      const [col, val, val2] = c.args as [string, unknown, unknown];
      if (c.method === 'eq') rows = rows.filter((r) => !(col in r) || r[col] === val);
      if (c.method === 'gt') rows = rows.filter((r) => !(col in r) || String(r[col]) > String(val));
      if (c.method === 'not' && val === 'is' && val2 === null) rows = rows.filter((r) => r[col]);
    }
    const range = chain.find((c) => c.method === 'range')?.args as [number, number] | undefined;
    if (range) rows = rows.slice(range[0], range[1] + 1);
    // PostgREST caps every response at 1000 rows (Supabase's db-max-rows)
    return resolve({ data: rows.slice(0, 1000), error: null });
  };
  return builder;
};
const fromMock = vi.fn((table: string) => makeBuilder(table));
const rpcMock = vi.fn(async () => ({ data: 0, error: null }));

const bucket = { get: vi.fn(), put: vi.fn(), list: vi.fn(), delete: vi.fn() };
let cfEnv: Record<string, unknown> = {};

vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: () => ({ from: fromMock, rpc: rpcMock }),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({ user: { id: 'u1' }, token: 'tok' }),
}));
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: cfEnv }),
}));

import { GET, POST } from '@/pages/api/sync';

const get = (qs: string) =>
  GET(
    new Request(`https://web.readest.com/api/sync?${qs}`, {
      headers: { authorization: 'Bearer tok' },
    }) as unknown as NextRequest,
  );
const post = (body: unknown) =>
  POST(
    new Request('https://web.readest.com/api/sync', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );

const iso = (msValue: number) => new Date(msValue).toISOString();
// h1 was deleted at t = 2000 s; h2 never was.
const DELETED_MS = 2_000_000;
const statBook = (book_hash: string, deleted_at: string | null) => ({
  user_id: 'u1',
  book_hash,
  title: book_hash.toUpperCase(),
  authors: '',
  updated_at: iso(DELETED_MS),
  deleted_at,
});
const hot = (book_hash: string, start_time: number, updated_at_ms: number) => ({
  user_id: 'u1',
  book_hash,
  page: 1,
  start_time,
  duration: 5,
  total_pages: 10,
  ext: null,
  deleted_at: null,
  updated_at: iso(updated_at_ms),
});
const archived = (book_hash: string, start_time: number, updated_at_ms: number) =>
  ({
    book_hash,
    page: 2,
    start_time,
    duration: 5,
    total_pages: 10,
    ext: null,
    deleted_at: null,
    updated_at_ms,
  }) as ArchivedPageRow;

type WirePage = { book_hash: string; start_time: number; deleted_at_ms?: number };
const pull = async (qs: string) =>
  (await (await get(qs)).json()) as {
    statBooks: { book_hash: string; deleted_at_ms?: number }[];
    statPages: WirePage[];
  };
const deletedKeys = (pages: WirePage[]) =>
  pages.filter((p) => p.deleted_at_ms).map((p) => `${p.book_hash}@${p.start_time}`);

beforeEach(() => {
  calls.length = 0;
  upserts.length = 0;
  fromMock.mockClear();
  fromMock.mockImplementation((table: string) => makeBuilder(table));
  rpcMock.mockClear();
  for (const k of Object.keys(tableData)) delete tableData[k];
  bucket.get.mockReset();
  cfEnv = { STATS_ARCHIVE_R2: bucket };
});

describe('GET /api/sync?type=stats with a deleted book', () => {
  it('flags the deleted book’s events read before the deletion, and only those', async () => {
    tableData['stat_books'] = [statBook('h1', iso(DELETED_MS)), statBook('h2', null)];
    tableData['stat_pages'] = [
      hot('h1', 1999, 10),
      hot('h1', 2000, 11),
      hot('h1', 3000, 12),
      hot('h2', 1000, 13),
    ];

    const res = await pull('type=stats&since=0&limit=1000');

    expect(res.statPages.map((p) => `${p.book_hash}@${p.start_time}`)).toEqual([
      'h1@1999',
      'h1@2000',
      'h1@3000',
      'h2@1000',
    ]);
    expect(deletedKeys(res.statPages)).toEqual(['h1@1999']);
    expect(res.statPages[0]).toMatchObject({
      deleted_at: iso(DELETED_MS),
      deleted_at_ms: DELETED_MS,
    });
    expect(res.statPages[1]!.deleted_at_ms).toBeUndefined();
    expect(res.statBooks.find((b) => b.book_hash === 'h1')!.deleted_at_ms).toBe(DELETED_MS);
    expect(res.statBooks.find((b) => b.book_hash === 'h2')!.deleted_at_ms).toBeUndefined();
  });

  it('flags archived events too, even when the deletion is older than the cursor', async () => {
    // The stat_books row is not in this page (updated_at <= since), but its
    // events still are: an archived segment and a hot row pushed later.
    tableData['stat_books'] = [statBook('h1', iso(DELETED_MS))];
    tableData['stat_archives'] = [
      {
        id: 1,
        user_id: 'u1',
        updated_from: iso(0),
        updated_to: iso(DELETED_MS + 100),
        row_count: 1,
        bytes: 0,
        object_key: 'stats/v1/u1/1.json',
      },
    ];
    const text = encodeSegment({
      v: SEGMENT_VERSION,
      user_id: 'u1',
      updated_from_ms: 0,
      updated_to_ms: DELETED_MS + 100,
      rows: [archived('h1', 500, DELETED_MS + 100)],
    });
    bucket.get.mockResolvedValue({ size: text.length, text: async () => text });
    tableData['stat_pages'] = [hot('h1', 1500, DELETED_MS + 200)];

    const res = await pull(`type=stats&since=${DELETED_MS + 50}&limit=1000`);

    expect(res.statBooks).toEqual([]);
    expect(deletedKeys(res.statPages)).toEqual(['h1@500', 'h1@1500']);
  });

  it('flags events for the koplugin’s full-delta pull (no limit)', async () => {
    tableData['stat_books'] = [statBook('h1', iso(DELETED_MS))];
    tableData['stat_pages'] = [hot('h1', 1000, 10)];
    const res = await pull('type=stats&since=0');
    expect(deletedKeys(res.statPages)).toEqual(['h1@1000']);
  });

  it('finds every deletion when the account has more than 1000 deleted books', async () => {
    tableData['stat_books'] = Array.from({ length: 1001 }, (_, i) =>
      statBook(`d${String(i).padStart(4, '0')}`, iso(DELETED_MS)),
    );
    tableData['stat_pages'] = [hot('d1000', 1999, DELETED_MS + 10)];
    const res = await pull(`type=stats&since=${DELETED_MS + 5}&limit=1000`);
    expect(deletedKeys(res.statPages)).toEqual(['d1000@1999']);
  });

  it('returns a deletion committed after stat_books was read, which the cursor passes', async () => {
    // h1 is deleted between the stat_books read and the deletion lookup; a page
    // pushed after the deletion moves the client's cursor past its updated_at,
    // so this response is the only one that can carry it.
    tableData['stat_pages'] = [hot('h1', 1999, DELETED_MS + 10)];
    let reads = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === 'stat_books' && ++reads === 2) {
        tableData['stat_books'] = [statBook('h1', iso(DELETED_MS))];
      }
      return makeBuilder(table);
    });
    const res = await pull('type=stats&since=1000&limit=1000');
    expect(deletedKeys(res.statPages)).toEqual(['h1@1999']);
    expect(res.statBooks).toEqual([
      expect.objectContaining({ book_hash: 'h1', deleted_at_ms: DELETED_MS }),
    ]);
  });

  it('does not look for deletions when there are no events to return', async () => {
    tableData['stat_books'] = [statBook('h1', iso(DELETED_MS))];
    await pull('type=stats&since=0&limit=1000');
    expect(calls.some((c) => c.table === 'stat_books' && c.method === 'not')).toBe(false);
  });
});

describe('POST /api/sync stat_books push', () => {
  it('leaves deleted_at out of an ordinary push, so it can’t clear a deletion', async () => {
    const res = await post({ statBooks: [{ book_hash: 'h1', title: 'T', authors: 'A' }] });
    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.rows[0]).not.toHaveProperty('deleted_at');
  });

  it('stamps a deletion with the server’s time, not the client’s', async () => {
    const before = Date.now();
    const res = await post({
      statBooks: [
        { book_hash: 'h1', title: 'T', authors: 'A', deleted_at: '2000-01-01T00:00:00.000Z' },
        { book_hash: 'h2', title: 'U', authors: 'B' },
      ],
    });
    expect(res.status).toBe(200);
    const rows = upserts.flatMap((u) => u.rows);
    const deleted = rows.find((r) => r['book_hash'] === 'h1')!;
    expect(Date.parse(String(deleted['deleted_at']))).toBeGreaterThanOrEqual(before);
    expect(rows.find((r) => r['book_hash'] === 'h2')).not.toHaveProperty('deleted_at');
  });
});
