import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import {
  SEGMENT_VERSION,
  encodeSegment,
  getStatsArchiveEnv,
  guardArchiveRequest,
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
 * Guard order: 503 when disabled/unconfigured (self-host, kill switch) before
 * any auth check; 401 on a bad token. See statsArchive.ts.
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
}

const DAY_MS = 86400000;

export async function POST(request: Request) {
  const env = getStatsArchiveEnv();
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
  };

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
      ],
    });
    return NextResponse.json({ ...body, duration_ms }, { status });
  };

  const { data: claimed, error: claimErr } = await supabase.rpc('stat_archive_claim_users', {
    p_n: cfg.usersPerRun,
  });
  if (claimErr) return finish(500, 'error', { ok: false, error: claimErr.message });
  const users = (claimed ?? []) as string[];
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
      const eligible =
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

  return finish(200, 'ok', { ok: true, ...s });
}
