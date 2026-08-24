-- Migration 021: harden the reading-statistics archive RPCs against the
-- PostgREST response row cap (Supabase db-max-rows = 1000).
--
-- stat_archive_rows is called through PostgREST, whose row cap silently
-- truncates SETOF results. Migration 020's version EXTENDED the page to the end
-- of its last millisecond; under truncation the cut could land inside a run of
-- rows sharing one updated_at (a push chunk shares one now()), and the
-- subsequent range delete in stat_archive_commit then removed rows that were
-- never archived. Two changes make that class of bug impossible:
--
-- 1. stat_archive_rows now TRIMS the trailing millisecond unless the page
--    provably contains every row of the user in that millisecond (checked
--    without the window filter, so a window cutoff inside a millisecond can
--    never produce a boundary there either). The whole-millisecond extension
--    survives only for the single-millisecond page, where trimming would return
--    nothing. Every result therefore ends at a complete millisecond, whatever a
--    proxy truncates afterwards, and the caller is expected to request at most
--    the proxy's cap per call and assemble larger segments from several calls.
-- 2. stat_archive_commit now REFUSES (raises, rolling back the manifest insert
--    and the delete) when the range's delete count differs from the declared
--    segment row count, so any future counting bug fails loud and lossless.

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
  ), edge AS (
    SELECT date_trunc('milliseconds', max(updated_at)) AS ms FROM page
  ), ms_rows AS (
    -- every row of the user in the trailing millisecond, window ignored
    SELECT s.* FROM public.stat_pages s, edge
    WHERE s.user_id = p_user
      AND s.updated_at >= edge.ms AND s.updated_at < edge.ms + interval '1 millisecond'
  ), covered AS (
    SELECT (SELECT count(*) FROM ms_rows) =
           (SELECT count(*) FROM page p, edge WHERE p.updated_at >= edge.ms) AS is_full
  ), trimmed AS (
    SELECT p.* FROM page p, edge WHERE p.updated_at < edge.ms
  )
  SELECT * FROM (
    SELECT * FROM trimmed
    UNION ALL
    SELECT * FROM ms_rows
    WHERE (SELECT is_full FROM covered)
       OR NOT EXISTS (SELECT 1 FROM trimmed)  -- single-millisecond page: whole ms
  ) t
  ORDER BY updated_at, book_hash, page, start_time;
$$;

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
  IF v_deleted <> p_rows THEN
    -- The segment does not hold exactly the rows of (p_from, p_to]: refuse and
    -- roll back (manifest insert and delete both undone) instead of losing the
    -- difference. The already-written object is harmless: deterministic key,
    -- overwritten on the next attempt.
    RAISE EXCEPTION 'stat_archive_commit: segment holds % rows but range (%,%] would delete % for user %',
      p_rows, p_from, p_to, v_deleted, p_user USING ERRCODE = 'P0001';
  END IF;
  RETURN v_deleted;
END;
$$;

-- Re-apply the execution grants: CREATE OR REPLACE keeps existing privileges,
-- but a fresh self-hosted database applying 020+021 in order must end tight.
REVOKE EXECUTE ON FUNCTION public.stat_archive_rows(uuid, timestamp with time zone, interval, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stat_archive_commit(uuid, text, timestamp with time zone, timestamp with time zone, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stat_archive_rows(uuid, timestamp with time zone, interval, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.stat_archive_commit(uuid, text, timestamp with time zone, timestamp with time zone, integer, integer) TO service_role;
