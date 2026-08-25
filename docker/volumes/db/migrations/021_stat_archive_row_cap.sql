-- Migration 021: harden the reading-statistics archive RPCs against the
-- PostgREST response row cap (Supabase db-max-rows = 1000).
--
-- stat_archive_rows is called through PostgREST, whose row cap silently
-- truncates SETOF results. Migration 020's version extended the page to the end
-- of its last millisecond; under truncation the cut could land inside a run of
-- rows sharing one updated_at (a push chunk shares one now()), and the
-- subsequent range delete in stat_archive_commit then removed rows that were
-- never archived. Two changes make that class of bug impossible:
--
-- 1. stat_archive_rows becomes a plain KEYSET pager over
--    (updated_at, book_hash, page, start_time). A keyset page is
--    truncation-proof by construction: any proxy cap only shortens the page,
--    and the caller's cursor comes from rows it actually received, so progress
--    is always monotonic and no row can be skipped -- including inside a
--    millisecond that holds more rows than any single response can carry.
--    The millisecond-boundary policy (segments must end at complete
--    milliseconds, because clients page on a millisecond cursor) moves to the
--    caller, which trims or keeps the trailing millisecond of the rows it
--    assembled and never derives a boundary from a page edge.
-- 2. stat_archive_commit REFUSES (raises, rolling back the manifest insert and
--    the delete) when the range's delete count differs from the declared
--    segment row count, so any future counting bug fails loud and lossless.

-- The signature changes (three cursor parameters), so the 020 version must go:
-- CREATE OR REPLACE would create an overload next to it.
DROP FUNCTION IF EXISTS public.stat_archive_rows(uuid, timestamp with time zone, interval, integer);

CREATE FUNCTION public.stat_archive_rows(
  p_user uuid, p_from timestamp with time zone, p_window interval, p_limit integer,
  p_tie_book text DEFAULT NULL, p_tie_page integer DEFAULT NULL, p_tie_start bigint DEFAULT NULL)
RETURNS SETOF public.stat_pages
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public.stat_pages
  WHERE user_id = p_user
    AND updated_at <= now() - p_window
    AND (updated_at > p_from
         OR (p_tie_book IS NOT NULL
             AND updated_at = p_from
             AND (book_hash, page, start_time) > (p_tie_book, p_tie_page, p_tie_start)))
  ORDER BY updated_at, book_hash, page, start_time
  LIMIT p_limit;
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

-- Grants for the new signature; the commit function keeps its privileges across
-- CREATE OR REPLACE but a fresh self-hosted database applying 020+021 must end
-- tight either way.
REVOKE EXECUTE ON FUNCTION public.stat_archive_rows(uuid, timestamp with time zone, interval, integer, text, integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stat_archive_commit(uuid, text, timestamp with time zone, timestamp with time zone, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stat_archive_rows(uuid, timestamp with time zone, interval, integer, text, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.stat_archive_commit(uuid, text, timestamp with time zone, timestamp with time zone, integer, integer) TO service_role;
