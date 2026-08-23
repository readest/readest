import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decodeSegment } from '@/libs/statsArchive';

// POST /api/stats/compact: the cron-driven job that moves page events older
// than the hot window from stat_pages into immutable R2 segments. It runs as
// service_role against the migration-020 RPCs; one run claims a batch of users,
// archives the eligible ones and reports a summary.

type RpcHandler = (args: Record<string, unknown>) => { data?: unknown; error?: unknown };
const rpcHandlers: Record<string, RpcHandler> = {};
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const rpcMock = vi.fn(async (fn: string, args: Record<string, unknown>) => {
  rpcCalls.push({ fn, args });
  const h = rpcHandlers[fn];
  if (!h) return { data: null, error: { message: `unexpected rpc ${fn}` } };
  const r = h(args);
  return { data: r.data ?? null, error: r.error ?? null };
});
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}));

let cfEnv: Record<string, unknown> = {};
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: cfEnv }),
}));

import { POST } from '@/app/api/stats/compact/route';

const bucket = { get: vi.fn(), put: vi.fn(), list: vi.fn(), delete: vi.fn() };
const ae = { writeDataPoint: vi.fn() };
const EPOCH = '1970-01-01T00:00:00+00:00';
const dbRow = (updated_at: string, page = 1) => ({
  user_id: 'u1',
  book_hash: 'h1',
  page,
  start_time: 1000 + page,
  duration: 5,
  total_pages: 10,
  ext: null,
  updated_at,
  deleted_at: null,
});
const post = (token: string | null = 't') =>
  POST(
    new Request('https://web.readest.com/api/stats/compact', {
      method: 'POST',
      headers: token ? { 'x-compact-token': token } : {},
    }),
  );
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

beforeEach(() => {
  rpcCalls.length = 0;
  for (const k of Object.keys(rpcHandlers)) delete rpcHandlers[k];
  bucket.put.mockReset().mockResolvedValue(undefined);
  bucket.delete.mockReset();
  ae.writeDataPoint.mockReset();
  cfEnv = {
    STATS_ARCHIVE_R2: bucket,
    STATS_COMPACT_AE: ae,
    STATS_COMPACT_TOKEN: 't',
    STATS_COMPACT_ENABLED: 'true',
  };
  // default world: two users claimed, u1 has a big backlog, u2 nothing eligible
  rpcHandlers['stat_archive_claim_users'] = () => ({ data: ['u1', 'u2'] });
  rpcHandlers['stat_archive_candidate'] = ({ p_user }) => ({
    data: [
      p_user === 'u1'
        ? { eligible: 600, oldest: daysAgo(40), hot_total: 700, archived_to: EPOCH }
        : { eligible: 0, oldest: null, hot_total: 3, archived_to: EPOCH },
    ],
  });
  rpcHandlers['stat_archive_rows'] = ({ p_user }) =>
    p_user === 'u1'
      ? {
          data: [
            dbRow('2026-07-01T00:00:00.123456+00:00', 1),
            dbRow('2026-07-01T00:00:00.123456+00:00', 2),
            dbRow('2026-07-01T00:00:01.5+00:00', 3),
          ],
        }
      : { data: [] };
  rpcHandlers['stat_archive_commit'] = ({ p_rows }) => ({ data: p_rows });
});

describe('POST /api/stats/compact guard', () => {
  it('answers 503 when not enabled or not configured, 401 on a bad token', async () => {
    cfEnv = { ...cfEnv, STATS_COMPACT_ENABLED: 'false' };
    expect((await post()).status).toBe(503);
    cfEnv = { STATS_COMPACT_TOKEN: 't', STATS_COMPACT_ENABLED: 'true' }; // no bucket
    expect((await post()).status).toBe(503);
    cfEnv = { STATS_ARCHIVE_R2: bucket, STATS_COMPACT_TOKEN: 't', STATS_COMPACT_ENABLED: 'true' };
    expect((await post('wrong')).status).toBe(401);
    expect((await post(null)).status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/stats/compact run', () => {
  it('archives eligible users: put object, commit exact range, report summary + AE point', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      users_claimed: 2,
      users_archived: 1,
      segments: 1,
      rows: 3,
      errors: 0,
      commit_mismatches: 0,
    });
    expect(body.bytes).toBeGreaterThan(0);

    // claim + policy knobs
    expect(rpcCalls[0]).toEqual({ fn: 'stat_archive_claim_users', args: { p_n: 50 } });
    expect(rpcCalls.find((c) => c.fn === 'stat_archive_candidate')?.args).toEqual({
      p_user: 'u1',
      p_window: '7 days',
    });
    expect(rpcCalls.find((c) => c.fn === 'stat_archive_rows')?.args).toEqual({
      p_user: 'u1',
      p_from: EPOCH,
      p_window: '7 days',
      p_limit: 10000,
    });
    // u2 is not eligible: no rows fetched, no object written for it
    expect(
      rpcCalls.filter((c) => c.fn === 'stat_archive_rows' && c.args['p_user'] === 'u2'),
    ).toHaveLength(0);

    // the object: key by updated_to_ms, wire-shaped rows sorted, updated_at_ms from the DB timestamps (µs truncated)
    expect(bucket.put).toHaveBeenCalledTimes(1);
    const [key, bodyText, opts] = bucket.put.mock.calls[0]!;
    const toMs = Date.parse('2026-07-01T00:00:01.500Z');
    expect(key).toBe(`stats/v1/u1/${toMs}.json`);
    expect(opts).toEqual({ httpMetadata: { contentType: 'application/json' } });
    const seg = decodeSegment(bodyText as string);
    expect(seg.user_id).toBe('u1');
    expect(seg.updated_from_ms).toBe(0);
    expect(seg.updated_to_ms).toBe(toMs);
    expect(seg.rows.map((r) => [r.page, r.updated_at_ms])).toEqual([
      [1, Date.parse('2026-07-01T00:00:00.123Z')],
      [2, Date.parse('2026-07-01T00:00:00.123Z')],
      [3, toMs],
    ]);
    expect(seg.rows[0]).not.toHaveProperty('user_id');
    expect(seg.rows[0]).not.toHaveProperty('updated_at');

    // the commit uses the exact DB timestamp of the last row (microsecond precision kept)
    const commit = rpcCalls.find((c) => c.fn === 'stat_archive_commit')!;
    expect(commit.args).toEqual({
      p_user: 'u1',
      p_key: key,
      p_from: EPOCH,
      p_to: '2026-07-01T00:00:01.5+00:00',
      p_rows: 3,
      p_bytes: new TextEncoder().encode(bodyText as string).length,
    });
    expect(bucket.delete).not.toHaveBeenCalled();

    expect(ae.writeDataPoint).toHaveBeenCalledTimes(1);
    const point = ae.writeDataPoint.mock.calls[0]![0];
    expect(point.indexes).toEqual(['compact']);
    expect(point.blobs[0]).toBe('ok');
    expect(point.doubles.slice(0, 4)).toEqual([2, 1, 1, 3]);
  });

  it('chains segments for a big user, resuming each from the previous updated_to, bounded per run', async () => {
    cfEnv = { ...cfEnv, STATS_COMPACT_SEGMENT_ROWS: '2', STATS_COMPACT_SEGMENTS_PER_USER: '3' };
    let call = 0;
    rpcHandlers['stat_archive_rows'] = ({ p_from }) => {
      call++;
      if (call === 1) {
        expect(p_from).toBe(EPOCH);
        return {
          data: [dbRow('2026-07-01T00:00:00+00:00', 1), dbRow('2026-07-01T00:00:00+00:00', 2)],
        };
      }
      if (call === 2) {
        expect(p_from).toBe('2026-07-01T00:00:00+00:00');
        return {
          data: [dbRow('2026-07-02T00:00:00+00:00', 3), dbRow('2026-07-02T00:00:00+00:00', 4)],
        };
      }
      expect(p_from).toBe('2026-07-02T00:00:00+00:00');
      return { data: [] };
    };
    const body = await (await post()).json();
    expect(body).toMatchObject({ segments: 2, rows: 4, users_archived: 1 });
    expect(bucket.put).toHaveBeenCalledTimes(2);
    expect(rpcCalls.filter((c) => c.fn === 'stat_archive_rows')).toHaveLength(3);
  });

  it('stops a user after the configured number of segments even when more remain', async () => {
    cfEnv = { ...cfEnv, STATS_COMPACT_SEGMENT_ROWS: '1', STATS_COMPACT_SEGMENTS_PER_USER: '1' };
    rpcHandlers['stat_archive_rows'] = () => ({ data: [dbRow('2026-07-01T00:00:00+00:00', 1)] });
    const body = await (await post()).json();
    expect(body).toMatchObject({ segments: 1, rows: 1 });
    expect(rpcCalls.filter((c) => c.fn === 'stat_archive_rows')).toHaveLength(1);
  });

  it('applies the eligibility rules: min rows, max age, hot cap', async () => {
    rpcHandlers['stat_archive_claim_users'] = () => ({ data: ['a', 'b', 'c', 'd'] });
    rpcHandlers['stat_archive_candidate'] = ({ p_user }) => ({
      data: [
        {
          a: { eligible: 10, oldest: daysAgo(10), hot_total: 100, archived_to: EPOCH }, // nothing applies
          b: { eligible: 10, oldest: daysAgo(31), hot_total: 100, archived_to: EPOCH }, // max age
          c: { eligible: 10, oldest: daysAgo(10), hot_total: 25000, archived_to: EPOCH }, // hot cap
          d: { eligible: 500, oldest: daysAgo(8), hot_total: 600, archived_to: EPOCH }, // min rows
        }[p_user as string],
      ],
    });
    rpcHandlers['stat_archive_rows'] = () => ({ data: [dbRow('2026-07-01T00:00:00+00:00', 1)] });
    const body = await (await post()).json();
    expect(body).toMatchObject({ users_claimed: 4, users_archived: 3, segments: 3 });
    const archivedUsers = rpcCalls
      .filter((c) => c.fn === 'stat_archive_rows')
      .map((c) => c.args['p_user']);
    expect(archivedUsers).toEqual(['b', 'c', 'd']);
  });

  it('counts a delete-count mismatch without failing the run', async () => {
    rpcHandlers['stat_archive_commit'] = () => ({ data: 2 });
    const body = await (await post()).json();
    expect(body).toMatchObject({ ok: true, segments: 1, commit_mismatches: 1, errors: 0 });
  });

  it('treats a lost CAS (40001) as a no-op and never deletes the object', async () => {
    rpcHandlers['stat_archive_commit'] = () => ({
      error: { code: '40001', message: 'stat_archive_commit: archived_to <> p_from' },
    });
    const body = await (await post()).json();
    expect(body).toMatchObject({ ok: true, segments: 0, rows: 0, users_archived: 0, errors: 0 });
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it('counts an R2 put failure as an error for that user and continues the run', async () => {
    rpcHandlers['stat_archive_claim_users'] = () => ({ data: ['u1', 'u3'] });
    rpcHandlers['stat_archive_candidate'] = () => ({
      data: [{ eligible: 600, oldest: daysAgo(40), hot_total: 700, archived_to: EPOCH }],
    });
    rpcHandlers['stat_archive_rows'] = () => ({ data: [dbRow('2026-07-01T00:00:00+00:00', 1)] });
    bucket.put.mockRejectedValueOnce(new Error('r2 down')).mockResolvedValue(undefined);
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      users_claimed: 2,
      users_archived: 1,
      errors: 1,
    });
    expect(rpcCalls.filter((c) => c.fn === 'stat_archive_commit')).toHaveLength(1);
  });

  it('returns 500 only when claiming users itself fails', async () => {
    rpcHandlers['stat_archive_claim_users'] = () => ({ error: { message: 'db down' } });
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: 'db down' });
    expect(ae.writeDataPoint.mock.calls[0]![0].blobs[0]).toBe('error');
  });

  it('is idempotent: a second run with nothing eligible archives nothing', async () => {
    rpcHandlers['stat_archive_candidate'] = () => ({
      data: [
        { eligible: 0, oldest: null, hot_total: 5, archived_to: '2026-07-01T00:00:01.5+00:00' },
      ],
    });
    const body = await (await post()).json();
    expect(body).toMatchObject({ users_claimed: 2, users_archived: 0, segments: 0 });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('honors the env knobs for batch size and window', async () => {
    cfEnv = { ...cfEnv, STATS_COMPACT_USERS_PER_RUN: '7', STATS_COMPACT_WINDOW_DAYS: '14' };
    await post();
    expect(rpcCalls[0]).toEqual({ fn: 'stat_archive_claim_users', args: { p_n: 7 } });
    expect(rpcCalls.find((c) => c.fn === 'stat_archive_candidate')?.args['p_window']).toBe(
      '14 days',
    );
  });
});
