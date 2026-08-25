import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeSegment, SEGMENT_VERSION, type ArchivedPageRow } from '@/libs/statsArchive';

// POST /api/stats/restore: rollback tool that re-inserts one user's archived
// segments into stat_pages (through upsert_stat_pages_as, longest duration
// wins) and removes the manifest rows. Only usable while compaction is
// disabled, so it never races the compaction job.

type Call = { table: string; method: string; args: unknown[] };
const calls: Call[] = [];
// Stateful manifest: selects honor `.range(from, to)` (PostgREST caps rows at
// 1000 in production), deletes remove the row, so the route's "repeat until
// empty" loop terminates the way it does against the real database.
let manifestRows: Record<string, unknown>[] = [];
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
  for (const m of ['select', 'delete', 'eq', 'order', 'range']) builder[m] = rec(m);
  // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder is intentionally thenable
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) => {
    if (chain.some((c) => c.method === 'delete')) {
      const id = chain.find((c) => c.method === 'eq' && c.args[0] === 'id')?.args[1];
      manifestRows = manifestRows.filter((m) => m['id'] !== id);
      return resolve({ data: null, error: null });
    }
    const range = chain.find((c) => c.method === 'range')?.args as [number, number] | undefined;
    const rows = range ? manifestRows.slice(range[0], range[1] + 1) : manifestRows.slice(0, 1000);
    return resolve({ data: rows, error: null });
  };
  return builder;
};
const fromMock = vi.fn((table: string) => makeBuilder(table));
const rpcMock = vi.fn(async () => ({ data: 1, error: null }));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ from: fromMock, rpc: rpcMock }),
}));

let cfEnv: Record<string, unknown> = {};
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: cfEnv }),
}));

import { POST } from '@/app/api/stats/restore/route';

const bucket = { get: vi.fn(), put: vi.fn(), list: vi.fn(), delete: vi.fn() };
const row = (updated_at_ms: number, page: number): ArchivedPageRow => ({
  book_hash: 'h1',
  page,
  start_time: 1000 + page,
  duration: 5,
  total_pages: 10,
  ext: null,
  deleted_at: null,
  updated_at_ms,
});
const objectOf = (rows: ArchivedPageRow[]) => {
  const text = encodeSegment({
    v: SEGMENT_VERSION,
    user_id: 'u1',
    updated_from_ms: 0,
    updated_to_ms: rows.reduce((m, r) => Math.max(m, r.updated_at_ms), 0),
    rows,
  });
  return { size: text.length, text: async () => text };
};
const manifest = (id: number, to_ms: number) => ({
  id,
  user_id: 'u1',
  updated_from: new Date(0).toISOString(),
  updated_to: new Date(to_ms).toISOString(),
  row_count: 0,
  bytes: 0,
  object_key: `stats/v1/u1/${to_ms}.json`,
});
const post = (body: unknown, token: string | null = 't') =>
  POST(
    new Request('https://web.readest.com/api/stats/restore', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-compact-token': token } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  calls.length = 0;
  manifestRows = [];
  fromMock.mockClear();
  rpcMock.mockClear();
  bucket.get.mockReset();
  cfEnv = { STATS_ARCHIVE_R2: bucket, STATS_COMPACT_TOKEN: 't' }; // compaction disabled
});

describe('POST /api/stats/restore', () => {
  it('guards: 503 without token/bucket, 401 on a bad token, 409 while compaction is enabled', async () => {
    cfEnv = { STATS_COMPACT_TOKEN: 't' };
    expect((await post({ user_id: 'u1' })).status).toBe(503);
    cfEnv = { STATS_ARCHIVE_R2: bucket, STATS_COMPACT_TOKEN: 't' };
    expect((await post({ user_id: 'u1' }, 'nope')).status).toBe(401);
    cfEnv = { STATS_ARCHIVE_R2: bucket, STATS_COMPACT_TOKEN: 't', STATS_COMPACT_ENABLED: 'true' };
    const res = await post({ user_id: 'u1' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'disable compaction first' });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('rejects a missing or malformed user_id with 400', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ user_id: 'not-a-uuid' })).status).toBe(400);
  });

  it('re-inserts every segment in updated_to order, in 500-row chunks, then drops its manifest row', async () => {
    const uid = '00000000-0000-0000-0000-000000000001';
    manifestRows = [manifest(1, 300), manifest(2, 600)].map((m) => ({ ...m, user_id: uid }));
    const big = Array.from({ length: 1200 }, (_, i) => row(400 + i, i));
    bucket.get
      .mockResolvedValueOnce(objectOf([row(100, 1), row(300, 2)]))
      .mockResolvedValueOnce(objectOf(big));

    const res = await post({ user_id: uid });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restored_segments: 2, rows: 1202 });

    const upserts = rpcMock.mock.calls as unknown as [
      string,
      { p_user: string; p_rows: unknown[] },
    ][];
    expect(upserts.map((c) => c[0])).toEqual(Array(4).fill('upsert_stat_pages_as'));
    expect(upserts.map((c) => c[1].p_rows.length)).toEqual([2, 500, 500, 200]);
    expect(upserts.every((c) => c[1].p_user === uid)).toBe(true);
    expect(upserts[0]![1].p_rows[0]).toMatchObject({ book_hash: 'h1', page: 1, duration: 5 });

    const deletes = calls.filter((c) => c.table === 'stat_archives' && c.method === 'delete');
    expect(deletes).toHaveLength(2);
    const idEqs = calls
      .filter((c) => c.method === 'eq' && c.args[0] === 'id')
      .map((c) => c.args[1]);
    expect(idEqs).toEqual([1, 2]);
    // manifest read in updated_to order
    expect(calls.find((c) => c.method === 'order')?.args).toEqual([
      'updated_to',
      { ascending: true },
    ]);
  });

  it('stops at the first unreadable object, keeping its manifest row, and reports where it stopped', async () => {
    const uid = '00000000-0000-0000-0000-000000000001';
    manifestRows = [manifest(1, 300), manifest(2, 600)].map((m) => ({ ...m, user_id: uid }));
    bucket.get.mockResolvedValueOnce(objectOf([row(100, 1)])).mockResolvedValueOnce(null);

    const res = await post({ user_id: uid });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ restored_segments: 1, failed_manifest_id: 2 });
    expect(calls.filter((c) => c.table === 'stat_archives' && c.method === 'delete')).toHaveLength(
      1,
    );
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('restores more manifest rows than one PostgREST page by reading until the manifest is empty', async () => {
    const uid = '00000000-0000-0000-0000-000000000001';
    manifestRows = Array.from({ length: 1001 }, (_, i) => ({
      ...manifest(i + 1, 100 + i),
      user_id: uid,
    }));
    bucket.get.mockImplementation(async () => objectOf([row(1, 1)]));

    const res = await post({ user_id: uid });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restored_segments: 1001, rows: 1001 });
    expect(manifestRows).toHaveLength(0);
    expect(
      calls.filter((c) => c.table === 'stat_archives' && c.method === 'select').length,
    ).toBeGreaterThanOrEqual(2);
  });
});
