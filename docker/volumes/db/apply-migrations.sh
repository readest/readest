#!/bin/sh
# Applies Readest's incremental schema migrations (volumes/db/migrations).
#
# `volumes/db/init/schema.sql` is only the base schema; every schema change
# since then ships as a numbered file under `migrations/`, and nothing applied
# them to a self-hosted database. Fresh deployments therefore came up without
# `files.replica_id`, the `replicas` table or the `claim_inbox_item` RPC, so
# uploads, replica sync and Send to Readest all failed (issue #5550).
#
# The supabase/postgres image runs `/docker-entrypoint-initdb.d/*` in glob order
# on first boot. This script is mounted there as `zz-readest-migrations.sh`,
# which sorts after the image's own `migrate.sh` — by the time it runs, the
# Supabase core schema and `init-scripts/100-schema.sql` are in place.
#
# Applied files are recorded in `readest_meta.migrations`, so it is also safe to
# run by hand after pulling a newer image (see docker/README.md):
#
#   docker compose exec db /docker-entrypoint-initdb.d/zz-readest-migrations.sh

set -e

export PGDATABASE="${POSTGRES_DB:-postgres}"
export PGHOST="${POSTGRES_HOST:-localhost}"
export PGPORT="${POSTGRES_PORT:-5432}"
export PGPASSWORD="${POSTGRES_PASSWORD:-}"

# Run as supabase_admin, like the image's own migrations pass: `postgres` is
# demoted from superuser during first boot, and supabase_admin's default
# privileges already grant anon/authenticated/service_role on new public tables.
psql_admin() {
  psql -v ON_ERROR_STOP=1 --no-password --no-psqlrc -U supabase_admin "$@"
}

# The ledger lives outside `public` on purpose: PostgREST exposes `public`, and
# the default privileges there would hand anon full access to the table.
psql_admin -c "CREATE SCHEMA IF NOT EXISTS readest_meta"
psql_admin -c "CREATE TABLE IF NOT EXISTS readest_meta.migrations (
  name text PRIMARY KEY,
  applied_at timestamp with time zone NOT NULL DEFAULT now()
)"

for sql in /readest-migrations/*.sql; do
  [ -f "$sql" ] || continue
  name="$(basename "$sql")"
  if [ -n "$(psql_admin -tAc "SELECT 1 FROM readest_meta.migrations WHERE name = '$name'")" ]; then
    echo "readest-migrations: $name already applied, skipping"
    continue
  fi
  echo "readest-migrations: applying $name"
  psql_admin -f "$sql"
  psql_admin -c "INSERT INTO readest_meta.migrations (name) VALUES ('$name')"
done
