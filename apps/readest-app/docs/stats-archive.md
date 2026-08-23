# Reading-statistics archive (stat_pages tiering)

Page events (`stat_pages`, one row per book/page/start_time, KOReader-compatible) are
an append-only per-user log with one merge rule (longest duration wins). The server
never reads history for analytics; devices union-merge everything locally. Keeping
the whole history in Postgres is therefore the most expensive way to store it.

Migration 020 adds a second tier: `stat_pages` keeps a **hot window** (rows whose
`updated_at` is younger than `STATS_COMPACT_WINDOW_DAYS`, default 7), and a cron job
compacts older rows into **immutable per-user JSON segments** in R2, listed in the
`stat_archives` manifest. The stats pull composes its pages from segments + hot rows
**server-side**: the sync API, the app and the koplugin are unchanged.

## Pieces

| Piece | Where |
|---|---|
| Schema, RPCs | `docker/volumes/db/migrations/020_stat_archives.sql` |
| Shared helpers (env, guard, codec, page selection) | `src/libs/statsArchive.ts` |
| Compaction job | `src/app/api/stats/compact/route.ts` (`POST /api/stats/compact`) |
| Restore tool (rollback) | `src/app/api/stats/restore/route.ts` (`POST /api/stats/restore`) |
| Segment-aware pull | `src/pages/api/sync.ts` (`GET /api/sync?type=stats`) |
| Account deletion cleanup | `src/pages/api/user/delete.ts` |
| Cron entry | `worker.ts` (`scheduled()` calls the compact route), `wrangler.toml` `[triggers]` |
| SQL verification | `scripts/db/verify-migration-020.sh` (throwaway local PostgreSQL 15) |

## Invariant

A committed segment covers `(updated_from, updated_to]` exactly, and the same
transaction (`stat_archive_commit`) deletes those hot rows. Every push stamps
`updated_at = now()`. Therefore every hot row of a user is newer than every segment
of that user, and "segments in `updated_to` order, then hot rows" is global
`updated_at` order: the client cursor contract (rows with `updated_at > since`,
ordered by `updated_at`, paged by `limit` with the trailing millisecond included)
holds across tiers.

A segment never splits a **millisecond**: `stat_archive_rows` extends the page with
every row of the user in the same millisecond as its last row, because clients page
on a millisecond cursor (`updated_at_ms`) and objects are keyed by `updated_to_ms`.

## Pull read order (required)

`/api/sync` queries hot rows **before** the manifest. If a compaction commits between
the two reads, rows that moved out of the hot table are visible through the manifest.
Reading hot first can only return such rows twice (clients union-merge), never zero
times. Do not reorder these queries.

## Segment objects

Key `stats/v1/{user_id}/{updated_to_ms}.json`, `Content-Type: application/json`:

```json
{"v":1,"user_id":"...","updated_from_ms":0,"updated_to_ms":1787454881000,
 "rows":[{"book_hash":"...","page":1,"start_time":1787454881,"duration":36,"total_pages":300,
          "ext":null,"deleted_at":null,"updated_at_ms":1787454881000}]}
```

Rows are sorted by `(updated_at_ms, book_hash, page, start_time)` and use the wire
field names, so the pull handler returns them verbatim (plus `user_id`/`updated_at`).
`updated_at_ms` is the Postgres timestamp truncated (never rounded) to milliseconds;
the manifest row and the commit keep the exact microsecond `updated_to`.

Objects are immutable and are **never deleted by the compaction path**: after a failed
commit a concurrent winner's manifest may already reference the key, and a retry
overwrites the same key with identical content. Only account deletion removes objects.

## Compaction policy (wrangler vars, defaults)

| Var | Default | Meaning |
|---|---|---|
| `STATS_COMPACT_ENABLED` | `"false"` | kill switch; anything but `"true"` makes the endpoint answer 503 |
| `STATS_COMPACT_TOKEN` (secret) | unset | `x-compact-token` header value; unset = 503 |
| `STATS_COMPACT_USERS_PER_RUN` | 50 | users claimed per run (`stat_archive_claim_users`) |
| `STATS_COMPACT_WINDOW_DAYS` | 7 | hot window |
| `STATS_COMPACT_MIN_ROWS` | 500 | eligible when this many rows are older than the window |
| `STATS_COMPACT_MAX_AGE_DAYS` | 30 | or when the oldest eligible row is older than this |
| `STATS_COMPACT_HOT_CAP` | 20000 | or when the user has more hot rows than this |
| `STATS_COMPACT_SEGMENTS_PER_USER` | 5 | segments per user per run |
| `STATS_COMPACT_SEGMENT_ROWS` | 10000 | rows per segment (extended to the trailing millisecond) |

Garbage or out-of-range values fall back to the default. A run answers
`200 {ok, users_claimed, users_archived, segments, rows, bytes, errors,
commit_mismatches, duration_ms}`; per-user failures count in `errors`, only a failed
claim is a 500. Every run logs one JSON line (`tag: "stats-compact"`) and writes one
Analytics Engine point to `STATS_COMPACT_AE` (`indexes ['compact']`,
`blobs [outcome, error]`, `doubles [users_claimed, users_archived, segments, rows,
bytes, duration_ms, errors, commit_mismatches]`).

The stats pull writes one point to the same dataset per **R2-backed** pull (none for
hot-only pulls): `indexes ['pull']`, `blobs ['paged' | 'full']`, `doubles
[segments_read, segment_rows_returned, limit]`. Dividing the count of `pull` points by
the total stats pulls (edge logs or `pg_stat_statements`) gives the share of pulls that
reach the archive, which is the number that should drive `STATS_COMPACT_WINDOW_DAYS`:
a larger window spares devices idle for less than the window, at the price of a
proportionally larger hot table.

Guard order for `compact`: 503 (disabled / no token / no bucket) before 401 (bad token).
`restore`: 503 (no token / no bucket), 401, then 409 while compaction is enabled, so
restore and compaction are mutually exclusive without locking.

## Rollout

1. Apply migration 020 (additive: new tables/functions, autovacuum settings on
   `stat_pages`). Deploy the API with `STATS_COMPACT_ENABLED = "false"`: nothing
   observable changes (no segments exist; the cron fires and gets 503).
2. Create the bucket (`readest-stats-archive`) and `wrangler secret put
   STATS_COMPACT_TOKEN`. On a preview deployment set `STATS_COMPACT_ENABLED = "true"`,
   run `POST /api/stats/compact` by hand against a test account until it is fully
   compacted, then verify a fresh-device pull (cursor 0, app and koplugin, paged and
   unpaginated) reproduces per-book `count(*)` and `sum(duration)` exactly.
3. Set `STATS_COMPACT_ENABLED = "true"` in production. Watch `STATS_COMPACT_AE` and
   `pg_stat_user_tables` (`n_live_tup`, `n_dead_tup`, `last_autovacuum`) for
   `stat_pages`. Steady state for the measurement queries below is 0 rows.
4. After the backlog drains: `REINDEX INDEX CONCURRENTLY stat_pages_pkey` off-peak
   (needs free disk about the index size) to reclaim index bloat; optionally
   `pg_repack` the heap.

Measurement queries:

```sql
-- users still holding an archivable backlog (expect 0 rows in steady state)
SELECT user_id, count(*) AS eligible, min(updated_at) AS oldest
FROM public.stat_pages WHERE updated_at <= now() - interval '7 days'
GROUP BY user_id
HAVING count(*) >= 500 OR min(updated_at) <= now() - interval '37 days';
-- users over the hot cap (expect 0 rows)
SELECT user_id FROM public.stat_pages GROUP BY user_id HAVING count(*) > 20000;
-- relation size trend
SELECT pg_size_pretty(pg_total_relation_size('public.stat_pages'));
```

## Rollback

- Stop: set `STATS_COMPACT_ENABLED = "false"` and redeploy. Segments stay readable;
  pulls keep working.
- Undo data movement: with compaction disabled, `POST /api/stats/restore` with
  `{"user_id": "<uuid>"}` and the token re-inserts that user's segments through
  `upsert_stat_pages_as` (idempotent) and drops the manifest rows; it stops at the
  first unreadable object with `{restored_segments, failed_manifest_id}` and a re-run
  resumes. Loop over `SELECT DISTINCT user_id FROM stat_archives` to restore everyone.

## Account deletion

`DELETE /api/user/delete` deletes `stats/v1/{user_id}/` (paginated listing, batches of
1000 keys) **before** deleting the auth user and refuses the deletion (500) if that
fails; it sweeps the prefix once more afterwards, best-effort, to catch an object
written by a compaction run that was between its put and its (now failing) commit.
Residual orphans (a put landing after the second sweep) can be found by listing
`stats/v1/` prefixes whose user has no `auth.users` row; delete them with the bucket
tools.

## Self-hosting

Without the `STATS_ARCHIVE_R2` binding the feature is off: the compact/restore
endpoints answer 503, account deletion skips the cleanup, and the pull never sees a
manifest row (no compaction ever ran), so it behaves exactly as before migration 020.

## Verifying the SQL

`apps/readest-app/scripts/db/verify-migration-020.sh` starts a throwaway PostgreSQL 15
cluster (Homebrew `postgresql@15` is found automatically; otherwise export `PGBIN`),
stubs `auth.users`, `auth.uid()` and the Supabase roles, applies migrations 014, 019
and 020, and asserts: claim ring + cursor wrap, candidate counts, trailing-millisecond
extension, commit range delete + CAS (`40001`), draining in a second segment,
`upsert_stat_pages_as`, `stat_archives` RLS, and that `anon`/`authenticated` cannot
execute any archive RPC.
