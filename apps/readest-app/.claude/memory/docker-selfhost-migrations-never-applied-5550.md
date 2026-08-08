---
name: docker-selfhost-migrations-never-applied-5550
description: "Self-hosted Docker only ran init/schema.sql; the supabase image's initdb dirs cannot be bind-mounted as directories without shadowing the Supabase core schema"
metadata: 
  node_type: memory
  type: project
  originSessionId: 401563ca-5d82-4161-9df1-11a3051a87ab
  modified: 2026-08-07T08:22:11.571Z
---

`docker/compose.yaml` mounted only `volumes/db/init/schema.sql`. The 18 files in
`volumes/db/migrations/` were never applied, so every fresh self-hosted stack
booted without `files.replica_id` / `replica_kind` (007), `public.replicas` (003)
or `claim_inbox_item` (012). Issue #5550, MERGED as #5551 on 2026-08-07
(`73e933eb3`). A real `docker compose up -d` on a clean volume was never run
(docker was off limits for the session), so the hook shipped reasoned-correct but
NOT execution-verified. If a self-hoster reports first-boot trouble, that is the
first thing to actually run.

**Why you cannot just mount the migrations directory.** `supabase/postgres`
Dockerfile does `COPY migrations/db /docker-entrypoint-initdb.d/`, so the image
*already ships* `init-scripts/` (initial-schema, auth-schema, storage-schema) and
`migrations/` (53 core files) inside that path. Bind-mounting either as a
directory replaces the Supabase core schema and the DB comes up with no `auth`
schema. Only individual-file mounts are safe there.

The escape hatch: docker-library's entrypoint runs `/docker-entrypoint-initdb.d/*`
(non-recursive, glob order, directories skipped, `.sh` executed if `+x` else
sourced). The image's own `migrate.sh` lives there, so a `zz-*.sh` mounted
alongside it runs *after* the whole core schema plus `init-scripts/100-schema.sql`.
That is how `apply-migrations.sh` + a `/readest-migrations` dir mount gets 2 lines
of compose instead of one per migration.

**Role matters more than it looks.** Supabase's `00000000000000-initial-schema.sql`
sets `alter default privileges in schema public grant all on tables to postgres,
anon, authenticated, service_role` *and* a second `for user supabase_admin`
variant. Migration 003 has no explicit `GRANT` for `replicas` — it relies entirely
on those default privileges, so a table created by any *other* role is invisible
to PostgREST. `postgres` is demoted from superuser during first boot, so the hook
connects as `supabase_admin`.

Also: the applied-migration ledger has to live outside `public`
(`readest_meta.migrations`) or PostgREST exposes it and the public-schema default
privileges hand `anon` full write access.

Migrations are one-shot-safe but not re-runnable: 002/003/012/014 use bare
`CREATE POLICY` (no `IF NOT EXISTS` in PG15). Running all 18 against a DB built
from the old `schema.sql` still succeeds, because every `CREATE POLICY` belongs to
a table that schema.sql never created.

Second half of the same issue: `src/styles/fonts.ts` hardcoded
`storage.readest.com/public/font/dist`, which only answers CORS for readest.com
origins. Now read from `getRuntimeConfig()?.fontBaseUrl` (`FONT_BASE_URL`), joining
[[stale-format-gates-in-settings]]-style config plumbing through
`src/services/runtimeConfig.ts` -> `/runtime-config.js`. Use `||` not `??` there:
compose passes `${FONT_BASE_URL:-}` through as an empty string.

The reporter's "column device_id does not exist" is NOT ours - no Readest
migration defines `device_id`; it only appears in the KOReader sync client.
