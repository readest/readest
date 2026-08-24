import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import {
  SEGMENT_VERSION,
  deleteUserSegments,
  encodeSegment,
  getStatsArchiveEnv,
  guardArchiveRequest,
  isCompactionEnabled,
  readCompactConfig,
  segmentKey,
  tsToMs,
  type ArchivedPageRow,
} from '@/libs/statsArchive';

/**
 * POST /api/stats/compact: move page events older than the hot window from
 * stat_pages into immutable per-user R2 segments (migration 020). Fired by the
 * Cloudflare Cron Trigger through worker.ts (and by hand with the same token).
 * Each run claims a batch of users, archives the eligible ones in bounded
 * segments and returns a summary; per-user failures are counted, not fatal.
 *
 * Guard order: 503 when unconfigured (no token / no bucket: self-host) before
 * any auth check; 401 on a bad token; then a batch run sweeps the
 * account-deletion queue and, if STATS_COMPACT_ENABLED is not "true", answers
 * 503 without compacting. A targeted run ({ user_id } body) skips the sweep and
 * the kill switch. See statsArchive.ts.
 */

interface CandidateRow {
  eligible: number;
  oldest: string | null;
  hot_total: number;
  archived_to: string;
}

interface HotRow {
  book_hash: string;
  page: number;
  start_time: number | string;
  duration: number;
  total_pages: number;
  ext: unknown;
  updated_at: string;
  deleted_at: string | null;
}

interface Summary {
  users_claimed: number;
  users_archived: number;
  segments: number;
  rows: number;
  bytes: number;
  errors: number;
  commit_mismatches: number;
  orphans_swept: number;
}

const ORPHANS_PER_RUN = 20;

/**
 * Account-deletion cleanup queue: every deleted user is queued in
 * stat_archive_orphans by /api/user/delete; each batch run deletes the
 * stats/v1/{user_id}/ prefix of a few queued users and removes the row once the
 * listing is empty. Runs even while compaction is disabled (it is cleanup, not
 * compaction) and is bounded so it never starves the run.
 */
async function sweepOrphans(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  bucket: NonNullable<ReturnType<typeof getStatsArchiveEnv>['STATS_ARCHIVE_R2']>,
): Promise<{ swept: number; errors: number }> {
  const out = { swept: 0, errors: 0 };
  const { data, error } = await supabase
    .from('stat_archive_orphans')
    .select('user_id')
    .order('created_at', { ascending: true })
    .limit(ORPHANS_PER_RUN);
  if (error) {
    console.error('stats compact: orphan queue read failed', error.message);
    out.errors++;
    return out;
  }
  for (const { user_id } of (data ?? []) as { user_id: string }[]) {
    try {
      // The queue row is written BEFORE deleteUser (a durable tombstone), so a
      // row can exist for an account whose deletion then failed. Never touch a
      // living user's archive: skip and keep the row (the deletion handler
      // unqueues it, best-effort; skipping here is the backstop).
      const { data: existing } = await supabase.auth.admin.getUserById(user_id);
      if (existing?.user) {
        console.warn('stats compact: orphaned user still exists, skipping', user_id);
        continue;
      }
      await deleteUserSegments(bucket, user_id);
      const { error: delErr } = await supabase
        .from('stat_archive_orphans')
        .delete()
        .eq('user_id', user_id);
      if (delErr) throw delErr;
      out.swept++;
    } catch (e) {
      out.errors++;
      console.error(
        'stats compact: orphan sweep failed',
        user_id,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return out;
}

const DAY_MS = 86400000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Optional `{ "user_id": uuid }` body: an operator compacting ONE user by hand
 * (validation on a known account, or draining a heavy user). Only an EMPTY body
 * is the cron's batch request; every non-empty body must be a valid targeted
 * request (null = malformed, answered 400), so a typo never starts a batch run.
 */
async function readTarget(request: Request): Promise<string | null | undefined> {
  const raw = (await request.text()).trim();
  if (raw === '') return undefined;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const userId =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { user_id?: unknown }).user_id
      : undefined;
  return typeof userId === 'string' && UUID_RE.test(userId) ? userId : null;
}

export async function POST(request: Request) {
  const env = getStatsArchiveEnv();
  const target = await readTarget(request);
  if (target === null) {
    return NextResponse.json(
      { error: 'body must be empty (batch run) or {"user_id": "<uuid>"} (targeted run)' },
      { status: 400 },
    );
  }
  const guard = guardArchiveRequest(request, env, 'compact');
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const started = Date.now();
  const cfg = readCompactConfig(env);
  const bucket = env.STATS_ARCHIVE_R2!;
  const supabase = createSupabaseAdminClient();
  const s: Summary = {
    users_claimed: 0,
    users_archived: 0,
    segments: 0,
    rows: 0,
    bytes: 0,
    errors: 0,
    commit_mismatches: 0,
    orphans_swept: 0,
  };

  // Batch runs (the cron) first do the account-deletion cleanup, kill switch
  // or not; only the compaction itself is gated by STATS_COMPACT_ENABLED.
  if (!target) {
    const sweep = await sweepOrphans(supabase, bucket);
    s.orphans_swept = sweep.swept;
    s.errors += sweep.errors;
    if (!isCompactionEnabled(env)) {
      return NextResponse.json({ disabled: true, orphans_swept: s.orphans_swept }, { status: 503 });
    }
  }

  const finish = (status: number, outcome: 'ok' | 'error', body: Record<string, unknown>) => {
    const duration_ms = Date.now() - started;
    const error = typeof body['error'] === 'string' ? (body['error'] as string) : '';
    console.log(JSON.stringify({ tag: 'stats-compact', outcome, duration_ms, ...s, error }));
    env.STATS_COMPACT_AE?.writeDataPoint({
      indexes: ['compact'],
      blobs: [outcome, error.slice(0, 256)],
      doubles: [
        s.users_claimed,
        s.users_archived,
        s.segments,
        s.rows,
        s.bytes,
        duration_ms,
        s.errors,
        s.commit_mismatches,
        s.orphans_swept,
      ],
    });
    return NextResponse.json({ ...body, duration_ms }, { status });
  };

  let users: string[];
  if (target) {
    users = [target];
  } else {
    const { data: claimed, error: claimErr } = await supabase.rpc('stat_archive_claim_users', {
      p_n: cfg.usersPerRun,
    });
    if (claimErr) return finish(500, 'error', { ok: false, error: claimErr.message });
    users = (claimed ?? []) as string[];
  }
  s.users_claimed = users.length;
  const window = `${cfg.windowDays} days`;

  for (const userId of users) {
    try {
      const { data: cand, error: candErr } = await supabase.rpc('stat_archive_candidate', {
        p_user: userId,
        p_window: window,
      });
      if (candErr) throw candErr;
      const c = (Array.isArray(cand) ? cand[0] : cand) as CandidateRow | undefined;
      if (!c || !(c.eligible > 0)) continue;
      const oldestMs = c.oldest ? tsToMs(c.oldest) : Number.POSITIVE_INFINITY;
      // A targeted run archives everything older than the window regardless of
      // the batching thresholds (they only exist to bound R2 PUTs for the cron).
      const eligible =
        target !== undefined ||
        c.eligible >= cfg.minRows ||
        oldestMs <= Date.now() - cfg.maxAgeDays * DAY_MS ||
        c.hot_total > cfg.hotCap;
      if (!eligible) continue;

      let from = c.archived_to;
      let archivedAny = false;
      for (let i = 0; i < cfg.segmentsPerUser; i++) {
        const { data: rowsData, error: rowsErr } = await supabase.rpc('stat_archive_rows', {
          p_user: userId,
          p_from: from,
          p_window: window,
          p_limit: cfg.segmentRows,
        });
        if (rowsErr) throw rowsErr;
        const rows = (rowsData ?? []) as HotRow[];
        if (rows.length === 0) break;
        // The RPC returns rows in updated_at order; the last one bounds the
        // segment. Keep its exact (microsecond) timestamp for the commit and the
        // truncated millisecond for the segment/key.
        const toIso = rows[rows.length - 1]!.updated_at;
        const toMs = tsToMs(toIso);
        // stat_archive_rows extends every segment to the end of its last
        // millisecond, so consecutive segments always end in strictly later
        // milliseconds and the ms-keyed object names cannot collide. Fail loud
        // (this user only) if that SQL invariant ever regresses, instead of
        // silently overwriting the previous object.
        if (toMs <= tsToMs(from)) {
          throw new Error(
            `segment boundary did not advance past the previous millisecond for ${userId}`,
          );
        }
        const archived: ArchivedPageRow[] = rows.map((r) => ({
          book_hash: r.book_hash,
          page: r.page,
          start_time: Number(r.start_time),
          duration: r.duration,
          total_pages: r.total_pages,
          ext: r.ext ?? null,
          deleted_at: r.deleted_at ?? null,
          updated_at_ms: tsToMs(r.updated_at),
        }));
        const body = encodeSegment({
          v: SEGMENT_VERSION,
          user_id: userId,
          updated_from_ms: tsToMs(from),
          updated_to_ms: toMs,
          rows: archived,
        });
        const key = segmentKey(userId, toMs);
        const bytes = new TextEncoder().encode(body).length;
        // Object first, manifest second. The key is deterministic for a given
        // (user, range), so a retry overwrites the same object; nothing here
        // ever deletes an object, because after a failed commit a concurrent
        // winner's manifest may already reference it.
        await bucket.put(key, body, { httpMetadata: { contentType: 'application/json' } });
        const { data: deleted, error: commitErr } = await supabase.rpc('stat_archive_commit', {
          p_user: userId,
          p_key: key,
          p_from: from,
          p_to: toIso,
          p_rows: rows.length,
          p_bytes: bytes,
        });
        if (commitErr) {
          if ((commitErr as { code?: string }).code === '40001') {
            // Lost the compare-and-set: another run owns this user right now.
            console.info('stats compact: lost CAS for user, skipping', userId);
            break;
          }
          throw commitErr;
        }
        if (Number(deleted) !== rows.length) s.commit_mismatches++;
        s.segments++;
        s.rows += rows.length;
        s.bytes += bytes;
        archivedAny = true;
        from = toIso;
        if (rows.length < cfg.segmentRows) break;
      }
      if (archivedAny) s.users_archived++;
    } catch (e) {
      s.errors++;
      console.error('stats compact: user failed', userId, e instanceof Error ? e.message : e);
    }
  }

  return finish(200, 'ok', { ok: true, ...(target ? { targeted: true } : {}), ...s });
}
