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

The manifest query is itself capped at 1000 rows by PostgREST (Supabase `db-max-rows`),
so the pull reads it in `range` pages: hot rows are appended only once a short final
page proves no archived rows remain past the cursor, and a paged pull stops fetching
manifest pages as soon as its response page is full. Treating a capped first page as
the complete list would let a client's cursor advance past unread segments.

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

A segment is **assembled from keyset sub-pages**, because PostgREST truncates every
response at `db-max-rows` and a truncated page must never define a boundary.
`stat_archive_rows` (migration 021) is a plain keyset pager over
`(updated_at, book_hash, page, start_time)`: truncation only shortens a page, the
caller's cursor comes from rows it actually received, and the tie columns let it
paginate *inside* a millisecond that holds more rows than one response can carry
(a restore can land two 500-row chunks, each stamping one `now()`, in one
millisecond). The compaction route owns the boundary policy: it fetches pages until
the target size plus a complete millisecond to cut at (or the user is drained), trims
the trailing millisecond unless it is provably closed (drained and ended at least a
minute before the window cutoff, so no still-hot row of it can age in later), defers
a user whose only eligible rows sit in a still-fresh millisecond, and hard-stops a
pathological single millisecond beyond 50k rows. `stat_archive_commit` refuses
(P0001, full rollback) whenever the range's delete count differs from the declared
segment row count, so any counting bug is loud and lossless; the route reports such
refusals as `commit_mismatches` plus an error, and in a healthy deployment the metric
stays 0.

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
| `STATS_COMPACT_SEGMENT_ROWS` | 10000 | rows per assembled segment; fetched in sub-pages of at most 1000 rows (PostgREST's `db-max-rows` cap), each ending at a complete millisecond |

Garbage or out-of-range values fall back to the default. A run answers
`200 {ok, users_claimed, users_archived, segments, rows, bytes, errors,
commit_mismatches, duration_ms}`; per-user failures count in `errors`, only a failed
claim is a 500. Every run logs one JSON line (`tag: "stats-compact"`) and writes one
Analytics Engine point to `STATS_COMPACT_AE` (`indexes ['compact']`,
`blobs [outcome, error]`, `doubles [users_claimed, users_archived, segments, rows,
bytes, duration_ms, errors, commit_mismatches, orphans_swept]`).

The stats pull writes one point to the same dataset per **R2-backed** pull (none for
hot-only pulls): `indexes ['pull']`, `blobs ['paged' | 'full']`, `doubles
[segments_read, segment_rows_returned, limit]`. Dividing the count of `pull` points by
the total stats pulls (edge logs or `pg_stat_statements`) gives the share of pulls that
reach the archive, which is the number that should drive `STATS_COMPACT_WINDOW_DAYS`:
a larger window spares devices idle for less than the window, at the price of a
proportionally larger hot table.

Guard order for `compact`: 503 (no token / no bucket) before 401 (bad token); then the
batch run sweeps the account-deletion queue (below) and, if `STATS_COMPACT_ENABLED` is
not `"true"`, answers `503 {"disabled":true,"orphans_swept":N}` without compacting.
`restore`: 503 (no token / no bucket), 401, then 409 while compaction is enabled, so
restore and compaction are mutually exclusive without locking.

**Targeted run.** `POST /api/stats/compact` with a JSON body `{"user_id": "<uuid>"}`
and the token compacts that one user: no claiming, the enabled flag is ignored (it is an
operator action, also usable while the cron is off), and the batching thresholds are
ignored (everything older than the window is archived, in segments of
`STATS_COMPACT_SEGMENT_ROWS`, up to `STATS_COMPACT_SEGMENTS_PER_USER` per call; repeat
until `users_archived` is 0). The response carries `"targeted": true`. Use it to validate
on a known account before enabling the cron, or to drain one heavy user.

## Deployment, step by step

Everything up to step 5 is safe with `STATS_COMPACT_ENABLED = "false"` (the default in
`wrangler.toml`): no segments exist, so pulls behave exactly as before, and the cron
fires every 10 minutes and gets a 503. Prerequisites: `wrangler` logged in
(`pnpm exec wrangler whoami`) and access to the database SQL editor (or `psql`).
Run the shell commands from `apps/readest-app`.

**1. Apply migrations 020 and 021.** Paste `docker/volumes/db/migrations/020_stat_archives.sql`
and then `021_stat_archive_row_cap.sql` into the SQL editor and run them (additive and
re-runnable: `IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`). 021 is
required: it hardens the archive RPCs against PostgREST's 1000-row response cap
(`stat_archive_rows` becomes a truncation-proof keyset pager, `stat_archive_commit`
refuses row-count mismatches); the 020 versions can lose rows under truncation. Check:

```sql
select proname from pg_proc where proname in
  ('stat_archive_claim_users','stat_archive_candidate','stat_archive_rows',
   'stat_archive_commit','upsert_stat_pages_as');                       -- 5 rows
select has_function_privilege('anon',
  'public.stat_archive_commit(uuid,text,timestamptz,timestamptz,integer,integer)','execute'); -- false
select * from public.stat_archive_state;                                 -- 1 row, user_cursor null
```

**2. Create the bucket and the token (once).**

```bash
pnpm exec wrangler r2 bucket create readest-stats-archive
openssl rand -hex 32            # the token; keep it in your password manager
pnpm exec wrangler secret put STATS_COMPACT_TOKEN   # paste the token
```

Secrets are stored per Worker and survive deploys; vars in `wrangler.toml` are
re-applied on every deploy (that is why the kill switch lives there).

**3. Deploy with compaction disabled.** `pnpm deploy`, then:

```bash
TOKEN=...   # the value from step 2
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://web.readest.com/api/stats/compact \
  -H "x-compact-token: $TOKEN"                                            # 503 (disabled)
curl -s -X POST https://web.readest.com/api/stats/restore -H "x-compact-token: $TOKEN" \
  -H 'content-type: application/json' -d '{"user_id":"00000000-0000-0000-0000-000000000000"}'
                                          # {"restored_segments":0,"rows":0}: restore path is live
```

In the Cloudflare dashboard (Workers & Pages > readest-web > Settings) the cron
`*/10 * * * *` and the bindings `STATS_ARCHIVE_R2` / `STATS_COMPACT_AE` are listed.
Any device syncing now behaves as before (no manifest rows exist).

**4. Validate on one known account, on production data, cron still off.** Use your own
account (or any account whose device you control).

```sql
-- 4a. its id
select id from auth.users where email = '<you@example.com>';
-- 4b. snapshot per-book totals; keep the output
select book_hash, count(*) as n, sum(duration) as d
from public.stat_pages where user_id = '<uid>' group by 1 order by 1;
```

```bash
# 4c. targeted compaction: that user only, ignores the enabled flag and the batching
#     thresholds, archives everything older than the window; repeat until users_archived = 0
curl -s -X POST https://web.readest.com/api/stats/compact -H "x-compact-token: $TOKEN" \
  -H 'content-type: application/json' -d '{"user_id":"<uid>"}'
# {"ok":true,"targeted":true,"users_claimed":1,"users_archived":1,"segments":N,"rows":R,...}
```

```sql
-- 4d. manifest + nothing older than the window left hot
select id, updated_from, updated_to, row_count, bytes, object_key
from public.stat_archives where user_id = '<uid>' order by updated_to;
select count(*) from public.stat_pages
where user_id = '<uid>' and updated_at <= now() - interval '7 days';    -- 0
```

```bash
# 4d'. look at one object
pnpm exec wrangler r2 object get readest-stats-archive/stats/v1/<uid>/<updated_to_ms>.json \
  --file /tmp/seg.json && head -c 400 /tmp/seg.json
```

4e. Fresh pull on a device signed in as that account: a fresh app install (its pull
cursor starts at 0), or KOReader / the KOReader emulator with the Readest plugin logged
in and a fresh `statistics.sqlite3`, then "Pull reading statistics". Compare with 4b:

```bash
sqlite3 statistics.sqlite3 "select b.md5, count(*), sum(p.duration) from page_stat_data p
  join book b on b.id = p.id_book group by 1 order by 1;"
```

Per-book `count(*)` and `sum(duration)` must match 4b exactly. If the account signs in
with email + password you can also pull through the API directly:

```bash
ACCESS=$(curl -s "https://<project>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H 'content-type: application/json' \
  -d '{"email":"<you@example.com>","password":"..."}' | jq -r .access_token)
curl -s "https://web.readest.com/api/sync?type=stats&since=0&limit=1000" \
  -H "Authorization: Bearer $ACCESS" | jq '.statPages | length, (.[0] // empty)'
```

Pages of 1000 come from the segments first (rows carry `updated_at_ms`), then hot rows;
advance `since` to the last `updated_at_ms` to walk the whole history.

4f. Optional: undo the test with the restore endpoint (`{"user_id":"<uid>"}`): the
rows are back in Postgres (4b totals match again), the manifest rows are gone, the
objects stay.

**5. Enable the cron.** In `wrangler.toml` set `STATS_COMPACT_ENABLED = "true"`, commit,
`pnpm deploy`. The first run happens within 10 minutes; a manual run is identical:

```bash
curl -s -X POST https://web.readest.com/api/stats/compact -H "x-compact-token: $TOKEN"
# {"ok":true,"users_claimed":50,"users_archived":N,"segments":...,"errors":0,"commit_mismatches":0,...}
```

Watch, daily for the first two weeks:

```bash
# Analytics Engine SQL API (API token with "Account Analytics: Read")
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" --data "
  SELECT toStartOfInterval(timestamp, INTERVAL '1' HOUR) AS h, count() AS runs,
         sum(double2) AS users_archived, sum(double3) AS segments, sum(double4) AS rows,
         sum(double5) AS bytes, sum(double7) AS errors, sum(double8) AS mismatches,
         sum(double9) AS orphans_swept
  FROM stats_compact WHERE index1 = 'compact' AND timestamp > NOW() - INTERVAL '1' DAY
  GROUP BY h ORDER BY h DESC"
```

`errors` and `mismatches` should stay 0. Postgres side: the measurement queries below,
plus `select n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze from
pg_stat_user_tables where relname = 'stat_pages';` (autovacuum must keep up: migration
020 sets the table's scale factor to 1%). At the defaults the backlog drains at up to
50 users x 50k rows per run, 144 runs per day.

**6. After the backlog drains** (the measurement queries return 0 rows), off-peak:

```sql
select pg_size_pretty(pg_relation_size('public.stat_pages_pkey'));   -- needs about this much free disk
REINDEX INDEX CONCURRENTLY public.stat_pages_pkey;
REINDEX INDEX CONCURRENTLY public.idx_stat_pages_user_updated;
```

That reclaims the index bloat inside the database (the provider's disk does not shrink;
the freed pages are reused). `pg_repack` on the heap is heavier; skip unless needed.

**7. Revisit the window** after a couple of weeks with the pull metric (next section):
share of pulls that reach the archive = `pull` points / total stats pulls.

Measurement queries (daily during rollout; steady state is 0 rows):

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

`DELETE /api/user/delete` runs three steps. (1) It writes the durable tombstone first:
an upsert into `stat_archive_orphans` (service-role only, no foreign key). If even that
fails, it stops with 500 **before anything destructive**, so a retry is always possible.
(2) It deletes the auth user (Postgres rows cascade; a compaction commit in flight for
that user fails on the manifest's foreign key). If this fails, the tombstone is removed
again, best-effort. (3) It deletes `stats/v1/{user_id}/` right away, best-effort
(paginated listing, batches of 1000 keys), and answers 200: the tombstone makes the
cleanup reliable regardless. Every batch run of `POST /api/stats/compact` (kill switch
on or off) sweeps up to 20 queued users; it first checks the user is really gone
(`auth.admin.getUserById`) and skips, keeping the row, if the account still exists —
a stale tombstone can never wipe a living account — then deletes the prefix and removes
the row once the listing is empty, which also catches an object a compaction run wrote
after the immediate sweep. Deleting objects before the identity would be worse: a
failed `deleteUser` would leave an active account with its history gone and a manifest
pointing at missing objects.

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
