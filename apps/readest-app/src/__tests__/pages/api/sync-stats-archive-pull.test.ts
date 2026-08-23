import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { encodeSegment, SEGMENT_VERSION, type ArchivedPageRow } from '@/libs/statsArchive';

// Page events older than the hot window live in immutable R2 segments listed
// in `stat_archives` (migration 020). The stats pull composes its response
// server-side: segments in updated_to order first, then hot rows, so the
// client-visible contract (rows with updated_at > since, ordered by updated_at,
// paged by `limit` with the trailing millisecond completed) is unchanged.

type Call = { table: string; method: string; args: unknown[] };
const calls: Call[] = [];
const tableData: Record<string, unknown[]> = {};

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
  // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder is intentionally thenable
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve({ data: tableData[table] ?? [], error: null });
  return builder;
};
const fromMock = vi.fn((table: string) => makeBuilder(table));

const bucket = { get: vi.fn(), put: vi.fn(), list: vi.fn(), delete: vi.fn() };
let cfEnv: Record<string, unknown> = {};

vi.mock('@/utils/supabase', () => ({
  createSupabaseClient: () => ({ from: fromMock }),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({ user: { id: 'u1' }, token: 'tok' }),
}));
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: cfEnv }),
}));

import { GET } from '@/pages/api/sync';

const req = (qs: string) =>
  new Request(`https://web.readest.com/api/sync?${qs}`, {
    headers: { authorization: 'Bearer tok' },
  }) as unknown as NextRequest;

const seg = (updated_at_ms: number, page = 1, book_hash = 'h1'): ArchivedPageRow => ({
  book_hash,
  page,
  start_time: updated_at_ms,
  duration: 5,
  total_pages: 10,
  ext: null,
  deleted_at: null,
  updated_at_ms,
});
const hot = (updated_at_ms: number, page = 50) => ({
  user_id: 'u1',
  book_hash: 'h1',
  page,
  start_time: updated_at_ms,
  duration: 5,
  total_pages: 10,
  ext: null,
  deleted_at: null,
  updated_at: new Date(updated_at_ms).toISOString(),
});
const manifest = (id: number, to_ms: number, from_ms = 0) => ({
  id,
  user_id: 'u1',
  updated_from: new Date(from_ms).toISOString(),
  updated_to: new Date(to_ms).toISOString(),
  row_count: 0,
  bytes: 0,
  object_key: `stats/v1/u1/${to_ms}.json`,
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
const pagesOf = async (res: Response) =>
  ((await res.json()) as { statPages: { updated_at_ms: number; page: number }[] }).statPages;

beforeEach(() => {
  calls.length = 0;
  fromMock.mockClear();
  for (const k of Object.keys(tableData)) delete tableData[k];
  bucket.get.mockReset();
  cfEnv = { STATS_ARCHIVE_R2: bucket };
});

describe('GET /api/sync?type=stats with archived segments', () => {
  it('returns hot rows only, without touching R2, when the user has no segments', async () => {
    tableData['stat_pages'] = [hot(900)];
    const res = await GET(req('type=stats&since=0&limit=1000'));
    expect(res.status).toBe(200);
    expect((await pagesOf(res)).map((r) => r.updated_at_ms)).toEqual([900]);
    expect(bucket.get).not.toHaveBeenCalled();
    // the manifest is filtered server-side to updated_to > since
    const gt = calls.find((c) => c.table === 'stat_archives' && c.method === 'gt');
    expect(gt?.args).toEqual(['updated_to', new Date(0).toISOString()]);
  });

  it('serves segment rows before hot rows, paged with the trailing millisecond completed', async () => {
    tableData['stat_archives'] = [manifest(1, 300)];
    tableData['stat_pages'] = [hot(900)];
    bucket.get.mockResolvedValue(
      objectOf([seg(100), seg(200), seg(300, 1), seg(300, 2), seg(300, 3)]),
    );

    const p1 = await pagesOf(await GET(req('type=stats&since=0&limit=2')));
    expect(p1.map((r) => r.updated_at_ms)).toEqual([100, 200]);
    expect(p1[0]).toMatchObject({
      user_id: 'u1',
      book_hash: 'h1',
      updated_at: new Date(100).toISOString(),
    });

    const p2 = await pagesOf(await GET(req('type=stats&since=200&limit=2')));
    expect(p2.map((r) => [r.updated_at_ms, r.page])).toEqual([
      [300, 1],
      [300, 2],
      [300, 3],
    ]);

    // segment exhausted -> hot rows (the manifest query still runs; the DB would
    // filter this segment out by updated_to > since, mirrored here)
    tableData['stat_archives'] = [];
    const p3 = await pagesOf(await GET(req('type=stats&since=300&limit=2')));
    expect(p3.map((r) => r.updated_at_ms)).toEqual([900]);
  });

  it('queries hot rows before the manifest (a commit in between can only duplicate, never lose)', async () => {
    tableData['stat_archives'] = [manifest(1, 300)];
    bucket.get.mockResolvedValue(objectOf([seg(100)]));
    await GET(req('type=stats&since=0&limit=1000'));
    const firstHot = calls.findIndex((c) => c.table === 'stat_pages');
    const firstManifest = calls.findIndex((c) => c.table === 'stat_archives');
    expect(firstHot).toBeGreaterThanOrEqual(0);
    expect(firstManifest).toBeGreaterThan(firstHot);
  });

  it('skips segments emptied by the book filter and falls through to hot rows', async () => {
    tableData['stat_archives'] = [manifest(1, 300), manifest(2, 600, 300)];
    tableData['stat_pages'] = [hot(900)];
    bucket.get
      .mockResolvedValueOnce(objectOf([seg(100, 1, 'h1')]))
      .mockResolvedValueOnce(objectOf([seg(500, 1, 'h2')]));
    const rows = await pagesOf(await GET(req('type=stats&since=0&limit=1000&book=h2')));
    expect(rows.map((r) => r.updated_at_ms)).toEqual([500]);
    expect(bucket.get).toHaveBeenCalledTimes(2);
  });

  it('concatenates every segment and then hot rows for the legacy unpaginated pull', async () => {
    tableData['stat_archives'] = [manifest(1, 300), manifest(2, 600, 300)];
    tableData['stat_pages'] = [hot(900)];
    bucket.get
      .mockResolvedValueOnce(objectOf([seg(100), seg(300)]))
      .mockResolvedValueOnce(objectOf([seg(400), seg(600)]));
    const rows = await pagesOf(await GET(req('type=stats&since=0')));
    expect(rows.map((r) => r.updated_at_ms)).toEqual([100, 300, 400, 600, 900]);
  });

  it('answers 500 without advancing when a segment object is missing or corrupt', async () => {
    tableData['stat_archives'] = [manifest(7, 300)];
    bucket.get.mockResolvedValueOnce(null);
    let res = await GET(req('type=stats&since=0&limit=1000'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/archive segment 7 unavailable/);

    bucket.get.mockResolvedValueOnce({ size: 3, text: async () => '{"v":9}' });
    res = await GET(req('type=stats&since=0&limit=1000'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/archive segment 7 unavailable/);

    cfEnv = {}; // manifest rows but no binding: misconfiguration, same answer
    res = await GET(req('type=stats&since=0&limit=1000'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/archive segment 7 unavailable/);
  });
});
