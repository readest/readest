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
// stat_archive_orphans (account-deletion cleanup queue): selects return the
// queued rows, deletes by user_id remove them.
let orphanRows: { user_id: string }[] = [];
const orphanCalls: { method: string; args: unknown[] }[] = [];
const makeOrphanBuilder = () => {
  const chain: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  const rec =
    (method: string) =>
    (...args: unknown[]) => {
      orphanCalls.push({ method, args });
      chain.push({ method, args });
      return builder;
    };
  for (const m of ['select', 'delete', 'eq', 'order', 'limit']) builder[m] = rec(m);
  // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder is intentionally thenable
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) => {
    if (chain.some((c) => c.method === 'delete')) {
      const id = chain.find((c) => c.method === 'eq' && c.args[0] === 'user_id')?.args[1];
      orphanRows = orphanRows.filter((o) => o.user_id !== id);
      return resolve({ data: null, error: null });
    }
    const lim = chain.find((c) => c.method === 'limit')?.args[0] as number | undefined;
    return resolve({ data: orphanRows.slice(0, lim ?? orphanRows.length), error: null });
  };
  return builder;
};
const fromMock = vi.fn((table: string) => {
  if (table !== 'stat_archive_orphans') throw new Error(`unexpected table ${table}`);
  return makeOrphanBuilder();
});
// auth.admin.getUserById: the orphan sweep's safety check. Default: every
// queued user is really deleted ("user not found").
type GetUserResult = { data: { user: { id: string } | null }; error: { message: string } | null };
const getUserByIdMock = vi.fn<(id: string) => Promise<GetUserResult>>(async () => ({
  data: { user: null },
  error: { message: 'not found' },
}));
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    rpc: rpcMock,
    from: fromMock,
    auth: { admin: { getUserById: getUserByIdMock } },
  }),
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
  rpcMock.mockClear();
  orphanRows = [];
  orphanCalls.length = 0;
  fromMock.mockClear();
  getUserByIdMock
    .mockReset()
    .mockResolvedValue({ data: { user: null }, error: { message: 'not found' } });
  bucket.list.mockReset().mockResolvedValue({ objects: [], truncated: false });
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
  // p_from-aware: the route assembles a segment from sub-pages and advances
  // p_from between calls, so a static mock would loop forever
  rpcHandlers['stat_archive_rows'] = ({ p_user, p_from }) =>
    p_user === 'u1' && p_from === EPOCH
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

describe('POST /api/stats/compact targeted run ({ user_id })', () => {
  const UID = '00000000-0000-0000-0000-000000000001';
  const postUser = (user_id: unknown, token: string | null = 't') =>
    POST(
      new Request('https://web.readest.com/api/stats/compact', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-compact-token': token } : {}),
        },
        body: JSON.stringify({ user_id }),
      }),
    );

  beforeEach(() => {
    // cron disabled: a targeted run still works (operator action) ...
    cfEnv = { STATS_ARCHIVE_R2: bucket, STATS_COMPACT_AE: ae, STATS_COMPACT_TOKEN: 't' };
    // ... and ignores the eligibility thresholds: this user is far below them
    rpcHandlers['stat_archive_candidate'] = () => ({
      data: [{ eligible: 3, oldest: daysAgo(8), hot_total: 10, archived_to: EPOCH }],
    });
    rpcHandlers['stat_archive_rows'] = ({ p_user, p_from }) =>
      p_user === UID && p_from === EPOCH
        ? { data: [dbRow('2026-07-01T00:00:00+00:00', 1), dbRow('2026-07-01T00:00:00+00:00', 2)] }
        : { data: [] };
  });

  it('archives exactly that user, without claiming, with the enabled flag off and thresholds ignored', async () => {
    const res = await postUser(UID);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      targeted: true,
      users_claimed: 1,
      users_archived: 1,
      segments: 1,
      rows: 2,
    });
    expect(rpcCalls.some((c) => c.fn === 'stat_archive_claim_users')).toBe(false);
    expect(rpcCalls.find((c) => c.fn === 'stat_archive_candidate')?.args['p_user']).toBe(UID);
    expect(bucket.put.mock.calls[0]![0]).toMatch(`stats/v1/${UID}/`);
  });

  it('archives nothing when the user has no rows older than the window', async () => {
    rpcHandlers['stat_archive_candidate'] = () => ({
      data: [{ eligible: 0, oldest: null, hot_total: 10, archived_to: EPOCH }],
    });
    expect(await (await postUser(UID)).json()).toMatchObject({
      users_claimed: 1,
      users_archived: 0,
    });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('still requires the token and the bucket, and a well-formed user_id', async () => {
    expect((await postUser(UID, 'wrong')).status).toBe(401);
    expect((await postUser('nope')).status).toBe(400);
    cfEnv = { STATS_COMPACT_TOKEN: 't' };
    expect((await postUser(UID)).status).toBe(503);
  });

  it('rejects any non-empty body that is not a valid targeted request instead of running a batch', async () => {
    cfEnv = { ...cfEnv, STATS_COMPACT_ENABLED: 'true' };
    const raw = (body: string) =>
      POST(
        new Request('https://web.readest.com/api/stats/compact', {
          method: 'POST',
          headers: { 'x-compact-token': 't', 'content-type': 'application/json' },
          body,
        }),
      );
    for (const body of ['{"userId":"' + UID + '"}', '{"user_id":', '[]', '"x"', '{}', '   ']) {
      // whitespace-only counts as empty (cron-shaped); everything else is malformed
      const res = await raw(body);
      if (body.trim() === '') {
        expect(res.status).toBe(200);
      } else {
        expect(res.status).toBe(400);
      }
    }
    // the malformed bodies never reached the database: only the whitespace run claimed users
    expect(rpcCalls.filter((c) => c.fn === 'stat_archive_claim_users')).toHaveLength(1);
  });
});

describe('POST /api/stats/compact orphan sweep (account-deletion cleanup)', () => {
  const A = '00000000-0000-0000-0000-00000000000a';
  const B = '00000000-0000-0000-0000-00000000000b';

  it('deletes queued users prefixes and dequeues them, even while compaction is disabled', async () => {
    cfEnv = { STATS_ARCHIVE_R2: bucket, STATS_COMPACT_AE: ae, STATS_COMPACT_TOKEN: 't' };
    orphanRows = [{ user_id: A }, { user_id: B }];
    bucket.list.mockImplementation(async ({ prefix }: { prefix: string }) => ({
      objects: prefix.includes(A) ? [{ key: `stats/v1/${A}/1.json` }] : [],
      truncated: false,
    }));
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ disabled: true, orphans_swept: 2 });
    expect(bucket.delete).toHaveBeenCalledWith([`stats/v1/${A}/1.json`]);
    expect(orphanRows).toEqual([]);
    expect(rpcMock).not.toHaveBeenCalled(); // no compaction while disabled
  });

  it('keeps a queued user whose prefix could not be deleted and counts the error', async () => {
    orphanRows = [{ user_id: A }, { user_id: B }];
    bucket.list.mockImplementation(async ({ prefix }: { prefix: string }) => {
      if (prefix.includes(A)) throw new Error('r2 down');
      return { objects: [], truncated: false };
    });
    const body = await (await post()).json();
    expect(body).toMatchObject({ ok: true, orphans_swept: 1, errors: 1 });
    expect(orphanRows).toEqual([{ user_id: A }]);
  });

  it('skips (and keeps) a queued user that still exists: never wipes a living account', async () => {
    orphanRows = [{ user_id: A }, { user_id: B }];
    getUserByIdMock.mockImplementation(async (id: string) =>
      id === A
        ? { data: { user: { id: A } }, error: null }
        : { data: { user: null }, error: { message: 'not found' } },
    );
    const body = await (await post()).json();
    expect(body).toMatchObject({ ok: true, orphans_swept: 1, errors: 0 });
    expect(orphanRows).toEqual([{ user_id: A }]); // stale tombstone kept, no delete attempted
    const listedPrefixes = bucket.list.mock.calls.map(
      (call) => (call[0] as { prefix: string }).prefix,
    );
    expect(listedPrefixes.some((p) => p.includes(A))).toBe(false);
  });

  it('does not run the sweep for a targeted request', async () => {
    orphanRows = [{ user_id: A }];
    await POST(
      new Request('https://web.readest.com/api/stats/compact', {
        method: 'POST',
        headers: { 'x-compact-token': 't', 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: '00000000-0000-0000-0000-000000000001' }),
      }),
    );
    expect(orphanRows).toEqual([{ user_id: A }]);
    expect(fromMock).not.toHaveBeenCalled();
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
    // sub-pages never ask for more than PostgREST's db-max-rows cap (1000),
    // whatever STATS_COMPACT_SEGMENT_ROWS says; the first page has no tie cursor
    expect(rpcCalls.find((c) => c.fn === 'stat_archive_rows')?.args).toEqual({
      p_user: 'u1',
      p_from: EPOCH,
      p_window: '7 days',
      p_limit: 1000,
      p_tie_book: null,
      p_tie_page: null,
      p_tie_start: null,
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

  it('assembles one segment from capped sub-pages: 1000 + 1000 + 77 rows become a single object', async () => {
    // PostgREST truncates every RPC response at db-max-rows (1000), so a 10k
    // segment must be assembled from several <=1000-row calls with p_from
    // advancing; the object and the commit still cover the whole range.
    const base = Date.UTC(2026, 6, 1);
    const all = Array.from({ length: 2077 }, (_, i) =>
      dbRow(new Date(base + i * 1000).toISOString().replace('Z', '+00:00'), (i % 90) + 1),
    );
    rpcHandlers['stat_archive_rows'] = ({ p_from, p_limit }) => ({
      // '1970-...' sorts before '2026-...', so plain string comparison works
      data: all.filter((r) => String(r.updated_at) > String(p_from)).slice(0, Number(p_limit)),
    });
    const body = await (await post()).json();
    expect(body).toMatchObject({ ok: true, users_archived: 1, segments: 1, rows: 2077 });

    const rowsCalls = rpcCalls.filter((c) => c.fn === 'stat_archive_rows');
    // three data sub-pages plus the empty call that proves the user is drained
    expect(rowsCalls.map((c) => c.args['p_limit'])).toEqual([1000, 1000, 1000, 1000]);
    expect(rowsCalls[1]!.args['p_from']).toBe(all[999]!.updated_at);
    expect(rowsCalls[2]!.args['p_from']).toBe(all[1999]!.updated_at);
    expect(rowsCalls[3]!.args['p_from']).toBe(all[2076]!.updated_at);

    expect(bucket.put).toHaveBeenCalledTimes(1);
    const [key, bodyText] = bucket.put.mock.calls[0]!;
    const toMs = base + 2076 * 1000;
    expect(key).toBe(`stats/v1/u1/${toMs}.json`);
    const seg = decodeSegment(bodyText as string);
    expect(seg.rows).toHaveLength(2077);
    expect(seg.updated_to_ms).toBe(toMs);

    const commit = rpcCalls.find((c) => c.fn === 'stat_archive_commit')!;
    expect(commit.args).toMatchObject({
      p_from: EPOCH,
      p_to: all[2076]!.updated_at,
      p_rows: 2077,
    });
  });

  it('chains segments: a mid-millisecond target cut trims, and the next segment refetches the rest', async () => {
    cfEnv = { ...cfEnv, STATS_COMPACT_SEGMENT_ROWS: '2', STATS_COMPACT_SEGMENTS_PER_USER: '3' };
    const jul1 = [dbRow('2026-07-01T00:00:00+00:00', 1), dbRow('2026-07-01T00:00:00+00:00', 2)];
    const jul2 = [dbRow('2026-07-02T00:00:00+00:00', 3), dbRow('2026-07-02T00:00:00+00:00', 4)];
    rpcHandlers['stat_archive_rows'] = ({ p_from }) =>
      p_from === EPOCH
        ? { data: jul1 }
        : p_from === '2026-07-01T00:00:00+00:00'
          ? { data: jul2 }
          : { data: [] };
    const body = await (await post()).json();
    expect(body).toMatchObject({ segments: 2, rows: 4, users_archived: 1 });
    expect(bucket.put).toHaveBeenCalledTimes(2);
    // segment 1 hits the target inside the Jul-1 millisecond, fetches on until a
    // complete millisecond exists, trims the Jul-2 rows and commits Jul-1 only;
    // segment 2 refetches the Jul-2 rows from the new boundary and keeps them
    // once the drained-and-old check closes their millisecond.
    const commits = rpcCalls.filter((c) => c.fn === 'stat_archive_commit');
    expect(commits.map((c) => [c.args['p_from'], c.args['p_to'], c.args['p_rows']])).toEqual([
      [EPOCH, '2026-07-01T00:00:00+00:00', 2],
      ['2026-07-01T00:00:00+00:00', '2026-07-02T00:00:00+00:00', 2],
    ]);
    expect(rpcCalls.filter((c) => c.fn === 'stat_archive_rows')).toHaveLength(4);
  });

  it('stops a user after the configured number of segments even when more remain', async () => {
    cfEnv = { ...cfEnv, STATS_COMPACT_SEGMENT_ROWS: '1', STATS_COMPACT_SEGMENTS_PER_USER: '1' };
    rpcHandlers['stat_archive_rows'] = ({ p_from }) =>
      p_from === EPOCH ? { data: [dbRow('2026-07-01T00:00:00+00:00', 1)] } : { data: [] };
    const body = await (await post()).json();
    expect(body).toMatchObject({ segments: 1, rows: 1 });
    // one data page plus the empty page that proves the millisecond is complete
    expect(rpcCalls.filter((c) => c.fn === 'stat_archive_rows')).toHaveLength(2);
  });

  it('paginates INSIDE one millisecond with the tie cursor: 1001 equal-timestamp rows, one segment, no loop', async () => {
    // A restore can land two 500-row chunks in one millisecond, and PostgREST
    // truncates any response at 1000 rows. The keyset cursor (updated_at,
    // book_hash, page, start_time) must walk through the millisecond instead of
    // repeating the same truncated page forever (the migration-020/021-draft bug).
    const TS = '2026-07-01T00:00:00.123456+00:00';
    const all = Array.from({ length: 1001 }, (_, i) => dbRow(TS, i + 1));
    rpcHandlers['stat_archive_rows'] = ({ p_from, p_limit, p_tie_page }) => ({
      data: all
        .filter((r) =>
          p_tie_page == null ? String(r.updated_at) > String(p_from) : r.page > Number(p_tie_page),
        )
        .slice(0, Number(p_limit)),
    });
    const body = await (await post()).json();
    expect(body).toMatchObject({ ok: true, users_archived: 1, segments: 1, rows: 1001 });

    const rowsCalls = rpcCalls.filter((c) => c.fn === 'stat_archive_rows');
    expect(rowsCalls).toHaveLength(3); // 1000 + 1 + the empty drained page
    expect(rowsCalls[1]!.args).toMatchObject({
      p_from: TS,
      p_tie_book: 'h1',
      p_tie_page: 1000,
      p_tie_start: 2000,
    });
    expect(rowsCalls[2]!.args).toMatchObject({ p_from: TS, p_tie_page: 1001 });

    expect(bucket.put).toHaveBeenCalledTimes(1);
    const seg = decodeSegment(bucket.put.mock.calls[0]![1] as string);
    expect(seg.rows).toHaveLength(1001);
    expect(rpcCalls.find((c) => c.fn === 'stat_archive_commit')?.args).toMatchObject({
      p_to: TS,
      p_rows: 1001,
    });
  });

  it('defers a user whose only eligible rows sit in a still-fresh millisecond', async () => {
    // drained, but the trailing millisecond ended too close to the window
    // cutoff to be provably complete: archive nothing, retry on a later run
    const fresh = new Date(Date.now() - 7 * 86400000 - 30000).toISOString().replace('Z', '+00:00');
    rpcHandlers['stat_archive_rows'] = ({ p_from }) =>
      p_from === EPOCH ? { data: [dbRow(fresh, 1), dbRow(fresh, 2)] } : { data: [] };
    const body = await (await post()).json();
    expect(body).toMatchObject({ users_claimed: 2, users_archived: 0, segments: 0, errors: 0 });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(rpcCalls.some((c) => c.fn === 'stat_archive_commit')).toBe(false);
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
    rpcHandlers['stat_archive_rows'] = ({ p_from }) =>
      p_from === EPOCH ? { data: [dbRow('2026-07-01T00:00:00+00:00', 1)] } : { data: [] };
    const body = await (await post()).json();
    expect(body).toMatchObject({ users_claimed: 4, users_archived: 3, segments: 3 });
    const archivedUsers = rpcCalls
      .filter((c) => c.fn === 'stat_archive_rows')
      .map((c) => c.args['p_user']);
    // each user makes a data sub-page call plus the drained-empty one
    expect([...new Set(archivedUsers)]).toEqual(['b', 'c', 'd']);
  });

  it('counts a refused commit (P0001 row-count mismatch) as mismatch + error and leaves the object', async () => {
    // migration 021: stat_archive_commit raises P0001 and rolls back when the
    // range's delete count differs from the declared segment row count, so a
    // counting bug can never lose rows silently
    rpcHandlers['stat_archive_commit'] = () => ({
      error: {
        code: 'P0001',
        message: 'stat_archive_commit: segment holds 3 rows but range would delete 4 for user u1',
      },
    });
    const body = await (await post()).json();
    expect(body).toMatchObject({
      ok: true,
      segments: 0,
      rows: 0,
      users_archived: 0,
      commit_mismatches: 1,
      errors: 1,
    });
    expect(bucket.put).toHaveBeenCalledTimes(1); // object written, never deleted
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it('treats a lost CAS (40001) as a no-op and never deletes the object', async () => {
    rpcHandlers['stat_archive_commit'] = () => ({
      error: { code: '40001', message: 'stat_archive_commit: archived_to <> p_from' },
    });
    const body = await (await post()).json();
    expect(body).toMatchObject({ ok: true, segments: 0, rows: 0, users_archived: 0, errors: 0 });
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it('fails loud, without writing an object, if a segment boundary does not advance past the previous millisecond', async () => {
    // rows whose max updated_at truncates to the same millisecond as p_from
    // would reuse the previous object key; the route must error out instead of
    // overwriting (the SQL extension makes this impossible unless it regresses)
    rpcHandlers['stat_archive_candidate'] = () => ({
      data: [
        {
          eligible: 600,
          oldest: daysAgo(40),
          hot_total: 700,
          archived_to: '2026-07-01T00:00:00.123+00:00',
        },
      ],
    });
    rpcHandlers['stat_archive_rows'] = ({ p_from }) =>
      p_from === '2026-07-01T00:00:00.123+00:00'
        ? { data: [dbRow('2026-07-01T00:00:00.123456+00:00', 1)] }
        : { data: [] };
    const body = await (await post()).json();
    expect(body).toMatchObject({ errors: 2, segments: 0, users_archived: 0 });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(rpcCalls.some((c) => c.fn === 'stat_archive_commit')).toBe(false);
  });

  it('counts an R2 put failure as an error for that user and continues the run', async () => {
    rpcHandlers['stat_archive_claim_users'] = () => ({ data: ['u1', 'u3'] });
    rpcHandlers['stat_archive_candidate'] = () => ({
      data: [{ eligible: 600, oldest: daysAgo(40), hot_total: 700, archived_to: EPOCH }],
    });
    rpcHandlers['stat_archive_rows'] = ({ p_from }) =>
      p_from === EPOCH ? { data: [dbRow('2026-07-01T00:00:00+00:00', 1)] } : { data: [] };
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
