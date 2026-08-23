-- Migration 020: reading-statistics archive (stat_pages history tiered out of
-- Postgres into immutable per-user segment objects).
--
-- stat_pages keeps a hot window; a compaction job moves older rows into
-- object storage and records each segment in stat_archives. The stats pull
-- composes pages from segments + hot rows server-side, so clients never change.
--
-- Invariant: a committed segment covers (updated_from, updated_to] exactly and
-- the same transaction deletes those hot rows; every push stamps
-- updated_at = now(). Every hot row of a user is therefore newer than every
-- segment of that user.
--
-- All functions below run as service_role (the compaction job) and are
-- SECURITY INVOKER with a fixed search_path; EXECUTE is revoked from every
-- other role.

CREATE TABLE IF NOT EXISTS public.stat_archives (
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  id            bigint GENERATED ALWAYS AS IDENTITY,
  updated_from  timestamp with time zone NOT NULL,  -- exclusive
  updated_to    timestamp with time zone NOT NULL,  -- inclusive
  row_count     integer NOT NULL,
  bytes         integer NOT NULL,
  object_key    text NOT NULL,                      -- stats/v1/{user_id}/{updated_to_ms}.json
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT stat_archives_pkey PRIMARY KEY (user_id, id),
  CONSTRAINT stat_archives_object_key_key UNIQUE (object_key)
);
CREATE INDEX IF NOT EXISTS idx_stat_archives_user_to ON public.stat_archives (user_id, updated_to);

ALTER TABLE public.stat_archives ENABLE ROW LEVEL SECURITY;
-- Users may list their own manifest (the stats pull runs as the user); only
-- service_role writes, so there are no insert/update/delete policies.
DROP POLICY IF EXISTS stat_archives_select ON public.stat_archives;
CREATE POLICY stat_archives_select ON public.stat_archives FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Single-row sweep cursor for the compaction job. Service-role only: RLS with
-- no policies denies every other role, and the REVOKE keeps PostgREST from
-- exposing it through Supabase's default table privileges.
CREATE TABLE IF NOT EXISTS public.stat_archive_state (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  user_cursor uuid,
  updated_at  timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.stat_archive_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stat_archive_state FROM PUBLIC, anon, authenticated;
INSERT INTO public.stat_archive_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Users whose account was deleted while archive objects may still exist under
-- stats/v1/{user_id}/ (the account-deletion handler queues every deleted user;
-- the compaction job sweeps the prefix and removes the row once it lists
-- empty). No foreign key: the auth user is already gone. Service-role only.
CREATE TABLE IF NOT EXISTS public.stat_archive_orphans (
  user_id     uuid PRIMARY KEY,
  created_at  timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.stat_archive_orphans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stat_archive_orphans FROM PUBLIC, anon, authenticated;

-- Next batch of users in stat_pages PK order after the saved cursor (loose
-- index scan: one PK probe per user), advancing the cursor in the same
-- statement. The cursor becomes NULL when fewer than p_n users remained, so the
-- sweep is a ring over every user who currently has any hot row. Serialized by
-- an advisory lock so overlapping runs receive disjoint batches.
CREATE OR REPLACE FUNCTION public.stat_archive_claim_users(p_n integer)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_cursor uuid;
  v_users uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('stat_archive_claim'));
  SELECT user_cursor INTO v_cursor FROM public.stat_archive_state WHERE id = 1 FOR UPDATE;
  -- (no min(uuid) aggregate in PG 15: ORDER BY ... LIMIT 1 probes the PK)
  WITH RECURSIVE t(u) AS (
    SELECT (SELECT user_id FROM public.stat_pages
            WHERE v_cursor IS NULL OR user_id > v_cursor
            ORDER BY user_id LIMIT 1)
    UNION ALL
    SELECT (SELECT user_id FROM public.stat_pages WHERE user_id > t.u
            ORDER BY user_id LIMIT 1)
    FROM t WHERE t.u IS NOT NULL
  )
  SELECT coalesce(array_agg(u ORDER BY u), '{}') INTO v_users
  FROM (SELECT u FROM t WHERE u IS NOT NULL LIMIT p_n) s;
  UPDATE public.stat_archive_state
     SET user_cursor = CASE WHEN cardinality(v_users) < p_n THEN NULL
                            ELSE v_users[cardinality(v_users)] END,
         updated_at = now()
   WHERE id = 1;
  RETURN QUERY SELECT unnest(v_users);
END;
$$;

-- Eligibility numbers for one user (index range scans on (user_id, updated_at)).
CREATE OR REPLACE FUNCTION public.stat_archive_candidate(p_user uuid, p_window interval)
RETURNS TABLE(eligible integer, oldest timestamp with time zone, hot_total integer,
              archived_to timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*)::int FROM public.stat_pages
      WHERE user_id = p_user AND updated_at <= now() - p_window),
    (SELECT min(updated_at) FROM public.stat_pages
      WHERE user_id = p_user AND updated_at <= now() - p_window),
    (SELECT count(*)::int FROM public.stat_pages WHERE user_id = p_user),
    (SELECT coalesce(max(updated_to), 'epoch'::timestamptz) FROM public.stat_archives
      WHERE user_id = p_user);
$$;

-- Rows for the next segment: everything after p_from up to the window cutoff,
-- in updated_at order; the first p_limit rows EXTENDED with every row of the
-- user that falls in the same MILLISECOND as the last one. Clients page on a
-- millisecond cursor (updated_at_ms) and segments are keyed by updated_to_ms,
-- so a segment never splits a millisecond; one push chunk shares one
-- updated_at, so the extension is bounded by concurrent pushes.
CREATE OR REPLACE FUNCTION public.stat_archive_rows(
  p_user uuid, p_from timestamp with time zone, p_window interval, p_limit integer)
RETURNS SETOF public.stat_pages
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH page AS (
    SELECT * FROM public.stat_pages
    WHERE user_id = p_user AND updated_at > p_from AND updated_at <= now() - p_window
    ORDER BY updated_at LIMIT p_limit
  ), edge AS (SELECT date_trunc('milliseconds', max(updated_at)) AS ms FROM page)
  SELECT * FROM page
  UNION
  SELECT s.* FROM public.stat_pages s, edge
  WHERE s.user_id = p_user
    AND s.updated_at >= edge.ms AND s.updated_at < edge.ms + interval '1 millisecond'
  ORDER BY updated_at, book_hash, page, start_time;
$$;

-- Atomic commit: compare-and-set on the user's archived_to, manifest insert,
-- hot-row delete of exactly (p_from, p_to]. The CAS makes a concurrent second
-- run for the same user fail with 40001 instead of double-archiving; callers
-- must leave the already-written object alone on any error.
CREATE OR REPLACE FUNCTION public.stat_archive_commit(
  p_user uuid, p_key text, p_from timestamp with time zone, p_to timestamp with time zone,
  p_rows integer, p_bytes integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_archived_to timestamptz;
  v_deleted integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('stat_archive_user:' || p_user::text));
  SELECT coalesce(max(updated_to), 'epoch'::timestamptz) INTO v_archived_to
    FROM public.stat_archives WHERE user_id = p_user;
  IF v_archived_to <> p_from THEN
    RAISE EXCEPTION 'stat_archive_commit: archived_to % <> p_from % for user %',
      v_archived_to, p_from, p_user USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.stat_archives (user_id, updated_from, updated_to, row_count, bytes, object_key)
    VALUES (p_user, p_from, p_to, p_rows, p_bytes, p_key);
  DELETE FROM public.stat_pages
    WHERE user_id = p_user AND updated_at > p_from AND updated_at <= p_to;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Same merge as upsert_stat_pages (migration 019) for an explicit user: the
-- restore tool runs as service_role, whose auth.uid() is NULL.
CREATE OR REPLACE FUNCTION public.upsert_stat_pages_as(p_user uuid, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.stat_pages
    (user_id, book_hash, page, start_time, duration, total_pages, ext, updated_at, deleted_at)
  SELECT DISTINCT ON (r.book_hash, r.page, r.start_time)
    p_user, r.book_hash, r.page, r.start_time,
    coalesce(r.duration, 0), coalesce(r.total_pages, 0), r.ext, now(), r.deleted_at
  FROM jsonb_to_recordset(p_rows) AS r(
    book_hash text, page integer, start_time bigint, duration integer,
    total_pages integer, ext jsonb, deleted_at timestamptz)
  ORDER BY r.book_hash, r.page, r.start_time, r.duration DESC NULLS LAST
  ON CONFLICT (user_id, book_hash, page, start_time) DO UPDATE
    SET duration = EXCLUDED.duration,
        total_pages = EXCLUDED.total_pages,
        ext = EXCLUDED.ext,
        updated_at = EXCLUDED.updated_at,
        deleted_at = EXCLUDED.deleted_at
    WHERE EXCLUDED.duration > stat_pages.duration;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.stat_archive_claim_users(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stat_archive_candidate(uuid, interval) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stat_archive_rows(uuid, timestamp with time zone, interval, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stat_archive_commit(uuid, text, timestamp with time zone, timestamp with time zone, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_stat_pages_as(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stat_archive_claim_users(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.stat_archive_candidate(uuid, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.stat_archive_rows(uuid, timestamp with time zone, interval, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.stat_archive_commit(uuid, text, timestamp with time zone, timestamp with time zone, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_stat_pages_as(uuid, jsonb) TO service_role;

-- Compaction deletes rows continuously; reclaim them for reuse without waiting
-- for 20% of a 50M-row table to die first.
ALTER TABLE public.stat_pages SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.02);
