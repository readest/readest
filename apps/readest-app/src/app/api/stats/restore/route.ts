import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import {
  getStatsArchiveEnv,
  guardArchiveRequest,
  readSegment,
  SegmentUnavailableError,
  type StatArchiveManifestRow,
} from '@/libs/statsArchive';

/**
 * POST /api/stats/restore { user_id }: rollback tool. Re-inserts one user's
 * archived segments into stat_pages through upsert_stat_pages_as (union merge,
 * longest duration wins) in 500-row chunks and drops each manifest row once its
 * rows are back; the R2 objects stay. Idempotent and resumable: it stops at
 * the first unreadable object with the manifest id, and a re-run continues
 * after the rows already restored. Refuses (409) while compaction is enabled,
 * which keeps restore and compaction mutually exclusive without locking.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 500;
const MANIFEST_PAGE = 1000;

export async function POST(request: Request) {
  const env = getStatsArchiveEnv();
  const guard = guardArchiveRequest(request, env, 'restore');
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  let userId: unknown;
  try {
    userId = ((await request.json()) as { user_id?: unknown })?.user_id;
  } catch {
    userId = undefined;
  }
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'user_id (uuid) is required' }, { status: 400 });
  }

  const bucket = env.STATS_ARCHIVE_R2!;
  const supabase = createSupabaseAdminClient();

  let restoredSegments = 0;
  let rows = 0;
  const fail = (manifestId: number, error: string) => {
    console.error('stats restore: stopped at manifest', manifestId, error);
    return NextResponse.json(
      { restored_segments: restoredSegments, failed_manifest_id: manifestId, error },
      { status: 500 },
    );
  };

  // PostgREST caps a response at MANIFEST_PAGE rows (Supabase's db-max-rows), so
  // read the manifest page by page until it is empty. Every restored row is
  // deleted below, so each page starts from the oldest remaining segment and
  // no cursor is needed; a re-run after a failure resumes the same way.
  for (;;) {
    const { data: manifest, error: manErr } = await supabase
      .from('stat_archives')
      .select('*')
      .eq('user_id', userId)
      .order('updated_to', { ascending: true })
      .range(0, MANIFEST_PAGE - 1);
    if (manErr) return NextResponse.json({ error: manErr.message }, { status: 500 });
    const page = (manifest ?? []) as StatArchiveManifestRow[];
    if (page.length === 0) break;

    for (const m of page) {
      let segment;
      try {
        segment = await readSegment(bucket, m);
      } catch (e) {
        if (e instanceof SegmentUnavailableError) return fail(m.id, e.message);
        throw e;
      }
      for (let i = 0; i < segment.rows.length; i += CHUNK) {
        const chunk = segment.rows.slice(i, i + CHUNK).map((r) => ({
          book_hash: r.book_hash,
          page: r.page,
          start_time: r.start_time,
          duration: r.duration,
          total_pages: r.total_pages,
          ext: r.ext ?? null,
          deleted_at: r.deleted_at ?? null,
        }));
        const { error: upErr } = await supabase.rpc('upsert_stat_pages_as', {
          p_user: userId,
          p_rows: chunk,
        });
        if (upErr) return fail(m.id, upErr.message);
      }
      const { error: delErr } = await supabase
        .from('stat_archives')
        .delete()
        .eq('user_id', userId)
        .eq('id', m.id);
      if (delErr) return fail(m.id, delErr.message);
      restoredSegments++;
      rows += segment.rows.length;
    }
  }

  return NextResponse.json({ restored_segments: restoredSegments, rows });
}
