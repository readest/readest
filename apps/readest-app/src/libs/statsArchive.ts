import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Reading-statistics archive: page events older than the hot window leave
 * `stat_pages` for immutable per-user JSON segments in R2, listed in the
 * `stat_archives` manifest (migration 020). This module holds everything the
 * compaction job, the restore tool and the stats pull share: the Worker env
 * surface, the request guard, the segment codec and page selection.
 *
 * Invariant relied on everywhere: a committed segment covers
 * `(updated_from, updated_to]` exactly and the same transaction deleted those
 * hot rows, while every push stamps `updated_at = now()`. Hence every hot row
 * of a user is newer than every segment of that user, and "segments in
 * updated_to order, then hot rows" is global updated_at order.
 */

export const SEGMENT_VERSION = 1 as const;
const SEGMENT_KEY_PREFIX = 'stats/v1/';

/** One page event as stored inside a segment and as returned on the wire. */
export interface ArchivedPageRow {
  book_hash: string;
  page: number;
  start_time: number;
  duration: number;
  total_pages: number;
  ext: unknown;
  deleted_at: string | null;
  updated_at_ms: number;
}

export interface StatsSegment {
  v: typeof SEGMENT_VERSION;
  user_id: string;
  updated_from_ms: number;
  updated_to_ms: number;
  rows: ArchivedPageRow[];
}

/** A `stat_archives` manifest row. */
export interface StatArchiveManifestRow {
  id: number;
  user_id: string;
  updated_from: string;
  updated_to: string;
  row_count: number;
  bytes: number;
  object_key: string;
}

// Minimal local typings for the Cloudflare bindings (the project does not
// depend on @cloudflare/workers-types; same approach as iap/telemetry.ts).
export interface R2ObjectBodyLike {
  size: number;
  text(): Promise<string>;
}
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
}
export interface AnalyticsEngineDatasetLike {
  writeDataPoint(event: {
    indexes?: string[];
    blobs?: (string | null)[];
    doubles?: number[];
  }): void;
}

export interface StatsArchiveEnv {
  STATS_ARCHIVE_R2?: R2BucketLike;
  STATS_COMPACT_AE?: AnalyticsEngineDatasetLike;
  STATS_COMPACT_TOKEN?: string;
  STATS_COMPACT_ENABLED?: string;
  STATS_COMPACT_USERS_PER_RUN?: string;
  STATS_COMPACT_WINDOW_DAYS?: string;
  STATS_COMPACT_MIN_ROWS?: string;
  STATS_COMPACT_MAX_AGE_DAYS?: string;
  STATS_COMPACT_HOT_CAP?: string;
  STATS_COMPACT_SEGMENTS_PER_USER?: string;
  STATS_COMPACT_SEGMENT_ROWS?: string;
}

/** The Worker env, or `{}` outside the Worker runtime (local dev, tests). */
export const getStatsArchiveEnv = (): Partial<StatsArchiveEnv> => {
  try {
    return (getCloudflareContext().env ?? {}) as Partial<StatsArchiveEnv>;
  } catch {
    return {};
  }
};

/**
 * PostgREST timestamptz text -> epoch ms. Postgres keeps microseconds
 * (`...00.123456+00:00`); JS dates are millisecond precision, so the fraction
 * is truncated (never rounded) to 3 digits first: the millisecond cursor must
 * never move past a row it has not delivered.
 */
export const tsToMs = (ts: string): number =>
  Date.parse(ts.replace(/\.(\d{1,3})\d*/, (_m, f: string) => `.${f.padEnd(3, '0')}`));

export const segmentKey = (userId: string, updatedToMs: number) =>
  `${SEGMENT_KEY_PREFIX}${userId}/${updatedToMs}.json`;

export const userSegmentPrefix = (userId: string) => `${SEGMENT_KEY_PREFIX}${userId}/`;

const compareRows = (a: ArchivedPageRow, b: ArchivedPageRow) =>
  a.updated_at_ms - b.updated_at_ms ||
  (a.book_hash < b.book_hash ? -1 : a.book_hash > b.book_hash ? 1 : 0) ||
  a.page - b.page ||
  a.start_time - b.start_time;

/** Wire key order; also what the segment stores. */
const toWireRow = (r: ArchivedPageRow): ArchivedPageRow => ({
  book_hash: r.book_hash,
  page: r.page,
  start_time: r.start_time,
  duration: r.duration,
  total_pages: r.total_pages,
  ext: r.ext ?? null,
  deleted_at: r.deleted_at ?? null,
  updated_at_ms: r.updated_at_ms,
});

export function encodeSegment(seg: StatsSegment): string {
  const rows = [...seg.rows].sort(compareRows).map(toWireRow);
  return JSON.stringify({
    v: SEGMENT_VERSION,
    user_id: seg.user_id,
    updated_from_ms: seg.updated_from_ms,
    updated_to_ms: seg.updated_to_ms,
    rows,
  });
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function decodeSegment(text: string): StatsSegment {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('segment is not an object');
  const seg = parsed as Record<string, unknown>;
  if (seg['v'] !== SEGMENT_VERSION)
    throw new Error(`unsupported segment version ${String(seg['v'])}`);
  if (typeof seg['user_id'] !== 'string') throw new Error('segment user_id missing');
  if (!isFiniteNumber(seg['updated_from_ms']) || !isFiniteNumber(seg['updated_to_ms'])) {
    throw new Error('segment range missing');
  }
  if (!Array.isArray(seg['rows'])) throw new Error('segment rows missing');
  const rows = (seg['rows'] as unknown[]).map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (
      typeof r['book_hash'] !== 'string' ||
      !isFiniteNumber(r['page']) ||
      !isFiniteNumber(r['start_time']) ||
      !isFiniteNumber(r['duration']) ||
      !isFiniteNumber(r['total_pages']) ||
      !isFiniteNumber(r['updated_at_ms']) ||
      (r['deleted_at'] != null && typeof r['deleted_at'] !== 'string')
    ) {
      throw new Error(`invalid segment row at index ${i}`);
    }
    return toWireRow({
      book_hash: r['book_hash'],
      page: r['page'],
      start_time: r['start_time'],
      duration: r['duration'],
      total_pages: r['total_pages'],
      ext: r['ext'] ?? null,
      deleted_at: (r['deleted_at'] as string | null | undefined) ?? null,
      updated_at_ms: r['updated_at_ms'],
    });
  });
  return {
    v: SEGMENT_VERSION,
    user_id: seg['user_id'],
    updated_from_ms: seg['updated_from_ms'],
    updated_to_ms: seg['updated_to_ms'],
    rows,
  };
}

/**
 * Rows strictly after `sinceMs` (and of `book` when given), in segment order.
 * With a positive `limit`, the first `limit` rows extended with every trailing
 * row that shares the last `updated_at_ms`, so a client advancing its cursor
 * to that value never skips a tie. `limit <= 0` returns everything.
 */
export function takePage(
  rows: ArchivedPageRow[],
  sinceMs: number,
  limit: number,
  book?: string | null,
): ArchivedPageRow[] {
  const kept = rows.filter((r) => r.updated_at_ms > sinceMs && (!book || r.book_hash === book));
  if (limit <= 0 || kept.length <= limit) return kept;
  const edge = kept[limit - 1]!.updated_at_ms;
  let end = limit;
  while (end < kept.length && kept[end]!.updated_at_ms === edge) end++;
  return kept.slice(0, end);
}

/** Segment row as the stats pull returns it (same shape as a hot row). */
export const toWireStatPage = (r: ArchivedPageRow, userId: string) => ({
  user_id: userId,
  ...toWireRow(r),
  updated_at: new Date(r.updated_at_ms).toISOString(),
});

export class SegmentUnavailableError extends Error {
  constructor(
    public readonly manifestId: number,
    cause: string,
  ) {
    super(`archive segment ${manifestId} unavailable: ${cause}`);
  }
}

/** Fetch and decode one segment; every failure becomes SegmentUnavailableError. */
export async function readSegment(
  bucket: R2BucketLike,
  manifest: StatArchiveManifestRow,
): Promise<StatsSegment> {
  let obj: R2ObjectBodyLike | null;
  try {
    obj = await bucket.get(manifest.object_key);
  } catch (e) {
    throw new SegmentUnavailableError(manifest.id, String(e));
  }
  if (!obj) throw new SegmentUnavailableError(manifest.id, 'missing object');
  try {
    return decodeSegment(await obj.text());
  } catch (e) {
    throw new SegmentUnavailableError(manifest.id, (e as Error).message);
  }
}

/**
 * Delete every archive object of a user (paginated listing, batches of at most
 * 1000 keys, R2's delete limit). Throws on the first failed call.
 */
export async function deleteUserSegments(bucket: R2BucketLike, userId: string): Promise<number> {
  const prefix = userSegmentPrefix(userId);
  let cursor: string | undefined;
  let deleted = 0;
  for (;;) {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    const keys = page.objects.map((o) => o.key);
    for (let i = 0; i < keys.length; i += 1000) {
      await bucket.delete(keys.slice(i, i + 1000));
    }
    deleted += keys.length;
    if (!page.truncated) return deleted;
    cursor = page.cursor;
  }
}

export type ArchiveGuardResult =
  | { ok: true }
  | { ok: false; status: 503 | 401 | 409; body: Record<string, unknown> };

/**
 * Guard for the compact / restore endpoints. Order matters: configuration
 * problems (no token, no bucket) answer 503 before any auth check so a
 * misconfigured deployment never reports auth errors; then 401 on a bad token.
 * The compact route applies STATS_COMPACT_ENABLED itself, after its
 * maintenance step, so operator actions (targeted runs, the orphan sweep,
 * restore) work while the cron is off; `restore` additionally refuses with 409
 * while compaction is enabled (mutual exclusion with the cron).
 */
export function guardArchiveRequest(
  req: Request,
  env: Partial<StatsArchiveEnv>,
  mode: 'compact' | 'restore',
): ArchiveGuardResult {
  if (!env.STATS_COMPACT_TOKEN || !env.STATS_ARCHIVE_R2) {
    return { ok: false, status: 503, body: { disabled: true } };
  }
  if (req.headers.get('x-compact-token') !== env.STATS_COMPACT_TOKEN) {
    return { ok: false, status: 401, body: { error: 'unauthorized' } };
  }
  if (mode === 'restore' && env.STATS_COMPACT_ENABLED === 'true') {
    return { ok: false, status: 409, body: { error: 'disable compaction first' } };
  }
  return { ok: true };
}

/** The cron's batch run is the only path gated by the kill switch. */
export const isCompactionEnabled = (env: Partial<StatsArchiveEnv>) =>
  env.STATS_COMPACT_ENABLED === 'true';

export interface CompactConfig {
  usersPerRun: number;
  windowDays: number;
  minRows: number;
  maxAgeDays: number;
  hotCap: number;
  segmentsPerUser: number;
  segmentRows: number;
}

const COMPACT_DEFAULTS: CompactConfig = {
  usersPerRun: 50,
  windowDays: 7,
  minRows: 500,
  maxAgeDays: 30,
  hotCap: 20000,
  segmentsPerUser: 5,
  segmentRows: 10000,
};

const positiveInt = (value: string | undefined, fallback: number) => {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : fallback;
};

/** Compaction knobs from wrangler vars; garbage or out-of-range falls back. */
export function readCompactConfig(env: Partial<StatsArchiveEnv>): CompactConfig {
  return {
    usersPerRun: positiveInt(env.STATS_COMPACT_USERS_PER_RUN, COMPACT_DEFAULTS.usersPerRun),
    windowDays: positiveInt(env.STATS_COMPACT_WINDOW_DAYS, COMPACT_DEFAULTS.windowDays),
    minRows: positiveInt(env.STATS_COMPACT_MIN_ROWS, COMPACT_DEFAULTS.minRows),
    maxAgeDays: positiveInt(env.STATS_COMPACT_MAX_AGE_DAYS, COMPACT_DEFAULTS.maxAgeDays),
    hotCap: positiveInt(env.STATS_COMPACT_HOT_CAP, COMPACT_DEFAULTS.hotCap),
    segmentsPerUser: positiveInt(
      env.STATS_COMPACT_SEGMENTS_PER_USER,
      COMPACT_DEFAULTS.segmentsPerUser,
    ),
    segmentRows: positiveInt(env.STATS_COMPACT_SEGMENT_ROWS, COMPACT_DEFAULTS.segmentRows),
  };
}
