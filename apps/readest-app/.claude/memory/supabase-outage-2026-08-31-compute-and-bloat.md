---
name: supabase-outage-2026-08-31-compute-and-bloat
description: "Cloudflare 521/522 across every Supabase route means compute starvation, NOT a bad custom_access_token_hook; plus safe prune recipes for auth.audit_log_entries / auth.refresh_tokens, REINDEX for stat_pages index bloat, and the Management-API statement_timeout workaround"
metadata:
  type: project
---

Prod Supabase, PG 15. Figures deliberately omitted - see [[feedback-no-prod-metrics-in-public]]; re-measure before acting.

**Misdiagnosis to avoid.** An edit to `public.custom_access_token_hook` was immediately followed by floods of `522` on `GET /auth/v1/user`, and reverting the hook did not help. **The hook was a red herring.** How to rule it out fast:
- `/auth/v1/user` never invokes the hook - it runs only when an access token is MINTED (`/token` grants).
- `storage_purchased_bytes` has been a JWT claim since PR #2325 (`fdf6908fc`), so any "revert" that keeps the `public.plans` select changes nothing.
- A failing hook returns HTTP 500 with a JSON body. **521/522 are Cloudflare->origin CONNECTION failures - a saturation signature, never a SQL error.**
- Check `pg_stat_activity`: if nothing is `active` and nothing waits on `Lock`, nothing is blocked on the hook.
- If PostgREST/Storage/Realtime are degraded too, no token hook can explain it.

**Actual signature of compute starvation** (instance swapping, working set >> RAM): control plane reports `db: ACTIVE_HEALTHY` while `auth` and `rest` are `UNHEALTHY`; GoTrue `/auth/v1/health` takes many seconds or times out; Kong still 401s instantly (it rejects without reaching the origin, so a fast 401 is NOT proof auth is up); the Management-API SQL endpoint intermittently returns `Connection terminated due to connection timeout` even though connection COUNT is far below `max_connections`. **Fix is a compute upgrade**, which also restarts and unwedges the services. This exact failure was predicted a week earlier in [[stat-pages-slow-query-disk-growth]], where "upgrade compute" sat as open item #1.

**Reclaim recipes (2026-08-31).**
- `truncate auth.audit_log_entries` - nothing reads it (dashboard Auth logs come from Logflare, not this table). Instant, minimal WAL, returns space to the OS, unlike DELETE. Run with `set lock_timeout='5s'` so it cannot pile up behind auth writes. Cost is losing GoTrue's own audit history.
- Prune `auth.refresh_tokens` in batches. **The predicate MUST be `revoked = true and updated_at < now() - interval '30 days'`.** With rotation enabled the overwhelming majority of rows are already revoked, and deleting only those logs out NOBODY (a revoked token is dead once past `security_refresh_token_reuse_interval`). **Never delete non-revoked rows** - most live tokens are older than 30 days (dormant users) and deleting them signs those users out; sanity-check the non-revoked count against `auth.sessions`.
- **DELETE + plain VACUUM never returns file space**, and B-tree indexes are far worse than heaps: after deleting most of `public.stat_pages`, its indexes had GROWN in absolute size while the table shrank. `REINDEX INDEX CONCURRENTLY` on `stat_pages_pkey` and `idx_stat_pages_user_updated` cut them by ~4-7x with no blocking lock (`SHARE UPDATE EXCLUSIVE` does not conflict with the `ROW EXCLUSIVE` that stat pushes take - verified zero blocked writers mid-run). `public.stat_pages` is owned by `postgres`, so REINDEX is available there.

**Do not trust `pg_stat_user_tables` after a restart.** A compute upgrade resets the cumulative counters: `n_live_tup` read as double digits for a huge table and `last_autovacuum` was NULL everywhere. That made a perfectly healthy archive job look dead and autovacuum look like it had never run. **Cross-check with `pg_class.reltuples` or a real `count(*)` before concluding anything is broken.**

**Management API SQL gotchas** (`POST api.supabase.com/v1/projects/<ref>/database/query`):
- Token: the Supabase CLI's macOS keychain entry has two accounts; only one yields the real `sbp_` token, the other returns a `go-keyring-...` blob that fails with `JWT could not be decoded`.
- Python `urllib` is blocked by Cloudflare with `error code: 1010` - send a curl/browser `User-Agent`.
- **`statement_timeout` is 2 min from `/etc/postgresql-custom/platform-defaults.conf`** (source `configuration file`), and **multi-statement submissions get wrapped in a transaction**, so `SET statement_timeout; REINDEX CONCURRENTLY ...` fails `25001 cannot run inside a transaction block` while a lone statement is cancelled at 2 min. Workaround: `alter role postgres set statement_timeout = '90min'` (touches only the admin role - the app connects as `authenticator`, which carries its own `statement_timeout=8s`), run the single statement, then **`alter role postgres reset statement_timeout` - ALWAYS RESET.**
- A gateway `error code: 524` does NOT cancel the query: `REINDEX` writes nothing to the client, so Postgres never notices the disconnect and runs to completion. Track it via `pg_stat_progress_create_index`, not the HTTP response.
- A cancelled `REINDEX CONCURRENTLY` leaves an INVALID `<index>_ccnew[N]`; drop it before retrying or they accumulate.
- `postgres` is NOT a member of `supabase_auth_admin` and cannot `set role` to it, so it **cannot CREATE INDEX or REINDEX on `auth.*`** (owner is `supabase_auth_admin`) - only SELECT/INSERT/UPDATE/DELETE/TRUNCATE. It IS the owner of database `postgres`, so `VACUUM`/`ANALYZE` on auth tables does work.

**pg_cron enabled 2026-08-31** (it was available-but-uninstalled; `pg_repack` likewise, and it could fix heap bloat online but needs the client binary plus a direct DB connection). Two daily retention jobs, verified by temporarily setting them to `* * * * *` and reading `cron.job_run_details`:
- `prune-auth-refresh-tokens` `17 4 * * *` - the `revoked = true` delete above. **`order by updated_at` is load-bearing:** without it the `LIMIT` cannot short-circuit once matches go sparse and the statement times out scanning the whole table; with it the run drives off `refresh_tokens_updated_at_idx`.
- `prune-auth-audit-log` `37 4 * * *` - 30-day window. Seq-scans, because there is no `created_at` index and we cannot create one (ownership), but a bounded table makes that trivial.

**Left undone deliberately:** heap bloat in `public.stat_pages` (needs `VACUUM FULL`, ACCESS EXCLUSIVE, blocks stat pushes; the 7-day hot window reuses the space anyway) and index bloat in `auth.refresh_tokens` (unfixable without table ownership).
