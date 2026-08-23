-- Migration 019: merge-upsert RPC for stat_pages pushes.
--
-- The push handler used to SELECT the batch's existing rows
-- (user_id = ?, book_hash = ANY(...), start_time = ANY(...)), decide
-- "longer duration wins" in JS, then upsert in a second round trip. On PG 15
-- that lookup re-walks the whole (user_id, book_hash) primary-key range once
-- per start_time array element, because start_time sits after the
-- unconstrained `page` column of the PK; it was also half of all stats push
-- traffic. One INSERT ... ON CONFLICT does the same merge with exact PK probes.
--
-- Semantics (KOReader-compatible union merge): new keys are inserted; an
-- existing key is overwritten only when the incoming duration is strictly
-- longer. Duplicate keys inside one batch collapse to the longest duration so
-- the statement never hits "ON CONFLICT DO UPDATE command cannot affect row a
-- second time". user_id and updated_at are stamped here, never trusted from
-- the payload. SECURITY INVOKER keeps the stat_pages RLS policies in force.

CREATE OR REPLACE FUNCTION public.upsert_stat_pages(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.stat_pages
    (user_id, book_hash, page, start_time, duration, total_pages, ext, updated_at, deleted_at)
  SELECT DISTINCT ON (r.book_hash, r.page, r.start_time)
    auth.uid(), r.book_hash, r.page, r.start_time,
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

REVOKE EXECUTE ON FUNCTION public.upsert_stat_pages(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_stat_pages(jsonb) TO authenticated;
