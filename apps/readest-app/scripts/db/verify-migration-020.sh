#!/usr/bin/env bash
# Verify migrations 014 + 019 + 020 (reading statistics: tables, upsert RPC,
# archive manifest + compaction RPCs) against a throwaway local PostgreSQL 15.
#
# Needs a PostgreSQL 15 server install (Homebrew: `brew install postgresql@15`,
# then it is found automatically; or export PGBIN=/path/to/pg/bin). Creates a
# Supabase-shaped stub: auth.users, auth.uid() driven by the
# `request.jwt.claim.sub` GUC, roles anon/authenticated/service_role.
#
#   apps/readest-app/scripts/db/verify-migration-020.sh
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
MIGRATIONS="$ROOT/docker/volumes/db/migrations"
PGBIN=${PGBIN:-}
if [ -z "$PGBIN" ]; then
  for c in /opt/homebrew/opt/postgresql@15/bin /usr/local/opt/postgresql@15/bin /usr/lib/postgresql/15/bin; do
    [ -x "$c/initdb" ] && PGBIN="$c" && break
  done
fi
if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/initdb" ]; then
  echo "verify-migration-020: PostgreSQL 15 binaries not found; set PGBIN" >&2
  exit 2
fi

D=$(mktemp -d "${TMPDIR:-/tmp}/readest-pg15.XXXXXX")
PORT=${PGPORT_VERIFY:-54329}
cleanup() { "$PGBIN/pg_ctl" -D "$D" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"; }
trap cleanup EXIT
"$PGBIN/initdb" -D "$D" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$D" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/log" start -w >/dev/null
PSQL="$PGBIN/psql -h 127.0.0.1 -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X"
$PSQL -t -c "select version()" | head -1

U1=00000000-0000-0000-0000-000000000001
U2=00000000-0000-0000-0000-000000000002
U3=00000000-0000-0000-0000-000000000003

$PSQL <<SQL
create schema auth;
create table auth.users (id uuid primary key);
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create function auth.uid() returns uuid language sql stable
  as \$\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$\$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
insert into auth.users values ('$U1'), ('$U2'), ('$U3');
SQL
$PSQL -f "$MIGRATIONS/014_add_reading_stats.sql"
$PSQL -f "$MIGRATIONS/019_stat_pages_upsert_rpc.sql"
$PSQL -f "$MIGRATIONS/020_stat_archives.sql"

# Seed: u1 has 30 old rows (3 per ms over 10 ms, 40 days ago; the 2nd ms also
# holds a row 400 microseconds later, i.e. same millisecond, different
# timestamp) + 5 hot rows (now); u2 has 4 old rows; u3 has only hot rows.
$PSQL <<SQL
begin;  -- one transaction so now() is identical across the seed statements
insert into public.stat_pages (user_id, book_hash, page, start_time, duration, total_pages, updated_at)
select '$U1', 'b1', p, 1000 + ms * 10 + p, 5, 100,
       date_trunc('milliseconds', now() - interval '40 days') + make_interval(secs => ms * 0.001)
from generate_series(0, 9) ms, generate_series(1, 3) p;
insert into public.stat_pages (user_id, book_hash, page, start_time, duration, total_pages, updated_at)
values ('$U1', 'b1', 4, 1014, 5, 100,
        date_trunc('milliseconds', now() - interval '40 days') + interval '1.4 milliseconds');
insert into public.stat_pages (user_id, book_hash, page, start_time, duration, total_pages, updated_at)
select '$U1', 'b1', 100 + p, 5000 + p, 5, 100, now() from generate_series(1, 5) p;
insert into public.stat_pages (user_id, book_hash, page, start_time, duration, total_pages, updated_at)
select '$U2', 'b2', p, 2000 + p, 7, 50, now() - interval '20 days' from generate_series(1, 4) p;
insert into public.stat_pages (user_id, book_hash, page, start_time, duration, total_pages, updated_at)
select '$U3', 'b3', p, 3000 + p, 9, 10, now() from generate_series(1, 2) p;
commit;
SQL

$PSQL <<SQL
set role service_role;

-- 1. claim: ring over users in PK order; cursor advances then wraps to NULL
do \$\$
declare a uuid[]; b uuid[]; c uuid[]; cur uuid; begin
  select array_agg(u) into a from public.stat_archive_claim_users(2) u;
  assert a = array['$U1'::uuid, '$U2'::uuid], format('batch1 %s', a);
  select user_cursor into cur from public.stat_archive_state; assert cur = '$U2'::uuid;
  select array_agg(u) into b from public.stat_archive_claim_users(2) u;
  assert b = array['$U3'::uuid], format('batch2 %s', b);
  select user_cursor into cur from public.stat_archive_state; assert cur is null, 'cursor wraps to NULL';
  select array_agg(u) into c from public.stat_archive_claim_users(2) u;
  assert c = a, 'ring restarts from the smallest user';
  raise notice 'ok 1: claim ring + cursor wrap';
end \$\$;

-- 2. candidate numbers
do \$\$
declare r record; begin
  select * into r from public.stat_archive_candidate('$U1', '7 days');
  assert r.eligible = 31 and r.hot_total = 36 and r.archived_to = 'epoch'::timestamptz, format('u1 %s', r);
  assert r.oldest < now() - interval '39 days';
  select * into r from public.stat_archive_candidate('$U3', '7 days');
  assert r.eligible = 0 and r.hot_total = 2, format('u3 %s', r);
  raise notice 'ok 2: candidate counts';
end \$\$;

-- 3. rows: limit 4 lands inside the 2nd millisecond (3 rows at +1.0 ms plus one
--    at +1.4 ms) -> extended to the whole millisecond: 3 + 4 = 7 rows, 2 distinct ms
do \$\$
declare n int; d int; begin
  select count(*), count(distinct date_trunc('milliseconds', updated_at)) into n, d
    from public.stat_archive_rows('$U1', 'epoch', '7 days', 4);
  assert n = 7 and d = 2, format('rows=%s ms=%s', n, d);
  select count(*) into n from public.stat_archive_rows('$U1', 'epoch', '7 days', 100);
  assert n = 31, format('all eligible %s', n);  -- hot rows excluded by the window
  raise notice 'ok 3: segment rows extend to the trailing millisecond';
end \$\$;

-- 4. commit: deletes exactly (from, to], returns the count, CAS protects against a second committer
do \$\$
declare t_to timestamptz; n int; begin
  select max(updated_at) into t_to from public.stat_archive_rows('$U1', 'epoch', '7 days', 4);
  n := public.stat_archive_commit('$U1', 'stats/v1/u1/seg1.json', 'epoch', t_to, 7, 123);
  assert n = 7, format('deleted %s', n);
  assert (select count(*) from public.stat_pages where user_id = '$U1') = 29;
  assert (select archived_to from public.stat_archive_candidate('$U1', '7 days')) = t_to;
  begin
    perform public.stat_archive_commit('$U1', 'stats/v1/u1/seg1-dup.json', 'epoch', t_to, 7, 123);
    raise exception 'second committer must fail';
  exception when sqlstate '40001' then null;
  end;
  assert (select count(*) from public.stat_archives where user_id = '$U1') = 1;
  raise notice 'ok 4: commit range delete + CAS 40001';
end \$\$;

-- 5. a follow-up segment resumes from archived_to and drains the rest
do \$\$
declare t_from timestamptz; t_to timestamptz; n int; begin
  select archived_to into t_from from public.stat_archive_candidate('$U1', '7 days');
  select max(updated_at) into t_to from public.stat_archive_rows('$U1', t_from, '7 days', 1000);
  n := public.stat_archive_commit('$U1', 'stats/v1/u1/seg2.json', t_from, t_to, 24, 456);
  assert n = 24, format('deleted %s', n);
  assert (select eligible from public.stat_archive_candidate('$U1', '7 days')) = 0;
  assert (select hot_total from public.stat_archive_candidate('$U1', '7 days')) = 5, 'hot rows untouched';
  raise notice 'ok 5: second segment drains the backlog, hot rows untouched';
end \$\$;

-- 6. restore path: upsert_stat_pages_as merges for an explicit user (longest duration wins)
do \$\$
declare n int; begin
  n := public.upsert_stat_pages_as('$U1', '[{"book_hash":"b1","page":1,"start_time":1001,"duration":5,"total_pages":100},
                                            {"book_hash":"b1","page":1,"start_time":1001,"duration":9,"total_pages":100}]');
  assert n = 1, format('inserted %s', n);
  assert (select duration from public.stat_pages where user_id = '$U1' and book_hash='b1' and page=1 and start_time=1001) = 9;
  n := public.upsert_stat_pages_as('$U1', '[{"book_hash":"b1","page":1,"start_time":1001,"duration":3,"total_pages":100}]');
  assert n = 0, 'shorter duration ignored';
  raise notice 'ok 6: upsert_stat_pages_as merge';
end \$\$;
reset role;

-- 7. RLS: authenticated users see only their own manifest rows; every archive
--    table has RLS enabled; the service-role-only tables are not readable by
--    anon/authenticated at all
do \$\$ begin
  assert (select bool_and(relrowsecurity) from pg_class
          where relname in ('stat_archives','stat_archive_state','stat_archive_orphans')), 'RLS on all 3 tables';
  assert (select count(*) from pg_class
          where relname in ('stat_archives','stat_archive_state','stat_archive_orphans')) = 3;
end \$\$;
set role authenticated;
select set_config('request.jwt.claim.sub', '$U1', false);
do \$\$ begin
  assert (select count(*) from public.stat_archives) = 2, 'u1 sees its 2 segments';
end \$\$;
select set_config('request.jwt.claim.sub', '$U2', false);
do \$\$ begin
  assert (select count(*) from public.stat_archives) = 0, 'u2 sees nothing';
  raise notice 'ok 7: stat_archives RLS + relrowsecurity on all tables';
end \$\$;
reset role;
SQL

# 7b. anon/authenticated cannot read the service-role-only tables (REVOKE, not just RLS)
for tbl in stat_archive_state stat_archive_orphans; do
  for role in anon authenticated; do
    if $PSQL -c "set role $role; select * from public.$tbl;" >/dev/null 2>"$D/err"; then
      echo "FAIL 7b: $role could select $tbl" >&2; exit 1
    fi
    grep -q "permission denied" "$D/err" || { echo "FAIL 7b: unexpected error for $role/$tbl: $(head -1 "$D/err")" >&2; exit 1; }
  done
done
echo "ok 7b: anon/authenticated cannot read stat_archive_state / stat_archive_orphans"

# 8. grants: anon/authenticated cannot execute the archive RPCs
for fn in "stat_archive_claim_users(1)" "stat_archive_candidate('$U1','7 days')" "stat_archive_rows('$U1','epoch','7 days',1)" "stat_archive_commit('$U1','k','epoch',now(),0,0)" "upsert_stat_pages_as('$U1','[]')"; do
  for role in anon authenticated; do
    if $PSQL -c "set role $role; select public.$fn;" >/dev/null 2>"$D/err"; then
      echo "FAIL 8: $role could execute $fn" >&2; exit 1
    fi
    grep -q "permission denied" "$D/err" || { echo "FAIL 8: unexpected error for $role/$fn: $(head -1 "$D/err")" >&2; exit 1; }
  done
done
echo "ok 8: anon/authenticated cannot execute the archive RPCs"
echo "ALL MIGRATION 020 CHECKS PASSED"
